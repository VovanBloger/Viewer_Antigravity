import { isLocalDashboardRequest } from './api';
import { listTasks, toPublicTask } from '../service';
import type { TaskStore } from '../queue/types';

export interface EventsStreamOptions {
  intervalMs?: number;
  sessions?: unknown[];
}

export function createEventsResponse(request: Request, store: TaskStore, options: EventsStreamOptions = {}) {
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

  const encoder = new TextEncoder();
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    try {
      store.close();
    } catch {
      // ignore
    }
  };

  request.signal.addEventListener('abort', cleanup);

  function getSnapshot() {
    const tasks = listTasks(store, { limit: 100 }).map(t => toPublicTask(t, { compact: true }));
    const projects = store.listProjects().map(({ id, name }) => ({ id, name }));
    const sessions = options.sessions || [];
    return { tasks, sessions, projects };
  }

  function getFingerprint(tasks: Array<{ id: string; version: number; status: string; progress?: string }>) {
    return tasks.map(t => `${t.id}:${t.version}:${t.status}:${t.progress || ''}`).join('|');
  }

  const intervalMs = options.intervalMs ?? 5000;

  const stream = new ReadableStream({
    start(controller) {
      try {
        const initial = getSnapshot();
        let lastFingerprint = getFingerprint(initial.tasks);

        // Immediate initial snapshot for connected client
        controller.enqueue(
          encoder.encode(
            `event: init\ndata: ${JSON.stringify({ tasks: initial.tasks, sessions: initial.sessions, projects: initial.projects })}\n\n`
          )
        );

        // Interval to check version/updates and send heartbeats
        timer = setInterval(() => {
          if (closed || request.signal.aborted) {
            cleanup();
            return;
          }

          try {
            const current = getSnapshot();
            const currentFingerprint = getFingerprint(current.tasks);

            if (currentFingerprint !== lastFingerprint) {
              lastFingerprint = currentFingerprint;
              controller.enqueue(
                encoder.encode(
                  `event: update\ndata: ${JSON.stringify({ tasks: current.tasks, sessions: current.sessions, projects: current.projects })}\n\n`
                )
              );
            } else {
              controller.enqueue(encoder.encode(`event: ping\ndata: "heartbeat"\n\n`));
            }
          } catch {
            cleanup();
            try {
              controller.close();
            } catch {
              // ignore
            }
          }
        }, intervalMs);
      } catch (err) {
        cleanup();
        try {
          controller.error(err);
        } catch {
          // ignore
        }
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
