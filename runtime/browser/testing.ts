import type { Server } from 'node:http';
import { randomInt } from 'node:crypto';

/** Windows may allocate port 0 in Chromium's forbidden IRC range (6665–6669). */
export async function listenBrowserFixture(server:Server) {
  for(let attempt=0;attempt<20;attempt++) {
    try {
      await new Promise<void>((resolve,reject)=>{const error=(e:Error)=>{server.off('listening',ready);reject(e)};const ready=()=>{server.off('error',error);resolve()};server.once('error',error);server.once('listening',ready);server.listen(randomInt(20000,60000),'127.0.0.1')});return;
    } catch(e) {if((e as NodeJS.ErrnoException).code!=='EADDRINUSE')throw e;}
  }
  throw new Error('FIXTURE_PORT_UNAVAILABLE');
}
