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
  // Use an explicit path so opening the dashboard never creates a different queue.
  if (!process.env.VIEWER_QUEUE_DB) return json({ error: 'Set VIEWER_QUEUE_DB to the shared queue path before starting Viewer.' },503);
  let store: TaskStore | undefined;
  try {
    store = openStore({ dbPath: process.env.VIEWER_QUEUE_DB });
    return await dashboardRequest(request, store);
  } catch (e) { return json(toServiceError(e),503); }
  finally { store?.close(); }
}
export { handle as GET, handle as POST };
