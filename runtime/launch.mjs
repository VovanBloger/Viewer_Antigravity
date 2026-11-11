import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';

// Resolve dependencies and state from this checkout, independently of the client's cwd.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const services = { agents: './mcp/server.ts', browser: './browser/mcp.ts' };
const service = services[process.argv[2]];
if (!service) { console.error('Usage: node runtime/launch.mjs agents|browser'); process.exit(2); }
process.chdir(root);
process.env.VIEWER_QUEUE_DB ??= path.join(root, '.viewer-live', 'agent-queue.db');
process.env.VIEWER_BROWSER_ROOT ??= path.join(root, '.viewer-live', 'browser');
register();
try { const module = await import(service); await module.main(); }
catch (e) { console.error(e instanceof Error ? e.message : 'SERVICE_START_FAILED'); process.exit(1); }
