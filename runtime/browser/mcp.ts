import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BrowserLab } from './lab.ts';
import { openStore } from '../queue/store.ts';
import type { TaskStore } from '../queue/types.ts';
import { redactDeep } from '../queue/redact.ts';

/** A separate stdio service keeps browser processes alive across coordinator calls. */
export function createBrowserServer(lab: BrowserLab, store: TaskStore) {
  const server = new McpServer({ name: 'viewer-browser', version: '0.1.0' });
  const session = { sessionId: z.string(), owner: z.string().min(1) };
  const result = async (run: () => unknown | Promise<unknown>) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(redactDeep(await run())) }] }; }
    catch (e) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : 'BROWSER_ERROR' }) }] }; }
  };
  server.registerTool('list_browser_sessions', { description: 'List sessions and actors. No cookies, profile files or authorization data are returned.', inputSchema: {} }, () => result(() => ({ actors: lab.listActors(), sessions: lab.list() })));
  server.registerTool('register_browser_actor', { description: 'Register a dedicated test actor. Login is performed by the human in the visible browser, outside model tools.', inputSchema: { id: z.string(), label: z.string(), network: z.enum(['test', 'production']) } }, a => result(() => lab.registerActor(a)));
  server.registerTool('open_browser_session', { description: 'Lease one isolated persistent Chromium profile. The project must already be registered. Open Mini App in Telegram manually until the Telegram adapter is configured. allowedOrigins restrict app operations; Telegram authorization pages cannot be read.', inputSchema: { actorId: z.string(), owner: z.string().min(1), projectId: z.string(), network: z.enum(['test','production']), allowedOrigins: z.array(z.string().url()).min(1) } }, a => result(async () => {
    if (!store.listProjects().some(p => p.id === a.projectId)) throw new Error('UNKNOWN_PROJECT');
    return lab.open(a);
  }));
  server.registerTool('browser_snapshot', { description: 'Read text and JavaScript errors from the single allowed Mini App frame.', inputSchema: session }, a => result(() => lab.snapshot(a.sessionId, a.owner)));
  server.registerTool('browser_click', { description: 'Click one exact button or link in the allowed app frame.', inputSchema: { ...session, role: z.enum(['button','link']), name: z.string() } }, a => result(async () => { await lab.click(a.sessionId, a.owner, a.role, a.name); return { ok: true }; }));
  server.registerTool('browser_fill', { description: 'Fill one labelled field in the allowed app frame.', inputSchema: { ...session, label: z.string(), value: z.string() } }, a => result(async () => { await lab.fill(a.sessionId, a.owner, a.label, a.value); return { ok: true }; }));
  server.registerTool('browser_screenshot', { description: 'Capture actual app pixels to a local artifact; excludes Telegram UI and login. App pixels are not automatically redacted.', inputSchema: session }, a => result(() => lab.screenshot(a.sessionId, a.owner)));
  for (const action of ['pause','resume','close'] as const) {
    server.registerTool(`browser_${action}`, { description: `${action} the owned browser session. Pause yields browser interaction to the human.`, inputSchema: session }, a => result(async () => { await lab[action](a.sessionId, a.owner); return { ok: true }; }));
  }
  return server;
}

async function main() {
  const store = openStore({ dbPath: process.env.VIEWER_QUEUE_DB });
  const lab = new BrowserLab(process.env.VIEWER_BROWSER_ROOT ?? path.resolve('.viewer-live', 'browser'), process.env.VIEWER_HEADLESS === '1');
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
