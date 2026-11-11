import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BrowserLab } from './lab.ts';
import { openStore } from '../queue/store.ts';
import type { TaskStore } from '../queue/types.ts';
import { redactDeep } from '../queue/redact.ts';
import { initBrowserRoot } from './defaults.ts';
import { runScenario, type PaymentAdapter, type Scenario } from './scenario.ts';

/** A separate stdio service keeps browser processes alive across coordinator calls. */
export function createBrowserServer(lab: BrowserLab, store: TaskStore, options:{payments?:PaymentAdapter}={}) {
  const server = new McpServer({ name: 'viewer-browser', version: '0.1.0' });
  const session = { sessionId: z.string(), owner: z.string().min(1) };
  const result = async (run: () => unknown | Promise<unknown>) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(redactDeep(await run())) }] }; }
    catch (e) { const message=e instanceof Error?e.message:'';return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: /^[A-Z_]+$/.test(message)?message:'BROWSER_ACTION_FAILED' }) }] }; }
  };
  server.registerTool('list_browser_sessions', { description: 'List sessions and actors. No cookies, profile files or authorization data are returned.', inputSchema: {} }, () => result(() => ({ actors: lab.listActors(), sessions: lab.list() })));
  server.registerTool('register_browser_actor', { description: 'Register a dedicated test actor. Login is performed by the human in the visible browser, outside model tools.', inputSchema: { id: z.string(), label: z.string(), network: z.enum(['test', 'production']) } }, a => result(() => lab.registerActor(a)));
  server.registerTool('browser_actor_policy', { description:'Read operator-approved test peers and app origins for an actor. Only the local operator can edit chat-policy.json.',inputSchema:{actorId:z.string()} },a=>result(()=>lab.actorPolicy(a.actorId)));
  server.registerTool('open_browser_session', { description: 'Lease one isolated persistent Chromium profile. Project and operator-written chat-policy.json are required. allowedOrigins and peerIds can narrow the policy but cannot expand it. Login remains human-only.', inputSchema: { actorId: z.string(), owner: z.string().min(1), projectId: z.string(), network: z.enum(['test','production']), allowedOrigins: z.array(z.string().url()),peerIds:z.array(z.string()).optional() } }, a => result(async () => {
    if (!store.listProjects().some(p => p.id === a.projectId)) throw new Error('UNKNOWN_PROJECT');
    const {peerIds,...input}=a;
    if(!peerIds)return lab.open(input);
    const policy=lab.actorPolicy(a.actorId);if(peerIds.some(peer=>!policy.chats.some(c=>c.peerId===peer)))throw new Error('CHAT_NOT_ALLOWED');
    return lab.open({...input,allowedChats:policy.chats.filter(c=>peerIds.includes(c.peerId))});
  }));
  server.registerTool('browser_snapshot', { description: 'Read text and JavaScript errors from the single allowed Mini App frame.', inputSchema: session }, a => result(() => lab.snapshot(a.sessionId, a.owner)));
  server.registerTool('browser_click', { description: 'Click one exact button or link in the allowed app frame.', inputSchema: { ...session, role: z.enum(['button','link']), name: z.string() } }, a => result(async () => { await lab.click(a.sessionId, a.owner, a.role, a.name); return { ok: true }; }));
  server.registerTool('browser_fill', { description: 'Fill one labelled field in the allowed app frame.', inputSchema: { ...session, label: z.string(), value: z.string() } }, a => result(async () => { await lab.fill(a.sessionId, a.owner, a.label, a.value); return { ok: true }; }));
  server.registerTool('browser_screenshot', { description: 'Capture actual app pixels to a local artifact; excludes Telegram UI and login. App pixels are not automatically redacted.', inputSchema: session }, a => result(() => lab.screenshot(a.sessionId, a.owner)));
  server.registerTool('telegram_open_chat',{description:'Open one operator-approved numeric WebK peer and verify header/composer identity. No search through private chats.',inputSchema:{...session,peerId:z.string()}},a=>result(()=>lab.openChat(a.sessionId,a.owner,a.peerId)));
  server.registerTool('telegram_send_text',{description:'Submit a message in the verified active allowed test chat. A click is not proof of delivery; assert the resulting messages.',inputSchema:{...session,text:z.string().min(1).max(4096)}},a=>result(()=>lab.sendText(a.sessionId,a.owner,a.text)));
  server.registerTool('telegram_read_messages',{description:'Read up to 100 visible rendered messages from the selected allowed peer only. No full chat history/storage access.',inputSchema:{...session,limit:z.number().int().min(1).max(100).optional()}},a=>result(()=>lab.readMessages(a.sessionId,a.owner,a.limit)));
  server.registerTool('telegram_click_button',{description:'Click an exact reply button or inline button on one explicit message in the verified test chat.',inputSchema:{...session,kind:z.enum(['inline','reply']),name:z.string(),messageId:z.string().optional()}},a=>result(()=>lab.clickChatButton(a.sessionId,a.owner,a)));
  server.registerTool('telegram_stage_file',{description:'Stage a local artifact from the operator-managed browser uploads directory. Does not silently confirm Telegram media preview.',inputSchema:{...session,artifactId:z.string()}},a=>result(()=>lab.stageFile(a.sessionId,a.owner,a.artifactId)));
  server.registerTool('telegram_launch_app',{description:'Click a specific message button and wait for the unique approved Mini App frame.',inputSchema:{...session,messageId:z.string(),button:z.string()}},a=>result(()=>lab.launchMiniApp(a.sessionId,a.owner,a.messageId,a.button)));
  server.registerTool('telegram_return_to_chat',{description:'Close Mini App with Escape and reverify the selected peer. If unsupported returns MINI_APP_CLOSE_REQUIRES_HUMAN.',inputSchema:session},a=>result(()=>lab.returnToChat(a.sessionId,a.owner)));
  server.registerTool('telegram_widget_probe',{description:'Probe actual client-rendered Widget surface; QuickJS code is not executed through browser evaluation. Production private bot chat only; group Widgets require test network.',inputSchema:{...session,messageId:z.string()}},a=>result(()=>lab.widgetProbe(a.sessionId,a.owner,a.messageId)));
  server.registerTool('telegram_widget_action',{description:'Read or click an exact button within one scoped Widget renderer. Unsupported clients fail explicitly.',inputSchema:{...session,messageId:z.string(),action:z.enum(['snapshot','click']),name:z.string().optional()}},a=>result(()=>lab.widgetAction(a.sessionId,a.owner,a.messageId,a)));
  server.registerTool('telegram_chat_screenshot',{description:'Capture only the verified allowed active chat, never the sidebar or login screen. Pixels are not automatically redacted.',inputSchema:session},a=>result(()=>lab.chatScreenshot(a.sessionId,a.owner)));
  const actor=z.string(),messageId=z.string(),text=z.string(),name=z.string();
  const step=z.discriminatedUnion('op',[
    z.object({op:z.literal('chat.open'),actor,peerId:z.string()}),z.object({op:z.literal('chat.send'),actor,text}),z.object({op:z.literal('chat.assert'),actor,text,timeoutMs:z.number().min(0).max(30000).optional()}),
    z.object({op:z.literal('chat.button'),actor,kind:z.enum(['reply','inline']),name,messageId:messageId.optional()}),z.object({op:z.literal('chat.upload'),actor,artifactId:z.string()}),
    z.object({op:z.literal('app.launch'),actor,messageId,button:z.string()}),z.object({op:z.literal('app.return'),actor}),z.object({op:z.literal('app.click'),actor,role:z.enum(['button','link']),name}),z.object({op:z.literal('app.fill'),actor,label:z.string(),value:z.string()}),z.object({op:z.literal('app.assert'),actor,text,timeoutMs:z.number().min(0).max(30000).optional()}),
    z.object({op:z.literal('widget.assert'),actor,messageId,text}),z.object({op:z.literal('widget.click'),actor,messageId,name}),z.object({op:z.literal('screenshot'),actor,surface:z.enum(['app','chat'])}),z.object({op:z.literal('payment.simulate'),actor,paymentId:z.string(),outcome:z.enum(['paid','declined'])}),
  ]);
  server.registerTool('run_browser_scenario',{description:'Run deterministic multi-actor browser steps without a model loop. Reports distinguish fixture/live-browser and simulated payments. A payment adapter must be configured explicitly.',inputSchema:{name:z.string().min(1).max(200),actors:z.record(z.string(),z.object(session)),steps:z.array(step).min(1).max(100)}},(a,extra)=>result(()=>runScenario(lab,a as Scenario,{payments:options.payments,signal:extra.signal})));
  for (const action of ['pause','resume','close'] as const) {
    server.registerTool(`browser_${action}`, { description: `${action} the owned browser session. Pause yields browser interaction to the human.`, inputSchema: session }, a => result(async () => { await lab[action](a.sessionId, a.owner); return { ok: true }; }));
  }
  return server;
}

export async function main() {
  const store = openStore({ dbPath: process.env.VIEWER_QUEUE_DB });
  const browserRoot = process.env.VIEWER_BROWSER_ROOT ?? path.resolve('.viewer-live', 'browser');
  initBrowserRoot(browserRoot);
  const lab = new BrowserLab(browserRoot, process.env.VIEWER_HEADLESS === '1');
  const server = createBrowserServer(lab, store);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void lab.shutdown().finally(() => server.close()).finally(() => { store.close(); process.exit(0); });
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.stdin.on('close', stop);
  await server.connect(new StdioServerTransport());
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch(e => { console.error(e instanceof Error ? e.message : 'BROWSER_START_FAILED'); process.exit(1); });
