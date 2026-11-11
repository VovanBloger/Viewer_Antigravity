import fs from 'node:fs';
import path from 'node:path';
import type { Environment } from '../environments/manager.ts';
import type { TaskStore } from '../queue/types.ts';
import { redactSecrets } from '../queue/redact.ts';

export interface ProjectAdapter {
  version: 1; id: string; projectId: string; network: 'test'|'production'; botId: string;
  mode: 'fixture'|'isolated'|'template';
  command?: { executable: string; args: string[] };
  readinessPath?: string;
  blockedReasons?: string[];
}
const id = (value: unknown): value is string => typeof value==='string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value==='object' && !Array.isArray(value);

/** Manifests describe execution; credentials are resolved separately and never belong in them. */
export function parseAdapter(value: unknown, project: (id: string)=>{id: string}|undefined): ProjectAdapter {
  if (!record(value) || Object.keys(value).some(k=>!['version','id','projectId','network','botId','mode','command','readinessPath','blockedReasons'].includes(k))) throw new Error('INVALID_ADAPTER');
  if(redactSecrets(JSON.stringify(value))!==JSON.stringify(value)) throw new Error('SECRETS_FORBIDDEN_IN_MANIFEST');
  if (value.version!==1 || !id(value.id) || !id(value.projectId) || !id(value.botId) || !['test','production'].includes(String(value.network)) || !['fixture','isolated','template'].includes(String(value.mode))) throw new Error('INVALID_ADAPTER');
  if (project(value.projectId)?.id!==value.projectId) throw new Error('UNKNOWN_PROJECT');
  if(value.mode==='fixture'&&value.network!=='test') throw new Error('FIXTURE_REQUIRES_TEST_NETWORK');
  if (value.blockedReasons!==undefined && (!Array.isArray(value.blockedReasons) || value.blockedReasons.some(r=>typeof r!=='string' || !r.trim()))) throw new Error('INVALID_BLOCK_REASONS');
  if (value.mode==='template' && (!Array.isArray(value.blockedReasons) || value.blockedReasons.length===0)) throw new Error('TEMPLATE_REQUIRES_BLOCK_REASON');
  if (value.mode!=='template' && !value.command) throw new Error('COMMAND_REQUIRED');
  if (value.command!==undefined) {
    if (!record(value.command) || Object.keys(value.command).some(k=>!['executable','args'].includes(k)) || typeof value.command.executable!=='string' || !Array.isArray(value.command.args) || value.command.args.some(a=>typeof a!=='string' || a.includes('\0'))) throw new Error('INVALID_COMMAND');
    const all=[value.command.executable,...value.command.args];
    if (all.some(a=>redactSecrets(a)!==a || /^(?:--?)?(?:token|api[-_]key|password|secret|authorization)(?:=|$)/i.test(a))) throw new Error('SECRETS_FORBIDDEN_IN_MANIFEST');
  }
  if (value.readinessPath!==undefined && (typeof value.readinessPath!=='string' || !/^\/[a-zA-Z0-9_/-]*$/.test(value.readinessPath) || value.readinessPath.includes('//'))) throw new Error('INVALID_READINESS_PATH');
  return structuredClone(value) as unknown as ProjectAdapter;
}

export function loadAdapter(file: string, project: (id: string)=>{id: string}|undefined) {
  const stat=fs.statSync(file);if(stat.size>65536) throw new Error('ADAPTER_TOO_LARGE');
  return parseAdapter(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')),project);
}

function inside(root: string, candidate: string) {
  if (!path.isAbsolute(root) || !path.isAbsolute(candidate)) throw new Error('ABSOLUTE_PATH_REQUIRED');
  const relative=path.relative(root,candidate);
  if (!relative || relative==='..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('ENV_PATH_OUTSIDE_WORKSPACE');
  let current=path.resolve(root);
  for(const segment of relative.split(path.sep)) {
    current=path.join(current,segment);
    if(fs.lstatSync(current,{throwIfNoEntry:false})?.isSymbolicLink()) throw new Error('ENV_SYMLINK_FORBIDDEN');
  }
}

/** Binding is pure metadata preparation, never starts processes or creates a worktree. */
export function bindAdapter(adapter: ProjectAdapter, environment: Environment, options: { workspaceRoot: string; nodeExecutable: string; allowedExecutables?: string[] }) {
  if (adapter.mode==='template' || adapter.blockedReasons?.length) throw new Error('ADAPTER_NOT_ISOLATED');
  if (adapter.projectId!==environment.projectId || adapter.network!==environment.network || adapter.botId!==environment.botId) throw new Error('ENVIRONMENT_ADAPTER_MISMATCH');
  if (!Number.isInteger(environment.port) || environment.port<1024 || environment.port>65535) throw new Error('INVALID_ENV_PORT');
  for(const p of [environment.worktree,environment.dataDir,environment.databasePath]) inside(options.workspaceRoot,p);
  const dbRelative=path.relative(environment.dataDir,environment.databasePath);
  if(!dbRelative || dbRelative.startsWith('..') || path.isAbsolute(dbRelative)) throw new Error('DATABASE_OUTSIDE_ENVIRONMENT');
  const command=adapter.command!;
  const executable=command.executable==='$NODE'?options.nodeExecutable:command.executable;
  const allowed=options.allowedExecutables ?? [options.nodeExecutable];
  if(!path.isAbsolute(executable) || !allowed.some(a=>path.resolve(a)===path.resolve(executable))) throw new Error('EXECUTABLE_NOT_ALLOWED');
  const replacements: Record<string,string>={PORT:String(environment.port),WORKTREE:environment.worktree,DATA_DIR:environment.dataDir,DATABASE_PATH:environment.databasePath,BOT_ID:environment.botId,NETWORK:environment.network};
  const args=command.args.map(arg=>arg.replace(/\$\{([^}]+)\}/g,(_,key:string)=>{if(!(key in replacements)) throw new Error('UNKNOWN_ADAPTER_VARIABLE');return replacements[key]}));
  return { executable,args,readinessUrl:`http://127.0.0.1:${environment.port}${adapter.readinessPath ?? '/health'}` };
}

export function registerProjectFromManifest(manifestPath: string, store: TaskStore) {
  const content = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  if (content.version !== 1 || !content.id || !content.name) throw new Error('INVALID_PROJECT_MANIFEST');
  const projectDir = path.dirname(path.resolve(manifestPath));
  return store.registerProject({
    id: String(content.id).trim(),
    name: String(content.name).trim(),
    path: projectDir
  });
}
