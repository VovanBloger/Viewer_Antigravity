import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserLab } from './lab.ts';
import { listenBrowserFixture } from './testing.ts';

test('real Chromium: isolated actors, owner and pause checks, actual screenshot', { timeout: 60_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-browser-'));
  const server = http.createServer((_, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<body><label>Value<input aria-label="Value"></label><button onclick="localStorage.setItem('v', document.querySelector('input').value); document.querySelector('output').textContent=localStorage.v">Save</button><output>empty</output></body>`);
  });
  await listenBrowserFixture(server);
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

test('BrowserLab: pruneArtifacts removes expired files and enforces FIFO maxCount', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-prune-test-'));
  const lab = new BrowserLab(root, true);
  const artifactsDir = path.join(root, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  try {
    const now = Date.now();
    const offsetsHours = [10, 8, 2, 1, 0.1]; // shot-1 oldest, shot-5 newest
    for (let i = 1; i <= 5; i++) {
      const filePath = path.join(artifactsDir, `shot-${i}.png`);
      fs.writeFileSync(filePath, `artifact-${i}`);
      const mtime = new Date(now - offsetsHours[i - 1] * 3600 * 1000);
      fs.utimesSync(filePath, mtime, mtime);
    }

    // 1. Prune files older than 5 hours (should delete shot-1 and shot-2)
    lab.pruneArtifacts(5 * 3600 * 1000, 100);
    let remaining = fs.readdirSync(artifactsDir);
    assert.deepEqual(remaining.sort(), ['shot-3.png', 'shot-4.png', 'shot-5.png']);

    // 2. Prune by maxCount = 2 (should delete oldest remaining: shot-3.png)
    lab.pruneArtifacts(24 * 3600 * 1000, 2);
    remaining = fs.readdirSync(artifactsDir);
    assert.deepEqual(remaining.sort(), ['shot-4.png', 'shot-5.png']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BrowserLab: recoverActorLease automatically recovers dead lease for test network', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-lease-test-'));
  const lab = new BrowserLab(root, true);
  try {
    lab.registerActor({ id: 'actor-test', label: 'Test Actor', network: 'test' });
    lab.registerActor({ id: 'actor-prod', label: 'Prod Actor', network: 'production' });

    const profilesDir = path.join(root, 'profiles');
    fs.mkdirSync(profilesDir, { recursive: true });

    // Mock stale lease with non-existent PID (99999999)
    const deadPid = 99999999;
    const testLock = path.join(profilesDir, 'test-actor-test.lease');
    fs.writeFileSync(testLock, JSON.stringify({ pid: deadPid, owner: 'crashed-worker' }));

    // Should recover automatically for network 'test' without requiring confirmation
    const res = lab.recoverActorLease('actor-test', 'test');
    assert.equal(res.recovered, true);
    assert.equal(fs.existsSync(testLock), false);

    // Production network must require operator confirmation
    const prodLock = path.join(profilesDir, 'production-actor-prod.lease');
    fs.writeFileSync(prodLock, JSON.stringify({ pid: deadPid, owner: 'crashed-worker' }));
    assert.throws(() => lab.recoverActorLease('actor-prod', 'production'), /RECOVERY_REQUIRES_OPERATOR/);

    // With confirmation, production can be recovered
    const prodRes = lab.recoverActorLease('actor-prod', 'production', 'browser-processes-confirmed-stopped');
    assert.equal(prodRes.recovered, true);
    assert.equal(fs.existsSync(prodLock), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
