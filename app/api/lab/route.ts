import fs from 'node:fs';
import path from 'node:path';
import { openStore } from '@/runtime/queue/store';
import { dashboardRequest, isLocalDashboardRequest } from '@/runtime/dashboard/api';
import { toServiceError } from '@/runtime/service';
import type { TaskStore } from '@/runtime/queue/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  const json = (data: unknown, status: number) => Response.json(data, { status, headers: { 'cache-control':'no-store','x-content-type-options':'nosniff' } });
  // Reject untrusted origins before opening the local database or revealing its setup.
  if (!isLocalDashboardRequest(request)) return json({ error:'LOCAL_SAME_ORIGIN_ONLY' },403);

  const defaultDb = path.resolve('.viewer-live', 'agent-queue.db');
  const dbPath = process.env.VIEWER_QUEUE_DB || (fs.existsSync(defaultDb) ? defaultDb : undefined);
  if (!dbPath) return json({ error: 'Set VIEWER_QUEUE_DB to the shared queue path before starting Viewer.' }, 503);

  const artifactsDir = path.resolve('.viewer-live', 'browser', 'artifacts');
  let store: TaskStore | undefined;
  try {
    store = openStore({ dbPath });
    return await dashboardRequest(request, store, { artifactsDir });
  } catch (e) { return json(toServiceError(e),503); }
  finally { store?.close(); }
}
export { handle as GET, handle as POST };
