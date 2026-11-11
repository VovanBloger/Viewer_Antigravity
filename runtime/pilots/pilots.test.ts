import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { CounterPilot, type BotTransport, type PilotMethod } from './counter.ts';
import { parseAdapter, loadAdapter, registerProjectFromManifest } from './adapters.ts';
import { startCounterFixture } from '../../examples/counter/http.ts';
import { openStore } from '../queue/store.ts';

test('ProjectAdapter parser and loader validate manifests securely', () => {
  const fakeLookup = (id: string) => (id === 'counter' || id === 'game' ? { id } : undefined);

  // Load actual fixture adapter file
  const counterFile = path.resolve('adapters/counter.fixture.json');
  const counterAdapter = loadAdapter(counterFile, fakeLookup);
  assert.equal(counterAdapter.id, 'counter');
  assert.equal(counterAdapter.projectId, 'counter');
  assert.equal(counterAdapter.mode, 'fixture');
  assert.equal(counterAdapter.network, 'test');

  // Load actual template adapter file
  const gameFile = path.resolve('adapters/gametycone.template.json');
  const gameAdapter = loadAdapter(gameFile, fakeLookup);
  assert.equal(gameAdapter.id, 'gametycone');
  assert.equal(gameAdapter.mode, 'template');
  assert.ok(gameAdapter.blockedReasons && gameAdapter.blockedReasons.length > 0);

  // Rejects unknown project
  assert.throws(() => {
    parseAdapter({
      version: 1,
      id: 'bad',
      projectId: 'unknown-proj',
      network: 'test',
      botId: 'test-bot',
      mode: 'template',
      blockedReasons: ['Reason']
    }, fakeLookup);
  }, /UNKNOWN_PROJECT/);

  // Rejects embedded secret tokens
  assert.throws(() => {
    parseAdapter({
      version: 1,
      id: 'bad',
      projectId: 'counter',
      network: 'test',
      botId: 'test-bot',
      mode: 'fixture',
      command: {
        executable: 'node',
        args: ['--token=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11']
      }
    }, fakeLookup);
  }, /SECRETS_FORBIDDEN_IN_MANIFEST/);

  // Rejects fixture mode on production network
  assert.throws(() => {
    parseAdapter({
      version: 1,
      id: 'bad',
      projectId: 'counter',
      network: 'production',
      botId: 'test-bot',
      mode: 'fixture',
      command: { executable: 'node', args: [] }
    }, fakeLookup);
  }, /FIXTURE_REQUIRES_TEST_NETWORK/);
});

