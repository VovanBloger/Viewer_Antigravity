import path from 'node:path';
import { CounterPilot } from '../../runtime/pilots/counter.ts';
import { startCounterFixture } from './http.ts';

async function main(){
const flag=process.argv.slice(2).find(arg=>arg.startsWith('--fixture-chat='));
if(!flag) throw new Error('Explicit --fixture-chat=<synthetic-id> required; this runner never connects a real bot.');
const chatId=Number(flag.slice('--fixture-chat='.length));
const db=process.env.DATABASE_PATH ?? path.resolve('.viewer-live','counter','application.db');
const pilot=new CounterPilot(db,{async call(){throw new Error('LIVE_BOT_TRANSPORT_NOT_CONFIGURED')}},{network:'test',allowedChatIds:[chatId],allowedUserIds:[1]});
const fixture=await startCounterFixture(pilot,{chatId,port:Number(process.env.PORT ?? 3200)});
console.log(JSON.stringify({mode:'fixture',url:fixture.url,realPayments:false,liveTelegram:false}));
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{
  if(stopping)return;stopping=true;
  void fixture.close().then(()=>{pilot.close();process.exit(0)}).catch(()=>process.exit(1));
});
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'COUNTER_START_FAILED');process.exit(1)});
