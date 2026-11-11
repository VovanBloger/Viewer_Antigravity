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
    store.report(task.id,'test',{summary:'Done',changedFiles:[],checks:[],artifacts:[],openQuestions:[]});
    assert.equal((await (await post({action:'verdict',taskId:task.id,decision:'approve'})).json()).task.status,'APPROVED');
    const list=await (await dashboardRequest(new Request('http://127.0.0.1:3100/api/lab'),store)).json();
    assert.equal(list.tasks.length,1);
    assert.equal(list.tasks[0].status,'APPROVED');
  } finally { store.close(); }
});
