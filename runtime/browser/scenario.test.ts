import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserLab } from './lab.ts';
import { runScenario } from './scenario.ts';
import { listenBrowserFixture } from './testing.ts';
import { Script } from 'node:vm';

/** Renderer fixture only: no Telegram.WebApp shim, Widget SDK or real Telegram API. */
function fixturePage() {
  return `<body><aside>PRIVATE SIDEBAR MUST NOT BE EXPORTED</aside><section class="chat"><div class="chat-info"><span class="peer-title" data-peer-id="101">Fixture peer</span></div><div id="messages"></div><div class="input-message-input" role="textbox" contenteditable="true" data-peer-id="101"></div><button class="btn-send">Send</button><input type="file"><div class="reply-keyboard"><button>Reply</button></div></section><div id="app"></div>
  <script>
  const peer=()=>location.hash.slice(1)||'101';let last='';
  function updatePeer(){const p=peer();document.querySelector('.peer-title').dataset.peerId=new URLSearchParams(location.search).has('mismatch')?'999':p;document.querySelector('[contenteditable]').dataset.peerId=p;last='';refresh()};
  const esc=s=>s.replace(/[<>&\"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  async function refresh(){const p=peer(),messages=await(await fetch('/messages?peer='+p)).json(),serialized=JSON.stringify(messages);if(last===serialized)return;last=serialized;document.querySelector('#messages').innerHTML=messages.map(m=>'<div class="bubble" data-peer-id="'+p+'" data-mid="'+m.id+'"><div class="message">'+esc(m.text)+'</div>'+(m.id===1&&p==='101'?'<div class="reply-markup"><button class="reply-markup-button" onclick="launch()">Play</button><button class="reply-markup-button" onclick="send(&quot;Pong&quot;)">Ping</button></div>':'')+'</div>').join('');const bubble=document.createElement('div');bubble.className='bubble widget-message';bubble.dataset.peerId=p;bubble.dataset.mid='900';const slot=document.createElement('tweb-widget-slot');slot.style.display='block';slot.style.width='250px';slot.style.height='80px';const shadow=slot.attachShadow({mode:'open'});shadow.innerHTML='<button>Widget count 0</button>';shadow.querySelector('button').onclick=()=>shadow.querySelector('button').textContent='Widget count 1';bubble.append(slot);document.querySelector('#messages').append(bubble)};
  async function send(text){await fetch('/message',{method:'POST',body:JSON.stringify({peer:peer(),text})});await refresh()};
  document.querySelector('.btn-send').onclick=()=>{const input=document.querySelector('[contenteditable]');send(input.innerText);input.textContent=''};
  document.querySelector('.reply-keyboard button').onclick=()=>send('Reply acknowledged');document.querySelector('input[type=file]').onchange=e=>send('Staged: '+e.target.files[0].name);
  function launch(){document.querySelector('#app').innerHTML='<iframe title="Mini App fixture" src="/app" width="500" height="250"></iframe>'};
  onkeydown=e=>{if(e.key==='Escape')document.querySelector('#app').innerHTML=''};onhashchange=updatePeer;updatePeer();setInterval(refresh,100);
  </script></body>`;
}

async function setup(run:(ctx:{lab:BrowserLab;root:string;url:string})=>Promise<void>) {
  new Script(fixturePage().split('<script>')[1].split('</script>')[0]);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-scenario-'));
  const history=new Map<string,{id:number;text:string}[]>();
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url!,'http://127.0.0.1');
    if(url.pathname==='/messages'){const peer=url.searchParams.get('peer')!;if(!history.has(peer))history.set(peer,[{id:1,text:'Fixture ready'}]);res.setHeader('content-type','application/json');res.end(JSON.stringify(history.get(peer)));return;}
    if(url.pathname==='/message'){let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body),messages=history.get(data.peer)!;messages.push({id:messages.length+1,text:data.text});res.end('ok');return;}
    res.setHeader('content-type','text/html');
    if(url.pathname==='/app'){res.end('<body>Mini App fixture <p>tgWebAppData=user%3Dhidden%26auth_date%3D123%26hash%3Ddeadbeef</p><label>Value<input aria-label="Value"></label><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'input\').value">Save</button><output>empty</output></body>');return;}
    res.end(url.searchParams.has('mismatch')?fixturePage().replace('data-peer-id="101">Fixture peer','data-peer-id="999">Fixture peer'):fixturePage());
  });
  await listenBrowserFixture(server);const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const lab=new BrowserLab(root,true);
  try {await run({lab,root,url});} finally {await lab.shutdown();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(root,{recursive:true,force:true});}
}

