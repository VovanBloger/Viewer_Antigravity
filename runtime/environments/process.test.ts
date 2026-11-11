import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { EnvironmentManager } from './manager.ts';
import { localProcessFactory } from './process.ts';

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
