import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserLab } from './lab.ts';

test('real Chromium: isolated actors, owner and pause checks, actual screenshot', { timeout: 60_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-browser-'));
  const server = http.createServer((_, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<body><label>Value<input aria-label="Value"></label><button onclick="localStorage.setItem('v', document.querySelector('input').value); document.querySelector('output').textContent=localStorage.v">Save</button><output>empty</output></body>`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const lab = new BrowserLab(root, true);
  try {
    lab.registerActor({ id: 'a', label: 'Actor A', network: 'test' });
    lab.registerActor({ id: 'b', label: 'Actor B', network: 'test' });
    const base = { owner: 'worker', projectId: 'fixture', network: 'test' as const, allowedOrigins: [url], fixtureUrl: url };
    const a = await lab.open({ ...base, actorId: 'a' });
    const b = await lab.open({ ...base, actorId: 'b' });
    await assert.rejects(lab.open({ ...base, actorId: 'a' }), /PROFILE_BUSY/);
    await lab.fill(a.id, 'worker', 'Value', 'actor-a');
    await lab.click(a.id, 'worker', 'button', 'Save');
    assert.match((await lab.snapshot(a.id, 'worker')).text, /actor-a/);
    assert.doesNotMatch((await lab.snapshot(b.id, 'worker')).text, /actor-a/);
    await assert.rejects(lab.snapshot(a.id, 'stranger'), /SESSION_NOT_OWNED/);
    lab.pause(a.id, 'worker');
    await assert.rejects(lab.snapshot(a.id, 'worker'), /SESSION_PAUSED/);
    lab.resume(a.id, 'worker');
    const shot = await lab.screenshot(a.id, 'worker');
    assert.deepEqual([...fs.readFileSync(path.join(root, 'artifacts', shot.artifactId)).subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    await lab.close(a.id, 'worker');
    assert.equal(lab.list().length, 1);
  } finally {
    await lab.shutdown();
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    // root is the exact mkdtemp directory created above, never an arbitrary user path.
    fs.rmSync(root, { recursive: true, force: true });
  }
});
