import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import type { CommandRunner, ProcessFactory } from './manager.ts';

function minimalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv={NODE_ENV:'test'};
  for(const name of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP']) if(process.env[name]) env[name]=process.env[name];
  return env;
}

/** Caller supplies a local manifest allowlist. No shell or inherited API credentials. */
export function localProcessFactory(executables: string[], readinessTimeoutMs = 15_000): ProcessFactory {
  if(!Number.isInteger(readinessTimeoutMs) || readinessTimeoutMs<1 || readinessTimeoutMs>300_000) throw new Error('INVALID_READINESS_TIMEOUT');
  const allowed = new Set(executables.map(e => path.resolve(e)));
  return { async start(input) {
    if (!path.isAbsolute(input.executable) || !allowed.has(path.resolve(input.executable))) throw new Error('EXECUTABLE_NOT_ALLOWED');
    // Refuse an existing listener instead of accepting another app's successful readiness response.
    await new Promise<void>((resolve,reject)=>{
      const probe=net.createServer();
      probe.once('error',()=>reject(new Error('PORT_IN_USE')));
      probe.listen(input.port,'127.0.0.1',()=>probe.close(error=>error?reject(error):resolve()));
    });
    const baseEnv = minimalEnv();
    const child=spawn(input.executable,input.args,{cwd:input.cwd,shell:false,windowsHide:true,stdio:'ignore',env:{...baseEnv,NODE_ENV:'test',PORT:String(input.port),VIEWER_DATA_DIR:input.dataDir,DATABASE_PATH:input.databasePath}});
    let exited=false;
    const closed=new Promise<void>(resolve=>{child.once('close',()=>{exited=true;resolve()});child.once('error',()=>{exited=true;resolve()})});
    child.once('exit',()=>{exited=true});
    await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
    let stopping: Promise<void> | undefined;
    const waitForClose=(timeout:number)=>new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('CHILD_STOP_TIMEOUT')),timeout);
      void closed.then(()=>{clearTimeout(timer);resolve()});
    });
    return {
      exited: closed,
      async ready(url) {
        const target=new URL(url);
        if(target.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(target.hostname) || Number(target.port)!==input.port || target.username || target.password) throw new Error('INVALID_READINESS_URL');
        const end=Date.now()+readinessTimeoutMs;
        while (Date.now()<end) {
          if (exited) throw new Error('PROCESS_EXITED_BEFORE_READY');
          try {
            const r=await fetch(url,{signal:AbortSignal.timeout(Math.min(1000,Math.max(1,end-Date.now()))),redirect:'error'});
            void r.body?.cancel().catch(()=>undefined);
            if(r.ok) {
              await new Promise<void>(resolve=>setImmediate(resolve));
              if(exited) throw new Error('PROCESS_EXITED_BEFORE_READY');
              return;
            }
          } catch { /* wait for the exact local app, bounded below */ }
          await new Promise(resolve=>setTimeout(resolve,Math.min(100,Math.max(1,end-Date.now()))));
        }
        throw new Error('READINESS_TIMEOUT');
      },
      async stop() {
        if(stopping) return stopping;
        stopping=(async()=>{
          if(!exited) child.kill();
          try { await waitForClose(2000); }
          catch {
            if(!exited) child.kill('SIGKILL');
            await waitForClose(3000);
          }
        })();
        try { await stopping; } finally { stopping=undefined; }
      },
    };
  } };
}

/** Only git worktree add is accepted; no concatenated shell command or cleanup. */
export const gitWorktreeRunner: CommandRunner = async (executable,args,cwd) => {
  if (executable!=='git' || args.length!==6 || args[0]!=='worktree' || args[1]!=='add' || args[2]!=='-b' || args[5]!=='HEAD' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,160}$/.test(args[3]) || args[3].includes('..') || args[3].endsWith('/') || args[3].includes('//') ||
    !path.isAbsolute(args[4]) || args[4].includes('\0') || !path.isAbsolute(cwd)) throw new Error('GIT_COMMAND_NOT_ALLOWED');
  await new Promise<void>((resolve,reject)=>{
    const child=spawn('git',args,{cwd,shell:false,windowsHide:true,stdio:'ignore',env:minimalEnv(),timeout:60000,killSignal:'SIGKILL'});
    child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`WORKTREE_CREATE_FAILED_${code}`)));
  });
};
