import { spawn } from 'node:child_process';
import path from 'node:path';
import type { CommandRunner, ProcessFactory } from './manager.ts';

/** Caller supplies a local manifest allowlist. No shell or inherited API credentials. */
export function localProcessFactory(executables: string[], readinessTimeoutMs = 15_000): ProcessFactory {
  const allowed = new Set(executables.map(e => path.resolve(e)));
  return { async start(input) {
    if (!path.isAbsolute(input.executable) || !allowed.has(path.resolve(input.executable))) throw new Error('EXECUTABLE_NOT_ALLOWED');
    const baseEnv: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    for (const name of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP']) if (process.env[name]) baseEnv[name]=process.env[name];
    const child=spawn(input.executable,input.args,{cwd:input.cwd,shell:false,windowsHide:true,stdio:'ignore',env:{...baseEnv,NODE_ENV:'test',PORT:String(input.port),VIEWER_DATA_DIR:input.dataDir,DATABASE_PATH:input.databasePath}});
    let exited=false;
    const closed=new Promise<void>(resolve=>{child.once('close',()=>{exited=true;resolve()});child.once('error',()=>{exited=true;resolve()})});
    await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
    return {
      async ready(url) {
        const end=Date.now()+readinessTimeoutMs;
        while (Date.now()<end) {
          if (exited) throw new Error('PROCESS_EXITED_BEFORE_READY');
          try { const r=await fetch(url,{signal:AbortSignal.timeout(Math.min(1000,Math.max(1,end-Date.now()))),redirect:'error'}); if(r.ok) return; } catch { /* wait for the exact local app, bounded below */ }
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        throw new Error('READINESS_TIMEOUT');
      },
      async stop() {
        if (!exited) child.kill();
        await Promise.race([closed,new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error('CHILD_STOP_TIMEOUT')),5000);timer.unref()})]);
      },
    };
  } };
}

/** Only git worktree add is accepted; no concatenated shell command or cleanup. */
export const gitWorktreeRunner: CommandRunner = async (executable,args,cwd) => {
  if (executable!=='git' || args.length!==6 || args[0]!=='worktree' || args[1]!=='add' || args[2]!=='-b' || args[5]!=='HEAD') throw new Error('GIT_COMMAND_NOT_ALLOWED');
  await new Promise<void>((resolve,reject)=>{
    const child=spawn('git',args,{cwd,shell:false,windowsHide:true,stdio:'ignore'});
    child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`WORKTREE_CREATE_FAILED_${code}`)));
  });
};