test('real Chromium renderer fixtures: two participants, buttons, app return, Widget shadow DOM, upload and payment simulation', {timeout:60000},async()=>setup(async({lab,root,url})=>{
  const sessions=[];
  for(const id of ['a','b']) {lab.registerActor({id,label:id,network:'test'});sessions.push(await lab.open({actorId:id,owner:'test',projectId:'fixture',network:'test',allowedOrigins:[url],fixtureUrl:url,telegramFixture:true,allowedChats:[{peerId:'101',label:'Fixture bot',kind:'bot'},{peerId:'-202',label:'Fixture group',kind:'group'}]}));}
  const actors={a:{sessionId:sessions[0].id,owner:'test'},b:{sessionId:sessions[1].id,owner:'test'}};
  fs.mkdirSync(path.join(root,'uploads'));fs.writeFileSync(path.join(root,'uploads','fixture.txt'),'fixture upload');
  const paid:string[]=[];
  const report=await runScenario(lab,{name:'Renderer fixture multiplayer',actors,steps:[
    {op:'chat.open',actor:'a',peerId:'-202'},{op:'chat.open',actor:'b',peerId:'-202'},{op:'chat.send',actor:'a',text:'hello from actor a'},{op:'chat.assert',actor:'b',text:'hello from actor a'},
    {op:'chat.send',actor:'b',text:'actor b reply'},{op:'chat.assert',actor:'a',text:'actor b reply'},{op:'chat.open',actor:'a',peerId:'101'},
    {op:'chat.button',actor:'a',kind:'reply',name:'Reply'},{op:'chat.assert',actor:'a',text:'Reply acknowledged'},
    {op:'chat.button',actor:'a',kind:'inline',messageId:'1',name:'Ping'},{op:'chat.assert',actor:'a',text:'Pong'},
    {op:'chat.upload',actor:'a',artifactId:'fixture.txt'},{op:'chat.assert',actor:'a',text:'Staged: fixture.txt'},
    {op:'widget.assert',actor:'a',messageId:'900',text:'Widget count 0'},{op:'widget.click',actor:'a',messageId:'900',name:'Widget count 0'},{op:'widget.assert',actor:'a',messageId:'900',text:'Widget count 1'},
    {op:'app.launch',actor:'a',messageId:'1',button:'Play'},{op:'app.fill',actor:'a',label:'Value',value:'saved value'},{op:'app.click',actor:'a',role:'button',name:'Save'},{op:'app.assert',actor:'a',text:'saved value'},
    {op:'screenshot',actor:'a',surface:'app'},{op:'app.return',actor:'a'},{op:'chat.assert',actor:'a',text:'Pong'},
    {op:'payment.simulate',actor:'a',paymentId:'fixture-order',outcome:'paid'},
  ]},{payments:{simulate:async p=>{paid.push(p.paymentId)}}});
  assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(report.evidence,'fixture');assert.deepEqual(paid,['fixture-order']);assert.equal(report.steps.at(-1)?.simulated,true);
  assert.ok(report.artifacts.some(a=>a.type==='screenshot'));assert.ok(report.artifacts.some(a=>a.type==='scenario-report'));
  const messages=JSON.stringify(await lab.readMessages(sessions[0].id,'test'));assert.doesNotMatch(messages,/PRIVATE SIDEBAR/);
  await lab.launchMiniApp(sessions[0].id,'test','1','Play');assert.doesNotMatch((await lab.snapshot(sessions[0].id,'test')).text,/user%3Dhidden/);
}));

test('renderer fixtures: fail closed on wrong peer/login/app frame; scenario failure artifacts and cancellation', {timeout:60000},async()=>setup(async({lab,url})=>{
  lab.registerActor({id:'a',label:'A',network:'test'});
  const a=await lab.open({actorId:'a',owner:'test',projectId:'fixture',network:'test',allowedOrigins:[url],fixtureUrl:url,telegramFixture:true,allowedChats:[{peerId:'101',label:'Bot',kind:'bot'}]});
  await assert.rejects(lab.snapshot(a.id,'test'),/NEEDS_USER_LAUNCH/);
  await assert.rejects(lab.screenshot(a.id,'test'),/NEEDS_USER_LAUNCH/);
  await assert.rejects(lab.openChat(a.id,'test','999'),/CHAT_NOT_ALLOWED/);
  await lab.openChat(a.id,'test','101');
  const actors={a:{sessionId:a.id,owner:'test'}};
  const failure=await runScenario(lab,{name:'Fixture deliberate failure',actors,steps:[{op:'chat.assert',actor:'a',text:'never present',timeoutMs:0}]});
  assert.equal(failure.status,'failed');assert.equal(failure.steps[0].error,'TEXT_ASSERTION_FAILED');assert.ok(failure.artifacts.some(a=>a.type==='screenshot'));
  const cancel=new AbortController();cancel.abort();const stopped=await runScenario(lab,{name:'Fixture cancelled',actors,steps:[{op:'chat.send',actor:'a',text:'must not send'}]},{signal:cancel.signal});
  assert.equal(stopped.status,'cancelled');assert.ok(stopped.artifacts.every(a=>a.type!=='screenshot'));assert.doesNotMatch(JSON.stringify(await lab.readMessages(a.id,'test')),/must not send/);
  await assert.rejects(lab.stageFile(a.id,'test','../secret.env'),/INVALID_UPLOAD/);
  lab.registerActor({id:'wrong',label:'Wrong',network:'test'});
  const wrong=await lab.open({actorId:'wrong',owner:'test',projectId:'fixture',network:'test',allowedOrigins:[url],fixtureUrl:url+'/?mismatch=1',telegramFixture:true,allowedChats:[{peerId:'101',label:'Bot',kind:'bot'}]});
  await assert.rejects(lab.openChat(wrong.id,'test','101'),/UNEXPECTED_CHAT/);
  await assert.rejects(lab.readMessages(wrong.id,'test'),/UNEXPECTED_CHAT/);
}));
