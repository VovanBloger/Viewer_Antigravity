import { NextRequest, NextResponse } from 'next/server';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

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

  return NextResponse.json({
    ok: true,
    lanIp,
    localWifiUrl,
    publicAppUrl,
    bridgeFile: '.antigravity-viewer-context.json',
    tasksMarkdownFile: 'ANTIGRAVITY_TASKS.md',
    lastSyncedAt,
    syncedCount,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { queue = [], markdownPrompt = '', workspaceMeta = {} } = body;
    const syncedAt = new Date().toISOString();

    const payload = {
      version: '2.0.0',
      syncedAt,
      workspaceMeta,
      queueCount: queue.length,
      queue,
    };

    await fs.writeFile(CONTEXT_FILE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
    if (markdownPrompt) {
      await fs.writeFile(TASKS_MD_PATH, markdownPrompt, 'utf-8');
    }

    return NextResponse.json({
      ok: true,
      syncedAt,
      syncedCount: queue.length,
      contextFile: '.antigravity-viewer-context.json',
      tasksFile: 'ANTIGRAVITY_TASKS.md',
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
