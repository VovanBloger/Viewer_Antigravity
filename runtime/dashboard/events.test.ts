import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../queue/store.ts';
import { createEventsResponse } from './events.ts';

test('SSE events: rejects cross-origin and serves text/event-stream with init payload', async () => {
  const store = openStore({ dbPath: ':memory:' });
  store.registerProject({ id: 'viewer', name: 'Viewer', path: process.cwd() });
  store.submit({
    projectId: 'viewer',
    kind: 'develop',
    title: 'Initial Task',
    goal: 'Test SSE streaming',
    acceptance: ['Works'],
    coordinatorId: 'test',
  });

  // Cross-origin check
  const crossOriginReq = new Request('http://localhost:3100/api/lab/events', {
    headers: { origin: 'https://evil.com' },
  });
  const crossRes = createEventsResponse(crossOriginReq, store);
  assert.equal(crossRes.status, 403);

  // Valid local request
  const ac = new AbortController();
  const validReq = new Request('http://localhost:3100/api/lab/events', {
    signal: ac.signal,
  });
  const res = createEventsResponse(validReq, store, { intervalMs: 50 });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  assert.equal(res.headers.get('cache-control'), 'no-cache, no-transform');

  const reader = res.body?.getReader();
  assert.ok(reader);

  const decoder = new TextDecoder();
  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  const text = decoder.decode(firstChunk.value);
  assert.match(text, /^event: init\ndata: /);
  assert.match(text, /"title":"Initial Task"/);

  ac.abort();
  await reader.cancel();
});
