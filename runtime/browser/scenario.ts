import { randomUUID } from 'node:crypto';
import { BrowserLab } from './lab.ts';

export interface ScenarioActor { sessionId:string;owner:string }
type ActorStep = {actor:string};
export type ScenarioStep = ActorStep & (
  {op:'chat.open';peerId:string} | {op:'chat.send';text:string} |
  {op:'chat.assert';text:string;timeoutMs?:number} |
  {op:'chat.button';kind:'reply'|'inline';name:string;messageId?:string} |
  {op:'chat.upload';artifactId:string} |
  {op:'app.launch';messageId:string;button:string} | {op:'app.return'} |
  {op:'app.click';role:'button'|'link';name:string} | {op:'app.fill';label:string;value:string} |
  {op:'app.assert';text:string;timeoutMs?:number} |
  {op:'widget.assert';messageId:string;text:string} | {op:'widget.click';messageId:string;name:string} |
  {op:'screenshot';surface:'app'|'chat'} |
  {op:'payment.simulate';paymentId:string;outcome:'paid'|'declined'}
);
export interface Scenario {name:string;actors:Record<string,ScenarioActor>;steps:ScenarioStep[]}
export interface PaymentAdapter {simulate(input:{paymentId:string;outcome:'paid'|'declined';actor:string}):Promise<void>}
export interface ScenarioResult {
  id:string;name:string;evidence:'fixture'|'live-browser';status:'passed'|'failed'|'cancelled';
  steps:{index:number;op:string;status:'passed'|'failed';error?:string;simulated?:true}[];
  artifacts:{artifactId:string;type:string}[];
}

/** Deterministic actions; no model or Telegram API calls are made by the runner. */
export async function runScenario(lab:BrowserLab,scenario:Scenario,options:{signal?:AbortSignal;payments?:PaymentAdapter;timeoutMs?:number}={}):Promise<ScenarioResult> {
  if(!scenario.name || scenario.name.length>200 || scenario.steps.length>100 || !scenario.steps.length || !Object.keys(scenario.actors).length) throw new Error('INVALID_SCENARIO');
  const sessions=lab.list();
  const bindings=Object.values(scenario.actors).map(a=>{
    const s=sessions.find(s=>s.id===a.sessionId&&s.owner===a.owner);
    if(!s || s.paused) throw new Error('SCENARIO_SESSION_NOT_AVAILABLE');return s;
  });
  if(new Set(bindings.map(s=>s.projectId)).size!==1 || new Set(bindings.map(s=>s.network)).size!==1) throw new Error('SCENARIO_ENVIRONMENT_MISMATCH');
  if(new Set(bindings.map(s=>s.mode)).size!==1) throw new Error('SCENARIO_EVIDENCE_MISMATCH');
  const report:ScenarioResult={id:randomUUID(),name:scenario.name,evidence:bindings.every(s=>s.mode==='fixture')?'fixture':'live-browser',status:'passed',steps:[],artifacts:[]};
  const end=Date.now()+Math.min(Math.max(options.timeoutMs??60_000,1),300_000);
  let last:ScenarioActor|undefined,lastSurface:'app'|'chat'='chat';
  const check=()=>{if(options.signal?.aborted) throw new Error('SCENARIO_CANCELLED');if(Date.now()>end)throw new Error('SCENARIO_TIMEOUT');};
  async function assertText(read:()=>Promise<string>,text:string,timeoutMs=5000) {
    const deadline=Math.min(end,Date.now()+Math.min(Math.max(timeoutMs,0),30_000));
    while(true){check();if((await read()).includes(text))return;if(Date.now()>=deadline)throw new Error('TEXT_ASSERTION_FAILED');await new Promise(r=>setTimeout(r,100));}
  }
  for(let index=0;index<scenario.steps.length;index++) {
    const step=scenario.steps[index],a=scenario.actors[step.actor];last=a;
    try {
      check();if(!a)throw new Error('UNKNOWN_SCENARIO_ACTOR');
      switch(step.op) {
        case 'chat.open':await lab.openChat(a.sessionId,a.owner,step.peerId);lastSurface='chat';break;
        case 'chat.send':await lab.sendText(a.sessionId,a.owner,step.text);lastSurface='chat';break;
        case 'chat.assert':await assertText(async()=>JSON.stringify((await lab.readMessages(a.sessionId,a.owner)).messages),step.text,step.timeoutMs);lastSurface='chat';break;
        case 'chat.button':await lab.clickChatButton(a.sessionId,a.owner,step);lastSurface='chat';break;
        case 'chat.upload':await lab.stageFile(a.sessionId,a.owner,step.artifactId);lastSurface='chat';break;
        case 'app.launch':await lab.launchMiniApp(a.sessionId,a.owner,step.messageId,step.button);lastSurface='app';break;
        case 'app.return':await lab.returnToChat(a.sessionId,a.owner);lastSurface='chat';break;
        case 'app.click':await lab.click(a.sessionId,a.owner,step.role,step.name);lastSurface='app';break;
        case 'app.fill':await lab.fill(a.sessionId,a.owner,step.label,step.value);lastSurface='app';break;
        case 'app.assert':await assertText(async()=>(await lab.snapshot(a.sessionId,a.owner)).text,step.text,step.timeoutMs);lastSurface='app';break;
        case 'widget.assert': {
          const state=await lab.widgetAction(a.sessionId,a.owner,step.messageId,{action:'snapshot'});
          if(!('text' in state) || !state.text?.includes(step.text))throw new Error('WIDGET_ASSERTION_FAILED');lastSurface='chat';break;
        }
        case 'widget.click':await lab.widgetAction(a.sessionId,a.owner,step.messageId,{action:'click',name:step.name});lastSurface='chat';break;
        case 'screenshot':report.artifacts.push(await(step.surface==='app'?lab.screenshot(a.sessionId,a.owner):lab.chatScreenshot(a.sessionId,a.owner)));break;
        case 'payment.simulate':if(!options.payments)throw new Error('SIMULATED_PAYMENT_ADAPTER_REQUIRED');await options.payments.simulate({...step,actor:step.actor});break;
        default:throw new Error('UNKNOWN_SCENARIO_OPERATION');
      }
      report.steps.push({index,op:step.op,status:'passed',...(step.op==='payment.simulate'?{simulated:true as const}:{})});
    } catch(e) {
      // Do not export locator errors, URLs, input values, or potentially sensitive page content.
      const raw=e instanceof Error?e.message:'ACTION_FAILED';
      const error=/^[A-Z_]+$/.test(raw)?raw:'BROWSER_ACTION_FAILED';
      report.status=error==='SCENARIO_CANCELLED'?'cancelled':'failed';report.steps.push({index,op:step.op,status:'failed',error});
      if(last && report.status!=='cancelled')try{report.artifacts.push(await(lastSurface==='app'?lab.screenshot(last.sessionId,last.owner):lab.chatScreenshot(last.sessionId,last.owner)));}catch{/* login/wrong-chat/paused surfaces must never be captured */}
      break;
    }
  }
  report.artifacts.push(lab.saveScenarioReport(report));return report;
}
