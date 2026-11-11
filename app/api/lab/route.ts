import { openStore } from '@/runtime/queue/store';
import { dashboardRequest } from '@/runtime/dashboard/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  // Use an explicit path so opening the dashboard never creates a different queue.
  if (!process.env.VIEWER_QUEUE_DB) return Response.json({ error: 'Set VIEWER_QUEUE_DB to the shared queue path before starting Viewer.' }, { status: 503 });
  const store = openStore({ dbPath: process.env.VIEWER_QUEUE_DB });
  try { return await dashboardRequest(request, store); } finally { store.close(); }
}
export { handle as GET, handle as POST };
