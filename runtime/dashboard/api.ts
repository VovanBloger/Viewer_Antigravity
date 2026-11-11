import type { TaskStore } from '../queue/types.ts';
import { getTask, toPublicTask, toServiceError } from '../service.ts';

function localRequest(request: Request) {
  const target = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) return false;
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  return !origin || origin === target.origin;
}

export async function dashboardRequest(request: Request, store: TaskStore) {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
  if (!localRequest(request)) return json({ error: 'LOCAL_SAME_ORIGIN_ONLY' }, 403);
  try {
    if (request.method === 'GET') {
      const id = new URL(request.url).searchParams.get('id');
      if (id) return json({ task: toPublicTask(getTask(store, id), { compact: true }), events: store.events(id).slice(-30) });
      return json({ projects: store.listProjects(), tasks: store.list({ limit: 100 }).map(t => toPublicTask(t, { compact: true })) });
    }
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON_REQUIRED' }, 415);
    const raw = await request.text();
    if (raw.length > 40_000) return json({ error: 'REQUEST_TOO_LARGE' }, 413);
    const body = JSON.parse(raw);
    if (body.action === 'submit') {
      // The browser form cannot override directories, credentials or notification channels.
      const { projectId, title, goal, acceptance, idempotencyKey } = body;
      return json({ task: toPublicTask(store.submit({ projectId, title, goal, acceptance, idempotencyKey, kind: 'develop', coordinatorId: 'viewer', executorId: 'antigravity', notify: { telegram: false, tts: false } }), { compact: true }) });
    }
    if (body.action === 'cancel') return json({ task: toPublicTask(store.cancel(body.taskId, 'viewer'), { compact: true }) });
    if (body.action === 'verdict' && ['approve', 'request_changes'].includes(body.decision)) return json({ task: toPublicTask(store.submitVerdict(body.taskId, { decision: body.decision, notes: body.notes, by: 'viewer' }), { compact: true }) });
    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (e) { return json(toServiceError(e), 400); }
}
