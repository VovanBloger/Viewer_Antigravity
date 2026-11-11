import { NextRequest, NextResponse } from 'next/server';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openStore } from '@/runtime/queue/store.ts';
import type { SqliteTaskStore } from '@/runtime/queue/store.ts';
import type { AgentTask, TaskKind } from '@/runtime/queue/types.ts';
import type { AgentQueueItem } from '@/lib/antigravity-core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getLocalLanIp(): string {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const netList = interfaces[name];
      if (!netList) continue;
      for (const net of netList) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch {
    // Fallback
  }
  return '192.168.1.93';
}

const CONTEXT_FILE_PATH = path.join(os.tmpdir(), '.antigravity-viewer-context.json');
const TASKS_MD_PATH = path.join(os.tmpdir(), 'ANTIGRAVITY_TASKS.md');

let storeInstance: SqliteTaskStore | null = null;
let currentDbPath: string | null = null;

function getStore(): SqliteTaskStore {
  const dbPath = process.env.VIEWER_QUEUE_DB || path.join(process.cwd(), '.viewer-live', 'agent-queue.db');
  if (!storeInstance || currentDbPath !== dbPath) {
    if (storeInstance) {
      try {
        storeInstance.close();
      } catch {
        // ignore
      }
    }
    storeInstance = openStore({ dbPath });
    currentDbPath = dbPath;
    if (!storeInstance.getProject('viewer')) {
      storeInstance.registerProject({
        id: 'viewer',
        name: 'Viewer 2',
        path: process.cwd(),
        aliases: ['viewer2', 'workbench'],
      });
    }
  }
  return storeInstance;
}

export async function GET() {
  const lanIp = getLocalLanIp();
  const port = process.env.PORT || '3000';
  const localWifiUrl = `http://${lanIp}:${port}`;
  const publicAppUrl = process.env.APP_URL || `https://viewer-antigravity.local`;

  let lastSyncedAt: string | null = null;
  let syncedCount = 0;

  try {
    const raw = await fs.readFile(CONTEXT_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    lastSyncedAt = parsed.syncedAt || null;
    syncedCount = Array.isArray(parsed.queue) ? parsed.queue.length : 0;
  } catch {
    // No context file written yet
  }

  const store = getStore();
  const tasks = store.listTasks({ limit: 50 });

  return NextResponse.json({
    ok: true,
    lanIp,
    localWifiUrl,
    publicAppUrl,
    bridgeFile: '.antigravity-viewer-context.json',
    tasksMarkdownFile: 'ANTIGRAVITY_TASKS.md',
    lastSyncedAt,
    syncedCount,
    tasks,
    count: tasks.length,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { queue = [], markdownPrompt = '', workspaceMeta = {} } = body;
    const syncedAt = new Date().toISOString();

    const store = getStore();
    const syncedTasks: AgentTask[] = [];
    const updatedQueue: (AgentQueueItem & { taskId: string; taskStatus: string })[] = [];

    for (const item of queue as AgentQueueItem[]) {
      let task: AgentTask | undefined;

      if (item.taskId) {
        task = store.get(item.taskId);
      }

      const idempotencyKey = `wb-${item.id}`;
      if (!task) {
        const existingList = store.list({ projectId: 'viewer' });
        task = existingList.find((t) => t.idempotencyKey === idempotencyKey);
      }

      if (!task) {
        const isScreenshot =
          (item as { kind?: string }).kind === 'browser-check' ||
          Boolean(item.directiveId && item.directiveId.toLowerCase().includes('screenshot')) ||
          Boolean(item.note && (item.note.toLowerCase().includes('скриншот') || item.note.toLowerCase().includes('screenshot')));

        const kind: TaskKind = isScreenshot ? 'browser-check' : 'develop';
        const rawTitle = item.title || item.directiveId || item.id;
        const title = `Task from Workbench: ${rawTitle}`;
        const goal =
          (item.note && item.note.trim()) ||
          (item as { selector?: string }).selector ||
          item.element?.selector ||
          'Fix layout issue';

        task = store.submitTask({
          projectId: 'viewer',
          executorId: 'antigravity',
          coordinatorId: 'workbench',
          idempotencyKey,
          kind,
          title,
          goal,
          acceptance: ['Inspect in Viewer 2 Workbench and verify resolution'],
          constraints: ['Inspect in Viewer 2 Workbench'],
          meta: {
            workbenchItemId: item.id,
            pinNumber: item.pinNumber,
            slotDeviceName: item.slotDeviceName,
            sourceFile: item.element?.sourceFile,
            sourceLine: item.element?.sourceLine,
            tag: item.element?.tag,
            selector: item.element?.selector,
            componentName: item.element?.componentName,
            diffs: item.diffs,
          },
        });
      }

      syncedTasks.push(task);
      updatedQueue.push({
        ...item,
        taskId: task.id,
        taskStatus: task.status,
      });
    }

    const payload = {
      version: '2.0.0',
      syncedAt,
      workspaceMeta,
      queueCount: updatedQueue.length,
      queue: updatedQueue,
      tasks: syncedTasks,
    };

    await fs.writeFile(CONTEXT_FILE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
    if (markdownPrompt) {
      await fs.writeFile(TASKS_MD_PATH, markdownPrompt, 'utf-8');
    }

    return NextResponse.json({
      ok: true,
      syncedAt,
      syncedCount: updatedQueue.length,
      contextFile: '.antigravity-viewer-context.json',
      tasksFile: 'ANTIGRAVITY_TASKS.md',
      tasks: syncedTasks,
      count: syncedTasks.length,
      queue: updatedQueue,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to write Antigravity context bridge',
      },
      { status: 500 }
    );
  }
}
