import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/antigravity-bridge/route.ts';
import { openStore } from '../runtime/queue/store.ts';

test('antigravity-bridge route: creates tasks in SQLite and returns them in GET', async () => {
  // Use a temporary test SQLite database
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-bridge-test-'));
  const testDbPath = path.join(tmpDir, 'test-agent-queue.db');
  process.env.VIEWER_QUEUE_DB = testDbPath;

  try {
    const queue = [
      {
        id: 'test-item-1',
        pinNumber: 1,
        createdAt: '10:00:00',
        slotDeviceName: 'iPhone 16 Pro',
        priority: 'high',
        directiveId: 'responsive-320',
        note: 'Адаптировать отступы под 320px',
        element: {
          tag: 'div',
          className: 'p-4 rounded-xl',
          textSnippet: 'Test Card',
          rect: { top: 100, left: 20, width: 300, height: 100 },
          selector: 'main > div.card',
          sourceFile: 'components/TestCard.tsx',
          sourceLine: 42,
        },
        diffs: [],
      },
      {
        id: 'test-item-2',
        pinNumber: 2,
        createdAt: '10:05:00',
        slotDeviceName: 'Pixel 9 Pro',
        priority: 'normal',
        directiveId: 'screenshot-check',
        note: 'Сделать скриншот и сверить с референсом',
        element: {
          tag: 'button',
          className: 'btn-primary',
          textSnippet: 'Submit',
          rect: { top: 250, left: 20, width: 120, height: 40 },
          selector: 'main > button',
          sourceFile: 'components/TestBtn.tsx',
          sourceLine: 88,
        },
        diffs: [],
      },
    ];

    const postReq = new NextRequest('http://localhost:3000/api/antigravity-bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queue,
        markdownPrompt: '# Test Markdown Prompt',
        workspaceMeta: { url: 'http://localhost:3000', theme: 'dark', activeDevices: ['iPhone 16 Pro'] },
      }),
    });

    const postRes = await POST(postReq);
    assert.equal(postRes.status, 200);
    const postData = await postRes.json();

    assert.equal(postData.ok, true);
    assert.equal(postData.syncedCount, 2);
    assert.equal(Array.isArray(postData.tasks), true);
    assert.equal(postData.tasks.length, 2);

    const task1 = postData.tasks[0];
    assert.equal(task1.status, 'QUEUED');
    assert.equal(task1.kind, 'develop');
    assert.equal(task1.projectId, 'viewer');
    assert.equal(task1.title, 'Task from Workbench: responsive-320');
    assert.equal(task1.goal, 'Адаптировать отступы под 320px');
    assert.deepEqual(task1.constraints, ['Inspect in Viewer 2 Workbench']);

    const task2 = postData.tasks[1];
    assert.equal(task2.status, 'QUEUED');
    assert.equal(task2.kind, 'browser-check');
    assert.equal(task2.projectId, 'viewer');
    assert.equal(task2.title, 'Task from Workbench: screenshot-check');

    // Test GET returns tasks via store.listTasks({ limit: 50 })
    const getRes = await GET();
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();

    assert.equal(getData.ok, true);
    assert.equal(Array.isArray(getData.tasks), true);
    assert.equal(getData.tasks.length, 2);
    assert.equal(getData.count, 2);
    assert.equal(getData.tasks[0].id, task1.id);
    assert.equal(getData.tasks[1].id, task2.id);

    // Verify idempotency on second POST
    const postReq2 = new NextRequest('http://localhost:3000/api/antigravity-bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queue,
        markdownPrompt: '# Test Markdown Prompt Updated',
        workspaceMeta: { url: 'http://localhost:3000', theme: 'dark', activeDevices: ['iPhone 16 Pro'] },
      }),
    });

    const postRes2 = await POST(postReq2);
    const postData2 = await postRes2.json();
    assert.equal(postData2.ok, true);
    assert.equal(postData2.tasks.length, 2);
    assert.equal(postData2.tasks[0].id, task1.id);
    assert.equal(postData2.tasks[1].id, task2.id);

    // Check directly in SQLite using fresh store instance
    const verifyStore = openStore({ dbPath: testDbPath });
    const directTasks = verifyStore.listTasks({ limit: 50 });
    assert.equal(directTasks.length, 2);
    verifyStore.close();
  } finally {
    delete process.env.VIEWER_QUEUE_DB;
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
