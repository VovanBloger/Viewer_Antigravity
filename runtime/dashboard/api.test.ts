import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../queue/store.ts';
import { dashboardRequest } from './api.ts';

test('dashboard: cross-origin blocked, exact project, external review without merge', async () => {
  const store = openStore({ dbPath: ':memory:' });
  store.registerProject({ id:'viewer', name:'Viewer', path:process.cwd() });
  const post = (body: object, origin = 'http://127.0.0.1:3100') => dashboardRequest(new Request('http://127.0.0.1:3100/api/lab', { method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body) }),store);
  try {
    assert.equal((await post({action:'submit'},'https://evil.example')).status,403);
    assert.equal((await dashboardRequest(new Request('http://192.168.1.9/api/lab'),store)).status,403);
    const input = { action:'submit',projectId:'typo',title:'Check',goal:'Check',acceptance:['Done'],idempotencyKey:'test' };
    assert.equal((await post(input)).status,400);
    const first = await (await post({...input,projectId:'viewer',workdir:'C:/unwanted',notify:{telegram:true,chatId:1}})).json();
    const second = await (await post({...input,projectId:'viewer'})).json();
    assert.equal(first.task.id,second.task.id);
    assert.equal(store.get(first.task.id)?.notify?.telegram,false);
    assert.notEqual(store.get(first.task.id)?.workdir,'C:/unwanted');
    const task=store.claimNext({projectId:'viewer',executorId:'antigravity',owner:'test'})!;
    const reported=store.report(task.id,'test',{summary:'Done',changedFiles:[],checks:[],artifacts:[],openQuestions:[]});
    assert.equal((await (await post({action:'verdict',taskId:task.id,version:reported.version,decision:'approve'})).json()).task.status,'APPROVED');
    const list=await (await dashboardRequest(new Request('http://127.0.0.1:3100/api/lab'),store)).json();
    assert.equal(list.tasks.length,1);
    assert.equal(list.tasks[0].status,'APPROVED');
  } finally { store.close(); }
});

test('dashboard: byte-bounded input, JSON shape and stale review are rejected without mutation', async()=>{
  const store=openStore({dbPath:':memory:'});store.registerProject({id:'viewer',name:'Viewer',path:process.cwd()});
  const post=(body:unknown)=>dashboardRequest(new Request('http://localhost/api/lab',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),store);
  try {
    assert.equal((await post(null)).status,400);
    assert.equal((await post([])).status,400);
    assert.equal((await post({action:'submit',projectId:'viewer',title:'a',goal:'b',acceptance:[]})).status,400);
    assert.equal((await post({action:'submit',goal:'я'.repeat(21000)})).status,413,'limit counts UTF-8 bytes, not characters');
    let read=false;
    const stream=new ReadableStream<Uint8Array>({pull(controller){read=true;controller.enqueue(new Uint8Array(40001));controller.close()}});
    const streamed=new Request('http://localhost/api/lab',{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'} as RequestInit);
    assert.equal((await dashboardRequest(streamed,store)).status,413);assert.equal(read,true);
    const declared=new Request('http://localhost/api/lab',{method:'POST',headers:{'content-type':'application/json','content-length':'40001'},body:'{}'});
    assert.equal((await dashboardRequest(declared,store)).status,413);
    const wrongType=new Request('http://localhost/api/lab',{method:'POST',headers:{'content-type':'application/jsonp'},body:'{}'});
    assert.equal((await dashboardRequest(wrongType,store)).status,415);
    const created=await(await post({action:'submit',projectId:'viewer',title:'a',goal:'b',acceptance:['done'],idempotencyKey:'one'})).json();
    const claimed=store.claimNext({projectId:'viewer',executorId:'antigravity',owner:'worker'})!;
    const reported=store.report(claimed.id,'worker',{summary:'done',changedFiles:[],checks:[],artifacts:[],openQuestions:[]});
    assert.equal((await post({action:'verdict',taskId:claimed.id,decision:'approve',version:created.task.version})).status,409);
    assert.equal((await post({action:'verdict',taskId:claimed.id,decision:'request_changes',version:reported.version,notes:'  '})).status,400);
    assert.equal(store.get(claimed.id)?.status,'REPORTED');
    assert.equal((await post({action:'verdict',taskId:claimed.id,decision:'request_changes',version:reported.version,notes:'Fix the failing test'})).status,200);
    assert.equal((await post({action:'verdict',taskId:claimed.id,decision:'approve',version:reported.version})).status,409);
    assert.equal(store.get(claimed.id)?.status,'QUEUED');
  }finally{store.close()}
});

test('dashboard: latest tasks and all response fields are sanitized, without file-serving links',async()=>{
  const store=openStore({dbPath:':memory:'});
  const token='123456789:AAF'+'k'.repeat(32);
  store.registerProject({id:'viewer',name:`BOT_TOKEN=${token}`,path:process.cwd()});
  for(let i=0;i<105;i++) store.submit({projectId:'viewer',kind:'diagnostic',title:`Task ${i}`,goal:'Check',acceptance:[],coordinatorId:'test'});
  try{
    const response=await dashboardRequest(new Request('http://localhost/api/lab'),store),raw=await response.text(),data=JSON.parse(raw);
    assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.equal(data.tasks.length,100);assert.equal(data.tasks[0].title,'Task 104');assert.equal(data.tasks.at(-1).title,'Task 5');
    assert.doesNotMatch(raw,/AAFkkkk/);assert.equal(data.projects[0].path,undefined);
    const original=store.events;
    store.events=id=>[...original(id),{taskId:id,at:new Date().toISOString(),type:'diagnostic',actor:`BOT_TOKEN=${token}`,data:{note:`Cookie: ${token}`}}];
    const detail=await(await dashboardRequest(new Request(`http://localhost/api/lab?id=${data.tasks[0].id}`),store)).text();
    assert.doesNotMatch(detail,/AAFkkkk/);assert.match(detail,/REDACTED/);
    assert.equal((await dashboardRequest(new Request('http://localhost/api/lab',{headers:{'sec-fetch-site':'cross-site'}}),store)).status,403);
  }finally{store.close()}
});
