import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CounterPilot } from '../../runtime/pilots/counter.ts';

const HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Counter pilot fixture</title><style>body{font:18px system-ui;max-width:32rem;margin:3rem auto;padding:1rem;background:#101724;color:#eef}button{font:inherit;padding:1rem;border-radius:1rem}output{display:block;font-size:4rem;margin:2rem 0}small{color:#adbad0}</style><body><h1>Counter Mini App</h1><small>LOCAL FIXTURE · no Telegram authorization · payments simulated</small><output aria-label="Count">…</output><button id="increment">+1</button><p role="alert"></p><script>
var pending=null;function show(data){document.querySelector('output').textContent=data.count}
fetch('/api/count').then(function(r){return r.json()}).then(show);
document.getElementById('increment').addEventListener('click',async function(){var button=this;button.disabled=true;pending=pending||crypto.randomUUID();try{var r=await fetch('/api/increment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:pending})});if(!r.ok)throw Error('Request failed');show(await r.json());pending=null;document.querySelector('[role=alert]').textContent=''}catch(e){document.querySelector('[role=alert]').textContent='Retry to repeat the same request safely.'}finally{button.disabled=false}});
</script></body></html>`;

/** This endpoint deliberately cannot masquerade as a signed-initData production backend. */
export async function startCounterFixture(pilot:CounterPilot,options:{chatId:number;port?:number}) {
  if(pilot.network!=='test') throw new Error('FIXTURE_REQUIRES_TEST_NETWORK');
  pilot.count(options.chatId); // validate the explicit dedicated test scope before listening
  const server=http.createServer(async(req,res)=>{
    const send=(status:number,data:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data))};
    try {
      const url=new URL(req.url ?? '/',`http://${req.headers.host ?? 'invalid'}`);
      if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==url.origin)){send(403,{error:'LOCAL_FIXTURE_ONLY'});return}
      if(req.method==='GET'&&url.pathname==='/health'){send(200,{ok:true,mode:'fixture',network:'test'});return}
      if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self' https://web.telegram.org"});res.end(HTML);return}
      if(req.method==='GET'&&url.pathname==='/api/count'){send(200,{count:pilot.count(options.chatId),mode:'fixture'});return}
      if(req.method==='POST'&&url.pathname==='/api/increment'){
        if(req.headers['content-type']?.split(';')[0]!=='application/json'){send(415,{error:'JSON_REQUIRED'});return}
        let size=0;const chunks:Buffer[]=[];
        for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>1024){send(413,{error:'REQUEST_TOO_LARGE'});return}chunks.push(bytes)}
        const body=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {requestId?:unknown};
        if(!body||typeof body.requestId!=='string'){send(400,{error:'REQUEST_ID_REQUIRED'});return}
        send(200,pilot.incrementFixture(options.chatId,body.requestId));return;
      }
      send(404,{error:'NOT_FOUND'});
    }catch{send(400,{error:'INVALID_FIXTURE_REQUEST'})}
  });
  server.requestTimeout=5000;server.headersTimeout=5000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port ?? 0,'127.0.0.1',resolve)});
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  pilot.setMiniAppUrl(url);
  return {url,async close(){server.closeIdleConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}};
}
