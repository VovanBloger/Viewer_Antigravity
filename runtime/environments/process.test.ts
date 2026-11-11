import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { EnvironmentManager } from './manager.ts';
import { localProcessFactory, gitWorktreeRunner } from './process.ts';

test('real child server receives isolated DB/port without model API credentials and stops', {timeout:20000}, async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-child-'));
  const probe=net.createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as net.AddressInfo).port;await new Promise<void>(r=>probe.close(()=>r()));
  const manager=new EnvironmentManager(root,id=>({id,path:root}),{min:port,max:port});
  manager.registerBot('bot','test');const env=manager.allocate({id:'child',projectId:'viewer',branch:'test/child',botId:'bot',network:'test'});
  fs.mkdirSync(env.worktree,{recursive:true});
  const script=`require('http').createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({port:process.env.PORT,db:process.env.DATABASE_PATH,hasApi:!!(process.env.ANTHROPIC_AUTH_TOKEN||process.env.OPENAI_API_KEY)}))}).listen(Number(process.env.PORT),'127.0.0.1')`;
  try {
    const factory=localProcessFactory([process.execPath]);
    await manager.start(env.id,{executable:process.execPath,args:['-e',script]},factory);
    const response=await(await fetch(`http://127.0.0.1:${port}/`)).json();
    assert.equal(response.port,String(port));assert.equal(response.db,env.databasePath);assert.equal(response.hasApi,false);
    await manager.stop(env.id);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(1000)}));
    await assert.rejects(manager.start(env.id,{executable:'unapproved',args:[]},factory),/EXECUTABLE_NOT_ALLOWED/);
  } finally { await manager.stop(env.id);manager.close();fs.rmSync(root,{recursive:true,force:true}); }
});

test('readiness rejects an occupied port and a foreign URL, times out, and cleans up its exact child',{timeout:10000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-child-ready-'));
  const server=http.createServer((_,response)=>response.end('existing server'));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as net.AddressInfo).port;
  const factory=localProcessFactory([process.execPath],200);
  const input={executable:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:root,port,dataDir:root,databasePath:path.join(root,'app.db')};
  let handle: Awaited<ReturnType<typeof factory.start>> | undefined;
  try {
    await assert.rejects(gitWorktreeRunner('git',['worktree','add','-b','safe','--force','HEAD'],root),/GIT_COMMAND_NOT_ALLOWED/);
    await assert.rejects(gitWorktreeRunner('git',['worktree','add','-b','--detach',root,'HEAD'],root),/GIT_COMMAND_NOT_ALLOWED/);
    await assert.rejects(factory.start(input),/PORT_IN_USE/);
    assert.equal(await(await fetch(`http://127.0.0.1:${port}/`)).text(),'existing server');
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    handle=await factory.start(input);
    await assert.rejects(handle.ready('https://remote.example'),/INVALID_READINESS_URL/);
    await assert.rejects(handle.ready(`http://127.0.0.1:${port}/`),/READINESS_TIMEOUT/);
    await handle.stop();await handle.stop();
  } finally {
    await handle?.stop();if(server.listening) await new Promise<void>(resolve=>server.close(()=>resolve()));
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('a ready child exiting later is persisted as failed and releases process ownership',{timeout:10000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-child-exit-'));
  const probe=net.createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as net.AddressInfo).port;await new Promise<void>(r=>probe.close(()=>r()));
  const manager=new EnvironmentManager(root,id=>({id,path:root}),{min:port,max:port});
  manager.registerBot('bot','test');const env=manager.allocate({id:'child',projectId:'viewer',branch:'test/child',botId:'bot',network:'test'});fs.mkdirSync(env.worktree,{recursive:true});
  try {
    await manager.start(env.id,{executable:process.execPath,args:['-e',`require('http').createServer((q,r)=>q.url==='/exit'?r.end('bye',()=>process.exit(1)):r.end('ok')).listen(Number(process.env.PORT),'127.0.0.1')`]},localProcessFactory([process.execPath]));
    assert.equal(await(await fetch(`http://127.0.0.1:${port}/exit`)).text(),'bye');
    const end=Date.now()+3000;
    while(manager.get(env.id)?.status==='ready' && Date.now()<end) await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(manager.get(env.id)?.status,'failed');assert.equal(manager.get(env.id)?.failure,'PROCESS_EXITED');
  } finally { await manager.stop(env.id);manager.close();fs.rmSync(root,{recursive:true,force:true}); }
});
