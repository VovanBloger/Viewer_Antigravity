import type { TaskStore } from '../queue/types.ts';
import { getTask, listTasks, toPublicTask, toServiceError } from '../service.ts';
import { redactDeep } from '../queue/redact.ts';

const MAX_BODY_BYTES = 40_000;

async function readBoundedBody(request: Request): Promise<string | undefined> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) return undefined;
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return undefined; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function isLocalDashboardRequest(request: Request) {
  const target = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) return false;
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  return !origin || origin === target.origin;
}

export async function dashboardRequest(request: Request, store: TaskStore) {
  const json = (data: unknown, status = 200) => Response.json(redactDeep(data), { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  if (!isLocalDashboardRequest(request)) return json({ error: 'LOCAL_SAME_ORIGIN_ONLY' }, 403);
  try {
    if (request.method === 'GET') {
      const id = new URL(request.url).searchParams.get('id');
      if (id) return json({ task: toPublicTask(getTask(store, id), { compact: true }), events: store.events(id).slice(-30) });
      return json({ projects: store.listProjects().map(({id,name}) => ({id,name})), tasks: listTasks(store, { limit: 100 }).map(t => toPublicTask(t, { compact: true })) });
    }
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'JSON_REQUIRED' }, 415);
    const raw = await readBoundedBody(request);
    if (raw === undefined) return json({ error: 'REQUEST_TOO_LARGE' }, 413);
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'INVALID_REQUEST' }, 400);
    if (body.action === 'submit') {
      // The browser form cannot override directories, credentials or notification channels.
      const { projectId, title, goal, acceptance, idempotencyKey } = body;
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) return json({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
      return json({ task: toPublicTask(store.submit({ projectId, title, goal, acceptance, idempotencyKey, kind: 'develop', coordinatorId: 'viewer', executorId: 'antigravity', notify: { telegram: false, tts: false } }), { compact: true }) });
    }
    if (body.action === 'cancel' || body.action === 'verdict') {
      if (typeof body.taskId !== 'string' || !body.taskId) return json({ error:'TASK_ID_REQUIRED' },400);
      if (!Number.isSafeInteger(body.version) || body.version < 0) return json({ error:'TASK_VERSION_REQUIRED' },400);
      const task = getTask(store,body.taskId);
      if (task.version !== body.version) return json({ error:'TASK_CHANGED',message:'Задание изменилось. Обновите данные перед действием.' },409);
      if (body.action === 'cancel') return json({ task: toPublicTask(store.cancel(body.taskId, 'viewer'), { compact: true }) });
      if (!['approve', 'request_changes'].includes(body.decision)) return json({ error:'INVALID_VERDICT' },400);
      if (body.notes !== undefined && typeof body.notes !== 'string') return json({ error:'INVALID_NOTES' },400);
      if (body.decision === 'request_changes' && !body.notes?.trim()) return json({ error:'REVIEW_NOTES_REQUIRED' },400);
      return json({ task: toPublicTask(store.submitVerdict(body.taskId, { decision: body.decision, notes: body.notes, by: 'viewer' }), { compact: true }) });
    }
    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (e) { return json(toServiceError(e), 400); }
}
