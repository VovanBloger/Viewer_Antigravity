import assert from "node:assert/strict";
import test from "node:test";

import { openStore } from "./queue/store.ts";
import type { SqliteTaskStore } from "./queue/store.ts";
import { QueueError } from "./queue/types.ts";
import type { TaskReport, TaskSpec } from "./queue/types.ts";
import { describeProgress, getTask, listTasks, toPublicTask, toServiceError, waitTask } from "./service.ts";

const T0 = Date.parse("2026-11-11T10:00:00.000Z");
const FAKE_TOKEN = `123456789:AAF${"x".repeat(32)}`;

function setup(): { store: SqliteTaskStore; clock: { t: number } } {
  const clock = { t: T0 };
  const store = openStore({ dbPath: ":memory:", now: () => clock.t });
  store.registerProject({ id: "viewer", name: "Viewer", path: "C:\\work\\viewer" });
  return { store, clock };
}

function spec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return { projectId: "viewer", kind: "develop", title: "Задача", goal: "Цель", acceptance: ["готово"], coordinatorId: "codex", ...overrides };
}

function report(overrides: Partial<TaskReport> = {}): TaskReport {
  return { summary: "Сделано", changedFiles: [], checks: [], artifacts: [], openQuestions: [], ...overrides };
}

test("toPublicTask: краткий вид обрезает тексты, убирает служебные поля и добавляет progress", () => {
  const { store } = setup();
  const task = store.submit(spec({ idempotencyKey: "k1", meta: { a: 1 }, leaseMs: 120_000 }));
  store.claimNext({ projectId: "viewer", executorId: "antigravity", owner: "w1" });
  store.report(task.id, "w1", report({ summary: "s".repeat(5000), checks: [{ command: "npm test", ok: true, details: "d".repeat(3000) }] }));
  const reported = store.submitVerdict(task.id, { decision: "request_changes", by: "codex", notes: "n".repeat(4000) });

  const compact = toPublicTask(reported, { compact: true });
  assert.ok(compact.report && compact.report.summary.length < 2100);
  assert.match(compact.report.summary, /обрезано, всего 5000/);
  assert.ok((compact.report.checks[0].details ?? "").length < 600);
  assert.ok((compact.verdicts[0].notes ?? "").length < 1100);
  assert.equal(compact.progress, "Возвращено на исправление, раунд 1; ждёт исполнителя");
  for (const key of ["idempotencyKey", "meta", "leaseMs", "notify"]) assert.ok(!(key in compact), key);

  const full = toPublicTask(reported);
  assert.equal(full.report?.summary.length, 5000);
  assert.equal(full.verdicts[0].notes?.length, 4000);
  assert.equal(full.idempotencyKey, "k1");
  assert.equal(full.progress, undefined);
  store.close();
});

test("toPublicTask: поля вне контракта не выдаются, секреты вырезаются", () => {
  const { store } = setup();
  const task = store.submit(spec());
  const dirty = { ...task, title: `токен ${FAKE_TOKEN}`, internalRowId: 42 };
  const out = toPublicTask(dirty);
  assert.ok(!("internalRowId" in out));
  assert.ok(!JSON.stringify(out).includes(FAKE_TOKEN));
  assert.match(out.title, /\[REDACTED\]/);
  store.close();
});

test("describeProgress по статусам", () => {
  const { store, clock } = setup();
  const task = store.submit(spec());
  assert.equal(describeProgress(task), "В очереди, ждёт исполнителя");
  const claimed = store.claimNext({ projectId: "viewer", executorId: "antigravity", owner: "w1" });
  assert.ok(claimed);
  assert.equal(describeProgress(claimed, clock.t + 40_000), "В работе у w1, heartbeat 40 с назад");
  assert.equal(describeProgress(claimed, clock.t + 12 * 60_000), "В работе у w1, heartbeat 12 мин назад");
  const cancelling = store.cancel(task.id, "codex");
  assert.match(describeProgress(cancelling, clock.t), /запрошена отмена/);
  assert.equal(describeProgress(store.acknowledgeCancel(task.id, "w1")), "Отменено");
  store.close();
});

test("getTask / listTasks: ошибки и порядок «новые первыми»", () => {
  const { store, clock } = setup();
  assert.throws(() => getTask(store, "T-000999"), (e: unknown) => e instanceof QueueError && e.code === "NOT_FOUND");
  assert.throws(() => listTasks(store, { projectId: "ghost" }), (e: unknown) => e instanceof QueueError && e.code === "UNKNOWN_PROJECT");
  const ids: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    clock.t += 1000;
    ids.push(store.submit(spec({ title: `t${i}` })).id);
  }
  assert.deepEqual(listTasks(store, { limit: 2 }).map((t) => t.id), [ids[4], ids[3]]);
  assert.equal(listTasks(store).length, 5);
  assert.deepEqual(toServiceError(new QueueError("NOT_FOUND", "нет")), { code: "NOT_FOUND", message: "нет" });
  assert.equal(toServiceError(new Error(`boom ${FAKE_TOKEN}`)).message, "boom [REDACTED]");
  store.close();
});

test("waitTask: heartbeat не будит, отчёт будит; тайм-аут и немедленные ответы", async () => {
  const store = openStore({ dbPath: ":memory:" });
  store.registerProject({ id: "viewer", name: "Viewer", path: "C:\\work\\viewer" });
  const task = store.submit(spec());

  const idle = await waitTask(store, task.id, { sinceVersion: task.version, timeoutMs: 50 });
  assert.equal(idle.changed, false);
  assert.equal(idle.task.status, "QUEUED");

  const claimed = store.claimNext({ projectId: "viewer", executorId: "antigravity", owner: "w1" });
  assert.ok(claimed);
  const stale = await waitTask(store, task.id, { sinceVersion: task.version, timeoutMs: 5000 });
  assert.equal(stale.changed, true);
  assert.equal(stale.task.status, "IN_PROGRESS");

  setTimeout(() => store.heartbeat(task.id, "w1"), 50);
  const beat = await waitTask(store, task.id, { sinceVersion: claimed.version, timeoutMs: 700 });
  assert.equal(beat.changed, false, "одного heartbeat недостаточно, чтобы разбудить координатора");
  assert.equal(beat.task.status, "IN_PROGRESS");

  setTimeout(() => store.report(task.id, "w1", report()), 100);
  const done = await waitTask(store, task.id, { timeoutMs: 5000 });
  assert.equal(done.changed, true);
  assert.equal(done.task.status, "REPORTED");

  const started = Date.now();
  const again = await waitTask(store, task.id, { timeoutMs: 5000 });
  assert.equal(again.changed, false);
  assert.ok(Date.now() - started < 1000, "REPORTED без sinceVersion отдаётся сразу");

  await assert.rejects(waitTask(store, "T-000999", { timeoutMs: 10 }), (e: unknown) => e instanceof QueueError && e.code === "NOT_FOUND");
  store.close();
});
