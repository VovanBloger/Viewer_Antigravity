import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EnvironmentManager } from './manager.ts';

test('four independent processes allocate distinct ports and only one wins a shared bot',{timeout:20000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-env-race-'));
  const manager=new EnvironmentManager(root,id=>({id,path:root}),{min:4000,max:4099});
  const children=Array.from({length:4},(_,i)=>fork(fileURLToPath(new URL('./testing/allocator.ts',import.meta.url)),[root,`w${i}`],{execArgv:['--import','tsx'],stdio:['ignore','ignore','ignore','ipc'],windowsHide:true}));
  const exited=children.map(child=>new Promise<void>(resolve=>child.once('exit',()=>resolve())));
  const event=(child:typeof children[number],name:'ready'|'done')=>new Promise<{wonShared?:boolean}>((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error('ALLOCATOR_TIMEOUT')),10000);
    const onMessage=(message:unknown)=>{const m=message as Record<string,unknown>;if(m.error) finish(new Error(String(m.error)));else if(m[name]) finish(undefined,m)};
    const onExit=()=>finish(new Error('ALLOCATOR_EXITED_EARLY'));
    const finish=(error?:Error,value?:{wonShared?:boolean})=>{clearTimeout(timer);child.off('message',onMessage);child.off('exit',onExit);child.off('error',finish);error?reject(error):resolve(value??{})};
    child.on('message',onMessage);child.once('exit',onExit);child.once('error',finish);
  });
  try {
    await Promise.all(children.map(child=>event(child,'ready')));
    const results=children.map(child=>event(child,'done'));
    for(const child of children) child.send({start:true});
    const done=await Promise.all(results);await Promise.all(exited);
    assert.equal(done.filter(r=>r.wonShared).length,1);
    const environments=manager.list();assert.equal(environments.length,41);
    assert.equal(new Set(environments.map(e=>e.port)).size,41);
    assert.equal(new Set(environments.map(e=>e.botId)).size,41);
    assert.equal(new Set(environments.map(e=>e.databasePath)).size,41);
  } finally {
    for(const child of children) if(child.exitCode===null && child.signalCode===null) child.kill();
    await Promise.all(exited);manager.close();fs.rmSync(root,{recursive:true,force:true});
  }
});
