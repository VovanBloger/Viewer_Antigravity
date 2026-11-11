import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openStore } from "./store.ts";

const WORKER = fileURLToPath(new URL("./testing/claim-worker.ts", import.meta.url));
const WORKERS = 6;
const TASKS = 240;

interface Worker {
  ready: Promise<void>;
  done: Promise<string[]>;
  stop: () => Promise<void>;
  start: (at: number) => void;
}

function startWorker(dbPath: string, owner: string, workerPath = WORKER): Worker {
  const child = spawn(process.execPath, ["--import", "tsx", workerPath, dbPath, "race", owner], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stdout = "";
  let stderr = "";
  let markReady: () => void = () => {};
  let failReady: (error: Error) => void = () => {};
  let isReady = false;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = () => { isReady = true; resolve(); };
    failReady = reject;
  });
  const timer = setTimeout(() => failReady(new Error(`worker ${owner}: READY timeout: ${stderr}`)), 15_000);
  void ready.finally(() => clearTimeout(timer)).catch(() => {});
  child.stdout!.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    if (stdout.includes("READY")) markReady();
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const done = new Promise<string[]>((resolve, reject) => {
    child.on("error", (error) => { failReady(error); reject(error); });
    child.on("close", (code) => {
      if (!isReady) failReady(new Error(`worker ${owner} exited before READY (${code}): ${stderr}`));
      const line = stdout.split("\n").find((l) => l.startsWith("CLAIMED "));
      if (code !== 0 || !line) reject(new Error(`worker ${owner} завершился с кодом ${code}: ${stderr}`));
      else resolve(JSON.parse(line.slice("CLAIMED ".length)) as string[]);
    });
  });
  // A worker can fail while the parent is still waiting for other workers' READY.
  void done.catch(() => {});
  const stop = async () => {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await done.catch(() => {});
  };
  return { ready, done, stop, start: (at) => child.send({ startAt: at }) };
}

test("гонка процессов: каждое задание выдаётся ровно один раз", { timeout: 120_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-queue-race-"));
  const dbPath = path.join(dir, "queue.db");
  const store = openStore({ dbPath });
  const workers: Worker[] = [];
  t.signal.addEventListener('abort', () => { workers.forEach(worker => { void worker.stop(); }); }, { once: true });
  try {
    store.registerProject({ id: "race", name: "Race", path: dir });
    const ids: string[] = [];
    for (let i = 0; i < TASKS; i += 1) {
      ids.push(
        store.submit({ projectId: "race", kind: "test", title: `t${i}`, goal: "g", acceptance: [], coordinatorId: "test" }).id,
      );
    }

    for (let i = 0; i < WORKERS; i++) workers.push(startWorker(dbPath, `w${i}`));
    await Promise.all(workers.map((w) => w.ready));
    const startAt = Date.now() + 300;
    workers.forEach((worker) => worker.start(startAt));
    const results = await Promise.all(workers.map((w) => w.done));

    const claimed = results.flat();
    assert.equal(claimed.length, TASKS, "суммарно выдано ровно столько, сколько было заданий");
    assert.deepEqual([...new Set(claimed)].sort(), [...ids].sort(), "ни одно задание не выдано дважды и не потеряно");

    const tasks = store.list({ projectId: "race" });
    assert.equal(tasks.length, TASKS);
    for (const task of tasks) {
      assert.equal(task.status, "IN_PROGRESS");
      assert.equal(task.attempt, 1);
      const index = results.findIndex((list) => list.includes(task.id));
      assert.equal(task.owner, `w${index}`);
      assert.equal(store.events(task.id).filter((e) => e.type === "claimed").length, 1);
    }
    const share = results.map((list) => list.length).join(" / ");
    assert.ok(results.filter((list) => list.length > 0).length >= 2, `задания должны разойтись по процессам: ${share}`);
    console.log(`распределение по процессам: ${share}`);
  } finally {
    await Promise.all(workers.map((worker) => worker.stop()));
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("сбой запуска worker отклоняет READY и не оставляет ожидающий процесс", { timeout: 20_000 }, async () => {
  const worker = startWorker(":memory:", "missing", path.join(path.dirname(WORKER), "missing-worker.ts"));
  try {
    await assert.rejects(worker.ready, /exited before READY/);
    await assert.rejects(worker.done, /worker missing/);
  } finally {
    await worker.stop();
  }
});
