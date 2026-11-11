import fs from 'node:fs';
import path from 'node:path';
import { openStore } from '@/runtime/queue/store';
import { isLocalDashboardRequest } from '@/runtime/dashboard/api';
import { createEventsResponse } from '@/runtime/dashboard/events';
import type { TaskStore } from '@/runtime/queue/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const json = (data: unknown, status: number) =>
    Response.json(data, {
      status,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });

  if (!isLocalDashboardRequest(request)) {
    return json({ error: 'LOCAL_SAME_ORIGIN_ONLY' }, 403);
  }

  const defaultDb = path.resolve('.viewer-live', 'agent-queue.db');
  const dbPath = process.env.VIEWER_QUEUE_DB || (fs.existsSync(defaultDb) ? defaultDb : undefined);
  if (!dbPath) {
    return json({ error: 'Set VIEWER_QUEUE_DB to the shared queue path before starting Viewer.' }, 503);
  }

  let store: TaskStore | undefined;
  try {
    store = openStore({ dbPath });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 503);
  }

  return createEventsResponse(request, store);
}