test('CounterPilot enforces scope, handles messages, callbacks, widgets and outbox delivery', async () => {
  const sentPayloads: Array<{ method: PilotMethod; payload: Record<string, unknown> }> = [];
  const mockTransport: BotTransport = {
    async call(method, payload) {
      sentPayloads.push({ method, payload });
      if (method === 'sendWidget') {
        return { ok: true, result: { message_id: 505 } };
      }
      return { ok: true, result: { message_id: 100 } };
    }
  };

  const pilot = new CounterPilot(':memory:', mockTransport, {
    network: 'test',
    allowedChatIds: [1001],
    allowedUserIds: [2001]
  });

  // Rejects unauthorized chat / user
  await assert.rejects(async () => {
    await pilot.receive({
      update_id: 1,
      message: { message_id: 1, chat: { id: 9999, type: 'private' }, from: { id: 2001 }, text: '/start' }
    });
  }, /PILOT_SCOPE_DENIED/);

  // Authorized /start command
  const res1 = await pilot.receive({
    update_id: 1,
    message: { message_id: 1, chat: { id: 1001, type: 'private' }, from: { id: 2001 }, text: '/start' }
  });
  assert.equal(res1.duplicate, false);
  assert.equal(res1.count, 0);

  // Duplicate update_id is safely ignored
  const res1Dup = await pilot.receive({
    update_id: 1,
    message: { message_id: 1, chat: { id: 1001, type: 'private' }, from: { id: 2001 }, text: '/start' }
  });
  assert.equal(res1Dup.duplicate, true);

  // Increment via text /inc
  const resInc = await pilot.receive({
    update_id: 2,
    message: { message_id: 2, chat: { id: 1001, type: 'private' }, from: { id: 2001 }, text: '/inc' }
  });
  assert.equal(resInc.count, 1);

  // Increment via callback query
  const resCb = await pilot.receive({
    update_id: 3,
    callback_query: {
      id: 'cb-1',
      from: { id: 2001 },
      message: { message_id: 3, chat: { id: 1001, type: 'private' }, from: { id: 2001 } },
      data: 'inc'
    }
  });
  assert.equal(resCb.count, 2);

  // Widget creation
  await pilot.receive({
    update_id: 4,
    message: { message_id: 4, chat: { id: 1001, type: 'private' }, from: { id: 2001 }, text: '/widget' }
  });

  // Widget query (interaction)
  const resWidget = await pilot.receive({
    update_id: 5,
    widget_query: {
      id: 'wq-1',
      from: { id: 2001 },
      chat: { id: 1001, type: 'private' },
      message_id: 505,
      type: { type: 'data' },
      data: 'inc'
    }
  });
  assert.equal(resWidget.count, 3);

  // Simulated payments
  await pilot.receive({
    update_id: 6,
    message: { message_id: 5, chat: { id: 1001, type: 'private' }, from: { id: 2001 }, text: '/pay_test ord-123' }
  });

  // Outbox delivery status: all should be 'sent'
  const statuses = pilot.deliveryStatus();
  const sentRow = statuses.find(s => s.state === 'sent');
  assert.ok(sentRow && sentRow.count > 0);

  pilot.close();
});

test('startCounterFixture runs local HTTP server and executes idempotent increments', async () => {
  const pilot = new CounterPilot(':memory:', {
    async call() { return { ok: true }; }
  }, {
    network: 'test',
    allowedChatIds: [777],
    allowedUserIds: [1]
  });

  const fixture = await startCounterFixture(pilot, { chatId: 777, port: 0 });
  assert.ok(fixture.url.startsWith('http://127.0.0.1:'));

  // Health check
  const healthRes = await fetch(`${fixture.url}/health`);
  assert.equal(healthRes.status, 200);
  const healthJson = await healthRes.json() as { ok: boolean; mode: string };
  assert.equal(healthJson.ok, true);
  assert.equal(healthJson.mode, 'fixture');

  // Count check
  const countRes = await fetch(`${fixture.url}/api/count`);
  assert.equal(countRes.status, 200);
  const countJson = await countRes.json() as { count: number };
  assert.equal(countJson.count, 0);

  // Increment with requestId
  const reqId = 'test-req-001';
  const incRes1 = await fetch(`${fixture.url}/api/increment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: reqId })
  });
  assert.equal(incRes1.status, 200);
  const incJson1 = await incRes1.json() as { count: number; duplicate: boolean };
  assert.equal(incJson1.count, 1);
  assert.equal(incJson1.duplicate, false);

  // Repeat same request: idempotent deduplication
  const incRes2 = await fetch(`${fixture.url}/api/increment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: reqId })
  });
  assert.equal(incRes2.status, 200);
  const incJson2 = await incRes2.json() as { count: number; duplicate: boolean };
  assert.equal(incJson2.count, 1);
  assert.equal(incJson2.duplicate, true);

  await fixture.close();
  pilot.close();
});

test('registerProjectFromManifest registers project from viewer.project.json into TaskStore', () => {
  const store = openStore({ dbPath: ':memory:' });
  try {
    const manifestPath = path.resolve('viewer.project.json');
    const project = registerProjectFromManifest(manifestPath, store);
    assert.equal(project.id, 'viewer');
    assert.equal(project.name, 'Viewer Antigravity 2.0 Studio');
    assert.equal(store.getProject('viewer')?.id, 'viewer');
  } finally {
    store.close();
  }
});
