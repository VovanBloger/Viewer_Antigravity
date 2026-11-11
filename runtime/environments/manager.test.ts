import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EnvironmentManager, type ProcessFactory } from './manager.ts';

test('environment allocation is persisted and resources cannot be shared across branches', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-env-'));
  const project=(id:string)=>id==='viewer'?{id,path:root}:undefined;
  const a=new EnvironmentManager(root,project,{min:3400,max:3401}),b=new EnvironmentManager(root,project,{min:3400,max:3401});
  const input={id:'a',projectId:'viewer',branch:'feature/a',network:'test' as const,botId:'bot-a',actors:['one','two']};
  try {
    a.registerBot('bot-a','test'); b.registerBot('bot-b','test');
    const first=a.allocate(input), second=b.allocate({...input,id:'b',branch:'feature/b',botId:'bot-b'});
    assert.notEqual(first.port,second.port); assert.notEqual(first.databasePath,second.databasePath);
    assert.equal(b.get('a')?.port,first.port);
    assert.deepEqual(a.allocate(input),first);
    assert.deepEqual(first.actors,['one','two']); // explicit shared multiplayer environment
    assert.throws(()=>a.allocate({...input,id:'c',branch:'feature/c'}),/RESOURCE_BUSY/);
    assert.throws(()=>a.allocate({...input,id:'c',projectId:'typo'}),/UNKNOWN_PROJECT/);
    assert.throws(()=>a.allocate({...input,id:'c',network:'production'}),/ENVIRONMENT_CONFLICT|BOT_NETWORK_MISMATCH/);
    assert.throws(()=>a.allocate({...input,id:'../escape'}),/INVALID_ID/);
    assert.throws(()=>a.allocate({...input,id:'CON'}),/INVALID_ID/);
    assert.throws(()=>a.allocate({...input,id:'A',branch:'feature/other',botId:'bot-b'}),/ENVIRONMENT_ID_CONFLICT/);
    assert.throws(()=>a.allocate({...input,id:'other',branch:'FEATURE/A',botId:'bot-b'}),/RESOURCE_BUSY/);
    assert.throws(()=>a.allocate({...input,branch:'../escape'}),/INVALID_BRANCH/);
    a.registerBot('bot-c','test');
    assert.throws(()=>a.allocate({...input,id:'c',branch:'feature/c',botId:'bot-c'}),/PORT_POOL_EXHAUSTED/);
    let command: unknown;
    await a.createWorktree(first.id,async(...args)=>{command=args});
    assert.deepEqual(command,['git',['worktree','add','-b','feature/a',first.worktree,'HEAD'],root]);
  } finally { a.close();b.close();fs.rmSync(root,{recursive:true,force:true}); }
});

test('environment lifecycle: one owner, readiness failure, sanitized errors and stop only owned handle', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-env-life-'));
  const project=(id:string)=>({id,path:root});
  const a=new EnvironmentManager(root,project),b=new EnvironmentManager(root,project);
  a.registerBot('bot','test');const env=a.allocate({id:'one',projectId:'viewer',branch:'feature/one',botId:'bot',network:'test'});
  let starts=0,stops=0;
  const factory: ProcessFactory={start:async()=>{starts++;return{ready:async()=>{},stop:async()=>{stops++}}}};
  try {
    await assert.rejects(a.start(env.id,{executable:'node',args:[],readinessUrl:'https://remote.example'},factory),/INVALID_READINESS_URL/);
    await a.start(env.id,{executable:'node',args:['app.js']},factory);
    await a.start(env.id,{executable:'node',args:['app.js']},factory); assert.equal(starts,1);
    await assert.rejects(b.start(env.id,{executable:'node',args:[]},factory),/EXTERNAL_PROCESS_OWNER/);
    await assert.rejects(b.stop(env.id),/EXTERNAL_PROCESS_OWNER/);
    assert.throws(()=>a.close(),/STOP_OWNED_PROCESSES_FIRST/);
    await a.stop(env.id);await a.stop(env.id);assert.equal(stops,1);
    const bad: ProcessFactory={start:async()=>({ready:async()=>{throw new Error('BOT_TOKEN=123456789:AAF'+'k'.repeat(32))},stop:async()=>{stops++}})};
    await assert.rejects(a.start(env.id,{executable:'node',args:[]},bad),/REDACTED/);
    assert.equal(a.get(env.id)?.status,'failed');assert.equal(stops,2);
    assert.doesNotMatch(JSON.stringify(b.list()),/AAFkkkk/);
  } finally { a.close();b.close();fs.rmSync(root,{recursive:true,force:true}); }
});

test('failed child cleanup retains ownership until a successful explicit stop', async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-env-stop-'));
  const project=(id:string)=>({id,path:root});
  const a=new EnvironmentManager(root,project),b=new EnvironmentManager(root,project);
  a.registerBot('bot','test');const env=a.allocate({id:'one',projectId:'viewer',branch:'feature/one',botId:'bot',network:'test'});
  let stopFails=true;
  const factory: ProcessFactory={start:async()=>({ready:async()=>{throw new Error('READINESS_TIMEOUT')},stop:async()=>{if(stopFails) throw new Error('Cannot stop')}})};
  try {
    await assert.rejects(a.start(env.id,{executable:'node',args:[]},factory),/CHILD_STOP_FAILED_RETRY_STOP/);
    await assert.rejects(b.start(env.id,{executable:'node',args:[]},factory),/EXTERNAL_PROCESS_OWNER/);
    await assert.rejects(b.stop(env.id),/EXTERNAL_PROCESS_OWNER/);
    assert.throws(()=>a.close(),/STOP_OWNED_PROCESSES_FIRST/);
    stopFails=false;await a.stop(env.id);
    assert.equal(b.get(env.id)?.status,'stopped');
  } finally { stopFails=false;await a.stop(env.id);a.close();b.close();fs.rmSync(root,{recursive:true,force:true}); }
});

test('worktree creation is exclusive across managers and cannot close a live job',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-env-worktree-'));
  const project=(id:string)=>({id,path:root});const a=new EnvironmentManager(root,project),b=new EnvironmentManager(root,project);
  a.registerBot('bot','test');a.allocate({id:'one',projectId:'viewer',branch:'feature/one',botId:'bot',network:'test'});
  let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve});
  const pending=a.createWorktree('one',async()=>ready);
  try {
    await assert.rejects(b.createWorktree('one',async()=>{throw new Error('must not run')}),/WORKTREE_CREATION_BUSY/);
    assert.throws(()=>a.close(),/STOP_OWNED_PROCESSES_FIRST/);
  } finally { release();await pending;a.close();b.close();fs.rmSync(root,{recursive:true,force:true}); }
});

test('dangling and internal junctions cannot redirect isolated data directories',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-env-links-'));
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-env-outside-'));
  const manager=new EnvironmentManager(root,id=>({id,path:root}));manager.registerBot('bot','test');
  const link=path.join(root,'data');
  try {
    const removedTarget=path.join(outside,'removed');fs.mkdirSync(removedTarget);
    fs.symlinkSync(removedTarget,link,'junction');fs.rmdirSync(removedTarget);
    const input={id:'one',projectId:'viewer',branch:'feature/one',botId:'bot',network:'test' as const};
    assert.throws(()=>manager.allocate(input),/PATH_OUTSIDE_ROOT/);
    fs.unlinkSync(link);fs.mkdirSync(path.join(root,'alias'));fs.symlinkSync(path.join(root,'alias'),link,'junction');
    assert.throws(()=>manager.allocate(input),/PATH_OUTSIDE_ROOT/);
  } finally { manager.close();fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true}); }
});
