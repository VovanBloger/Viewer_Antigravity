import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BrowserLab } from './lab.ts';
import { createBrowserServer } from './mcp.ts';
import { openStore } from '../queue/store.ts';

test('browser MCP rejects unknown project and Telegram auth origin before launching', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-browser-mcp-'));
  const store = openStore({ dbPath: path.join(root, 'queue.db') });
  store.registerProject({ id: 'viewer', name: 'Viewer', path: root });
  const lab = new BrowserLab(path.join(root, 'browser'), true);
  const server = createBrowserServer(lab, store);
  const client = new Client({ name: 'test', version: '1' });
  const [a,b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(a), server.connect(b)]);
    await client.callTool({ name: 'register_browser_actor', arguments: { id: 'test-a', label: 'A', network: 'test' } });
    const base = { actorId: 'test-a', owner: 'codex', network: 'test', allowedOrigins: ['https://web.telegram.org'] };
    const unknown = await client.callTool({ name: 'open_browser_session', arguments: { ...base, projectId: 'typo' } });
    assert.equal(unknown.isError, true);
    assert.match(JSON.stringify(unknown.content), /UNKNOWN_PROJECT/);
    const auth = await client.callTool({ name: 'open_browser_session', arguments: { ...base, projectId: 'viewer' } });
    assert.equal(auth.isError, true);
    assert.match(JSON.stringify(auth.content), /INVALID_APP_ORIGIN/);
    assert.deepEqual(lab.list(), []);
    const restarted = new BrowserLab(path.join(root, 'browser'), true);
    assert.equal(restarted.listActors()[0].id, 'test-a');
    assert.throws(() => restarted.registerActor({ id: 'test-a', label: 'A', network: 'production' }), /NETWORK_MISMATCH/);
  } finally {
    await client.close(); await server.close(); await lab.shutdown(); store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('initBrowserRoot populates 10 testDC actors and 2 production actors with strict chat policy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-browser-defaults-'));
  try {
    const { initBrowserRoot, DEFAULT_ACTORS } = require('./defaults.ts');
    initBrowserRoot(root);
    assert.equal(fs.existsSync(path.join(root, 'actors.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'chat-policy.json')), true);

    const lab = new BrowserLab(root, true);
    const actors = lab.listActors();
    assert.equal(actors.length, 12);
    assert.equal(actors.filter(a => a.network === 'test').length, 10);
    assert.equal(actors.filter(a => a.network === 'production').length, 2);

    const policy = lab.actorPolicy('test-actor-01');
    assert.equal(policy.network, 'test');
    assert.ok(policy.chats.some(c => c.peerId === '101'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
