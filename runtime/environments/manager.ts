import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { redactSecrets } from '../queue/redact.ts';

type Network = 'test' | 'production';
export interface Environment {
  id: string; projectId: string; branch: string; worktree: string; network: Network;
  botId: string; port: number; dataDir: string; databasePath: string;
  status: 'created' | 'starting' | 'ready' | 'stopped' | 'failed';
  actors: string[]; failure?: string;
}
export interface EnvironmentInput { id: string; projectId: string; branch: string; network: Network; botId: string; actors?: string[] }
export interface ProcessHandle { stop(): Promise<void>; ready(url: string): Promise<void>; exited?: Promise<void> }
export interface ProcessFactory { start(input: { executable: string; args: string[]; cwd: string; port: number; dataDir: string; databasePath: string }): Promise<ProcessHandle> }
export type CommandRunner = (executable: string, args: string[], cwd: string) => Promise<void>;

/** Environments retain resource allocations after stop, so restarting never steals another branch's bot. */
export class EnvironmentManager {
  private db: DatabaseSync;
  private processes = new Map<string, ProcessHandle>();
  private transitions = new Map<string, Promise<unknown>>();
  private root: string;
  private realRoot: string;
  private owner = randomUUID();
  constructor(root: string, private project: (id: string) => { id: string; path: string } | undefined, private ports = { min: 3200, max: 3999 }) {
    if (!Number.isInteger(ports.min) || !Number.isInteger(ports.max) || ports.min < 1024 || ports.max > 65535 || ports.min > ports.max) throw new Error('INVALID_PORT_POOL');
    this.root = path.resolve(root); fs.mkdirSync(this.root, { recursive: true });
    this.realRoot = fs.realpathSync(this.root);
    this.db = new DatabaseSync(path.join(this.root, 'environments.db'));
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS bots(id TEXT PRIMARY KEY, network TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS environments(id TEXT PRIMARY KEY, project TEXT NOT NULL, branch TEXT NOT NULL, bot TEXT NOT NULL UNIQUE, port INTEGER NOT NULL UNIQUE, spec TEXT NOT NULL, UNIQUE(project,branch));`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.db.prepare('PRAGMA table_info(environments)').all().some(column => column.name === 'owner')) this.db.exec('ALTER TABLE environments ADD COLUMN owner TEXT');
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK');this.db.close();throw error; }
    try {
      this.db.exec('CREATE TABLE IF NOT EXISTS worktree_jobs(id TEXT PRIMARY KEY, owner TEXT NOT NULL)');
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS environments_id_case ON environments(id COLLATE NOCASE);
        CREATE UNIQUE INDEX IF NOT EXISTS environments_branch_case ON environments(project COLLATE NOCASE,branch COLLATE NOCASE);`);
    } catch(error) { this.db.close();throw error; }
  }
  private id(id: string) { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) throw new Error('INVALID_ID'); return id; }
  registerBot(id: string, network: Network) {
    this.id(id); if (!['test','production'].includes(network)) throw new Error('INVALID_NETWORK');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT OR IGNORE INTO bots VALUES(?,?)').run(id,network);
      const current = this.db.prepare('SELECT network FROM bots WHERE id=?').get(id);
      if (current?.network !== network) throw new Error('BOT_NETWORK_MISMATCH');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private ownedPath(...segments: string[]) {
    const target = path.resolve(this.root, ...segments);
    const relative = path.relative(this.root,target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('PATH_OUTSIDE_ROOT');
    // Reject all symlink/junction components, including dangling links and aliases inside root.
    if (fs.realpathSync(this.root) !== this.realRoot) throw new Error('WORKSPACE_ROOT_CHANGED');
    let component = this.root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      component = path.join(component,segment);
      const stat = fs.lstatSync(component,{throwIfNoEntry:false});
      if (stat?.isSymbolicLink()) throw new Error('PATH_OUTSIDE_ROOT');
      if (stat) {
        const realRelative = path.relative(this.realRoot,fs.realpathSync(component));
        if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('PATH_OUTSIDE_ROOT');
      }
    }
    return target;
  }
  get(id: string): Environment | undefined {
    const row = this.db.prepare('SELECT spec FROM environments WHERE id=?').get(id);
    return row ? JSON.parse(String(row.spec)) as Environment : undefined;
  }
  list() { return this.db.prepare('SELECT spec FROM environments ORDER BY id').all().map(r => JSON.parse(String(r.spec)) as Environment); }
  private saveOwned(env: Environment, release = false) {
    const result=this.db.prepare('UPDATE environments SET spec=?, owner=? WHERE id=? AND owner=?').run(JSON.stringify(env),release?null:this.owner,env.id,this.owner);
    if (result.changes !== 1) throw new Error('EXTERNAL_PROCESS_OWNER');
  }
  allocate(input: EnvironmentInput) {
    this.id(input.id); this.id(input.projectId); this.id(input.botId);
    const project = this.project(input.projectId);
    if (!project || project.id !== input.projectId || !path.isAbsolute(project.path)) throw new Error('UNKNOWN_PROJECT');
    if (!['test','production'].includes(input.network)) throw new Error('INVALID_NETWORK');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,160}$/.test(input.branch) || input.branch.includes('..') || input.branch.endsWith('/') || input.branch.includes('//')) throw new Error('INVALID_BRANCH');
    const actors = [...new Set(input.actors ?? [])].map(a => this.id(a));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.get(input.id);
      if (existing) {
        if (existing.projectId !== input.projectId || existing.branch !== input.branch || existing.botId !== input.botId || existing.network !== input.network) throw new Error('ENVIRONMENT_CONFLICT');
        this.db.exec('COMMIT'); return existing;
      }
      if(this.db.prepare('SELECT id FROM environments WHERE id=? COLLATE NOCASE').get(input.id)) throw new Error('ENVIRONMENT_ID_CONFLICT');
      const bot = this.db.prepare('SELECT network FROM bots WHERE id=?').get(input.botId);
      if (!bot || bot.network !== input.network) throw new Error('BOT_NETWORK_MISMATCH');
      if (this.db.prepare('SELECT id FROM environments WHERE bot=? OR (project=? COLLATE NOCASE AND branch=? COLLATE NOCASE)').get(input.botId,input.projectId,input.branch)) throw new Error('RESOURCE_BUSY');
      const used = new Set(this.list().map(e => e.port));
      let port = this.ports.min; while (used.has(port) && port <= this.ports.max) port++;
      if (port > this.ports.max) throw new Error('PORT_POOL_EXHAUSTED');
      const worktree = this.ownedPath('worktrees',input.id), dataDir = this.ownedPath('data',input.id);
      if (fs.existsSync(worktree)) throw new Error('WORKTREE_ALREADY_EXISTS');
      const env: Environment = { id:input.id,projectId:input.projectId,branch:input.branch,network:input.network,botId:input.botId,actors,port,worktree,dataDir,databasePath:path.join(dataDir,'application.db'),status:'created' };
      this.db.prepare('INSERT INTO environments(id,project,branch,bot,port,spec) VALUES(?,?,?,?,?,?)').run(env.id,env.projectId,env.branch,env.botId,env.port,JSON.stringify(env));
      this.db.exec('COMMIT'); return env;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  async createWorktree(id: string, runner: CommandRunner) {
    const env = this.required(id), project = this.project(env.projectId);
    if (!project || project.id !== env.projectId || !path.isAbsolute(project.path)) throw new Error('UNKNOWN_PROJECT');
    this.ownedPath('worktrees',env.id);
    if (fs.existsSync(env.worktree)) throw new Error('WORKTREE_ALREADY_EXISTS');
    fs.mkdirSync(path.dirname(env.worktree), { recursive:true });
    if(this.db.prepare('INSERT OR IGNORE INTO worktree_jobs VALUES(?,?)').run(env.id,this.owner).changes !== 1) throw new Error('WORKTREE_CREATION_BUSY');
    try { await runner('git',['worktree','add','-b',env.branch,env.worktree,'HEAD'],project.path); }
    finally { this.db.prepare('DELETE FROM worktree_jobs WHERE id=? AND owner=?').run(env.id,this.owner); }
  }
  private required(id: string) { const e=this.get(id); if (!e) throw new Error('UNKNOWN_ENVIRONMENT'); return e; }
  private async serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (this.transitions.has(id)) throw new Error('ENVIRONMENT_TRANSITION_BUSY');
    const pending = operation(); this.transitions.set(id,pending);
    try { return await pending; } finally { this.transitions.delete(id); }
  }
  async start(id: string, command: { executable: string; args: string[]; readinessUrl?: string }, factory: ProcessFactory) {
    return this.serial(id,async () => {
      const env=this.required(id);
      if (this.processes.has(id) && env.status === 'ready') return env;
      if (this.processes.has(id)) throw new Error('STOP_OWNED_PROCESSES_FIRST');
      if (['starting','ready'].includes(env.status)) throw new Error('EXTERNAL_PROCESS_OWNER');
      const url=new URL(command.readinessUrl ?? `http://127.0.0.1:${env.port}/`);
      if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || Number(url.port) !== env.port || url.username || url.password) throw new Error('INVALID_READINESS_URL');
      if (!command.executable || command.executable.includes('\0') || !Array.isArray(command.args) || command.args.some(arg=>typeof arg !== 'string' || arg.includes('\0'))) throw new Error('INVALID_COMMAND');
      this.ownedPath('data',env.id); this.ownedPath('worktrees',env.id);
      this.ownedPath('data',env.id,'application.db');
      fs.mkdirSync(env.dataDir,{recursive:true});
      env.status='starting'; delete env.failure;
      const claim=this.db.prepare("UPDATE environments SET spec=?, owner=? WHERE id=? AND owner IS NULL AND json_extract(spec,'$.status') IN ('created','stopped','failed')").run(JSON.stringify(env),this.owner,id);
      if (claim.changes !== 1) throw new Error('EXTERNAL_PROCESS_OWNER');
      let handle: ProcessHandle | undefined;
      try {
        handle=await factory.start({ ...command,cwd:env.worktree,port:env.port,dataDir:env.dataDir,databasePath:env.databasePath });
        this.processes.set(id,handle); await handle.ready(url.href);
        env.status='ready'; this.saveOwned(env);
        if(handle.exited) void handle.exited.then(async()=>{
          await this.transitions.get(id)?.catch(()=>undefined);
          if(this.processes.get(id)!==handle) return;
          const stopped=this.required(id);stopped.status='failed';stopped.failure='PROCESS_EXITED';
          this.saveOwned(stopped,true);this.processes.delete(id);
        }).catch(()=>undefined);
        return env;
      } catch (e) {
        let stopped=true;
        try { await handle?.stop(); } catch { stopped=false; }
        env.status='failed'; env.failure=redactSecrets(e instanceof Error ? e.message : 'START_FAILED');
        if(stopped) this.processes.delete(id);
        else env.failure+='; CHILD_STOP_FAILED_RETRY_STOP';
        this.saveOwned(env,stopped);
        throw new Error(env.failure);
      }
    });
  }
  async stop(id: string) {
    return this.serial(id,async () => {
      const env=this.required(id), handle=this.processes.get(id);
      if (!handle) {
        env.status='stopped';
        const result=this.db.prepare("UPDATE environments SET spec=? WHERE id=? AND owner IS NULL AND json_extract(spec,'$.status') IN ('created','stopped','failed')").run(JSON.stringify(env),id);
        if(result.changes !== 1) throw new Error('EXTERNAL_PROCESS_OWNER');
        return env;
      }
      try { await handle.stop(); }
      catch(e) { env.status='failed';env.failure='CHILD_STOP_FAILED_RETRY_STOP';this.saveOwned(env);throw e; }
      this.processes.delete(id); env.status='stopped';delete env.failure;this.saveOwned(env,true); return env;
    });
  }
  close() { if (this.processes.size || this.transitions.size || this.db.prepare('SELECT id FROM worktree_jobs WHERE owner=?').get(this.owner)) throw new Error('STOP_OWNED_PROCESSES_FIRST'); this.db.close(); }
}
