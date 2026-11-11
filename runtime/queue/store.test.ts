import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openStore } from "./store.ts";
import type { SqliteTaskStore } from "./store.ts";
import { DEFAULT_EXECUTOR_ID, DEFAULT_LEASE_MS, MAX_DELIVERY_ATTEMPTS, MAX_FIX_ROUNDS, QueueError } from "./types.ts";
import type { QueueErrorCode, TaskReport, TaskSpec } from "./types.ts";

const T0 = Date.parse("2026-11-11T10:00:00.000Z");

interface Ctx {
  store: SqliteTaskStore;
  dir: string;
  dbPath: string;
  clock: { t: number };
  now: () => number;
}

/** Создаёт хранилище во временном каталоге с управляемыми часами и двумя проектами. */
function setup(run: (ctx: Ctx) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-queue-store-"));
    const dbPath = path.join(dir, "queue.db");
    const clock = { t: T0 };
    const now = () => clock.t;
    const store = openStore({ dbPath, now });
    store.registerProject({ id: "viewer", name: "Viewer Antigravity", path: "C:\\work\\viewer", aliases: ["va", "Вьювер"] });
    store.registerProject({ id: "crm", name: "Журнал CRM", path: "C:\\work\\crm" });
    try {
      await run({ store, dir, dbPath, clock, now });
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function spec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    projectId: "viewer",
    kind: "develop",
    title: "Задача",
    goal: "Сделать хорошо",
    acceptance: ["npm run build проходит"],
    coordinatorId: "codex",
    ...overrides,
  };
}

function report(overrides: Partial<TaskReport> = {}): TaskReport {
  return {
    summary: "Готово",
    revision: "f417417a0c3b9d2e5f6a7b8c9d0e1f2a3b4c5d6e",
    changedFiles: ["lib/a.ts"],
    checks: [{ command: "npm test", ok: true }],
    artifacts: [{ type: "log", path: "C:\\tmp\\out.log" }],
    openQuestions: [],
    model: "gemini-flash",
    ...overrides,
  };
}

function throwsCode(fn: () => unknown, code: QueueErrorCode): void {
  assert.throws(fn, (error: unknown) => error instanceof QueueError && error.code === code, `ожидался QueueError(${code})`);
}

const claim = (store: SqliteTaskStore, owner = "s1", projectId = "viewer", executorId = DEFAULT_EXECUTOR_ID) =>
  store.claimNext({ projectId, executorId, owner });

test(
  "счастливый путь: submit → claim → heartbeat → report → approve",
  setup(({ store, clock }) => {
    const created = store.submit(spec());
    assert.equal(created.id, "T-000001");
    assert.equal(created.status, "QUEUED");
    assert.equal(created.version, 1);
    assert.equal(created.executorId, DEFAULT_EXECUTOR_ID);
    assert.equal(created.round, 0);
    assert.equal(created.attempt, 0);
    assert.equal(created.cancelRequested, false);
    assert.deepEqual(created.verdicts, []);
    assert.equal(created.createdAt, "2026-11-11T10:00:00.000Z");

    clock.t += 1000;
    const claimed = claim(store);
    assert.ok(claimed);
    assert.equal(claimed.id, created.id);
    assert.equal(claimed.status, "IN_PROGRESS");
    assert.equal(claimed.owner, "s1");
    assert.equal(claimed.attempt, 1);
    assert.equal(claimed.leaseExpiresAt, clock.t + DEFAULT_LEASE_MS);
    assert.equal(claimed.heartbeatAt, clock.t);
    assert.equal(claimed.version, 2);
    assert.equal(claim(store, "s2"), null);

    clock.t += 60_000;
    const beat = store.heartbeat(created.id, "s1", 120_000);
    assert.equal(beat.cancelRequested, false);
    assert.equal(beat.task.leaseExpiresAt, clock.t + 120_000);
    assert.equal(beat.task.version, 3);
    store.heartbeat(created.id, "s1");
    store.heartbeat(created.id, "s1");

    const reported = store.report(created.id, "s1", report());
    assert.equal(reported.status, "REPORTED");
    assert.equal(reported.leaseExpiresAt, undefined);
    assert.deepEqual(reported.report, report());
    assert.equal(reported.version, 6);

    const approved = store.submitVerdict(created.id, { decision: "approve", by: "codex", notes: "ок" });
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.verdicts.length, 1);
    assert.deepEqual(
      { ...approved.verdicts[0], at: "" },
      { decision: "approve", by: "codex", notes: "ок", round: 0, at: "" },
    );
    assert.equal(approved.failure, undefined);
    assert.equal(approved.version, 7);
    assert.deepEqual(store.get(created.id), approved);

    // подряд идущие heartbeat схлопнуты в одно событие
    assert.deepEqual(
      store.events(created.id).map((e) => e.type),
      ["submitted", "claimed", "heartbeat", "reported", "verdict"],
    );
    assert.equal(store.events(created.id)[0].actor, "codex");
    assert.equal(store.events(created.id)[0].taskId, created.id);

    // после терминального статуса ничего сделать нельзя
    throwsCode(() => store.submitVerdict(created.id, { decision: "approve", by: "codex" }), "INVALID_STATE");
    throwsCode(() => store.cancel(created.id, "codex"), "INVALID_STATE");
    throwsCode(() => store.report(created.id, "s1", report()), "INVALID_STATE");
  }),
);

test(
  "request_changes: раунды до RETURNED после MAX_FIX_ROUNDS",
  setup(({ store }) => {
    const { id } = store.submit(spec());
    for (let round = 0; round < MAX_FIX_ROUNDS; round += 1) {
      const claimed = claim(store, `s${round}`);
      assert.equal(claimed?.round, round);
      assert.equal(claimed?.attempt, 1);
      store.report(id, `s${round}`, report({ summary: `раунд ${round}` }));
      const back = store.submitVerdict(id, { decision: "request_changes", by: "codex", notes: `исправь ${round}` });
      assert.equal(back.status, "QUEUED");
      assert.equal(back.round, round + 1);
      assert.equal(back.attempt, 0);
      assert.equal(back.owner, undefined);
      assert.equal(back.leaseExpiresAt, undefined);
      // прошлый отчёт и замечания видны исполнителю
      assert.equal(back.report?.summary, `раунд ${round}`);
      assert.equal(back.verdicts.at(-1)?.notes, `исправь ${round}`);
      assert.equal(back.verdicts.at(-1)?.round, round);
    }
    const last = claim(store, "final");
    assert.equal(last?.round, MAX_FIX_ROUNDS);
    assert.equal(last?.report?.summary, `раунд ${MAX_FIX_ROUNDS - 1}`);
    store.report(id, "final", report());
    const returned = store.submitVerdict(id, { decision: "request_changes", by: "codex", notes: "всё ещё плохо" });
    assert.equal(returned.status, "RETURNED");
    assert.equal(returned.round, MAX_FIX_ROUNDS);
    assert.equal(returned.failure?.code, "FIX_ROUNDS_EXHAUSTED");
    assert.equal(returned.verdicts.length, MAX_FIX_ROUNDS + 1);
    assert.equal(claim(store, "x"), null);
    assert.equal(store.events(id).filter((e) => e.type === "requeued").length, MAX_FIX_ROUNDS);
  }),
);

test(
  "submit: проверка входных данных и неизвестный проект без запасного варианта",
  setup(({ store }) => {
    throwsCode(() => store.submit(spec({ projectId: "nope" })), "UNKNOWN_PROJECT");
    throwsCode(() => store.submit(spec({ projectId: "Viewer Anti" })), "UNKNOWN_PROJECT");
    assert.equal(store.list().length, 0);

    throwsCode(() => store.submit(spec({ projectId: " " })), "INVALID_INPUT");
    throwsCode(() => store.submit(spec({ title: "" })), "INVALID_INPUT");
    throwsCode(() => store.submit(spec({ goal: "  " })), "INVALID_INPUT");
    throwsCode(() => store.submit(spec({ coordinatorId: "" })), "INVALID_INPUT");
    throwsCode(() => store.submit(spec({ kind: "deploy" as TaskSpec["kind"] })), "INVALID_INPUT");
    throwsCode(() => store.submit(spec({ acceptance: "x" as unknown as string[] })), "INVALID_INPUT");
    throwsCode(() => store.submit(spec({ leaseMs: 59_999 })), "INVALID_INPUT");
    throwsCode(() => store.submit(spec({ leaseMs: 24 * 60 * 60 * 1000 + 1 })), "INVALID_INPUT");
    throwsCode(() => store.submit(spec({ notify: { telegram: true } })), "INVALID_INPUT");
    assert.equal(store.list().length, 0);

    assert.equal(store.submit(spec({ leaseMs: 60_000, notify: { telegram: true, chatId: 5 } })).leaseMs, 60_000);
    assert.equal(store.get("T-999999"), undefined);
    assert.equal(store.get("мусор"), undefined);
    throwsCode(() => store.cancel("T-999999", "codex"), "NOT_FOUND");
    throwsCode(() => store.heartbeat("T-999999", "s1"), "NOT_FOUND");
    throwsCode(() => store.report("T-999999", "s1", report()), "NOT_FOUND");
    throwsCode(() => store.submitVerdict("T-999999", { decision: "approve", by: "c" }), "NOT_FOUND");
  }),
);

test(
  "проекты: алиасы, регистр, канонический id, конфликты",
  setup(({ store }) => {
    assert.equal(store.getProject("VIEWER")?.id, "viewer");
    assert.equal(store.getProject("va")?.id, "viewer");
    assert.equal(store.getProject(" вьювер ")?.id, "viewer");
    // никакого нечёткого поиска по имени
    assert.equal(store.getProject("Viewer Antigravity"), undefined);
    assert.equal(store.getProject("view"), undefined);
    assert.deepEqual(
      store.listProjects().map((p) => p.id),
      ["crm", "viewer"],
    );

    const task = store.submit(spec({ projectId: "VA" }));
    assert.equal(task.projectId, "viewer");
    assert.equal(store.list({ projectId: "Va" }).length, 1);
    assert.equal(store.list({ projectId: "crm" }).length, 0);
    assert.equal(store.list({ projectId: "unknown" }).length, 0);
    assert.equal(claim(store, "s1", "Вьювер")?.id, task.id);
    throwsCode(() => claim(store, "s1", "ghost"), "UNKNOWN_PROJECT");

    // алиас, занятый другим проектом
    throwsCode(() => store.registerProject({ id: "other", name: "O", path: "p", aliases: ["VA"] }), "INVALID_INPUT");
    throwsCode(() => store.registerProject({ id: "va", name: "O", path: "p" }), "INVALID_INPUT");
    throwsCode(() => store.registerProject({ id: "", name: "O", path: "p" }), "INVALID_INPUT");
    // повторная регистрация обновляет запись
    const updated = store.registerProject({ id: "viewer", name: "V2", path: "D:\\v", aliases: ["v2"] });
    assert.deepEqual(updated, { id: "viewer", name: "V2", path: "D:\\v", aliases: ["v2"] });
    assert.equal(store.getProject("va"), undefined);
    assert.equal(store.listProjects().length, 2);
  }),
);

test(
  "idempotencyKey уникален в пределах координатора",
  setup(({ store }) => {
    const a = store.submit(spec({ idempotencyKey: "k1" }));
    const again = store.submit(spec({ idempotencyKey: "k1", title: "другое" }));
    assert.equal(again.id, a.id);
    assert.equal(again.title, "Задача");
    const other = store.submit(spec({ idempotencyKey: "k1", coordinatorId: "claude" }));
    assert.notEqual(other.id, a.id);
    const noKey1 = store.submit(spec());
    const noKey2 = store.submit(spec());
    assert.notEqual(noKey1.id, noKey2.id);
    assert.equal(store.list().length, 4);
    assert.equal(store.list({ coordinatorId: "claude" }).length, 1);
    assert.equal(store.events(a.id).length, 1);
  }),
);

test(
  "cancel во всех состояниях",
  setup(({ store }) => {
    // QUEUED → CANCELLED
    const queued = store.submit(spec());
    const c1 = store.cancel(queued.id, "codex");
    assert.equal(c1.status, "CANCELLED");
    assert.equal(c1.version, 2);
    assert.equal(claim(store), null);
    throwsCode(() => store.cancel(queued.id, "codex"), "INVALID_STATE");

    // REPORTED → CANCELLED
    const second = store.submit(spec());
    claim(store);
    store.report(second.id, "s1", report());
    assert.equal(store.cancel(second.id, "codex").status, "CANCELLED");
    throwsCode(() => store.submitVerdict(second.id, { decision: "approve", by: "codex" }), "INVALID_STATE");

    // IN_PROGRESS → cancelRequested → heartbeat видит → acknowledgeCancel
    const third = store.submit(spec());
    claim(store);
    throwsCode(() => store.acknowledgeCancel(third.id, "s1"), "INVALID_STATE");
    const requested = store.cancel(third.id, "codex");
    assert.equal(requested.status, "IN_PROGRESS");
    assert.equal(requested.cancelRequested, true);
    assert.equal(requested.version, 3);
    // повторный запрос ничего не меняет
    assert.equal(store.cancel(third.id, "codex").version, 3);
    const beat = store.heartbeat(third.id, "s1");
    assert.equal(beat.cancelRequested, true);
    throwsCode(() => store.acknowledgeCancel(third.id, "чужой"), "LEASE_LOST");
    const acked = store.acknowledgeCancel(third.id, "s1");
    assert.equal(acked.status, "CANCELLED");
    assert.equal(acked.report, undefined);
    assert.deepEqual(
      store.events(third.id).map((e) => e.type),
      ["submitted", "claimed", "cancel_requested", "heartbeat", "cancelled"],
    );

    // отчёт после запроса отмены: отчёт сохраняется, статус CANCELLED
    const fourth = store.submit(spec());
    claim(store);
    store.cancel(fourth.id, "codex");
    const late = store.report(fourth.id, "s1", report({ summary: "успел" }));
    assert.equal(late.status, "CANCELLED");
    assert.equal(late.report?.summary, "успел");

    // терминальные FAILED / APPROVED
    const fifth = store.submit(spec());
    claim(store);
    store.fail(fifth.id, "s1", { code: "EXECUTOR_ERROR", reason: "нет" });
    throwsCode(() => store.cancel(fifth.id, "codex"), "INVALID_STATE");
    throwsCode(() => store.cancel(queued.id, ""), "INVALID_INPUT");
  }),
);

test(
  "LEASE_LOST: чужой владелец и истёкший срок",
  setup(({ store, clock }) => {
    const { id } = store.submit(spec({ leaseMs: 60_000 }));
    throwsCode(() => store.heartbeat(id, "s1"), "LEASE_LOST"); // ещё не выдано
    const claimed = claim(store, "s1");
    assert.equal(claimed?.leaseExpiresAt, clock.t + 60_000);

    throwsCode(() => store.heartbeat(id, "s2"), "LEASE_LOST");
    throwsCode(() => store.report(id, "s2", report()), "LEASE_LOST");
    throwsCode(() => store.fail(id, "s2", { code: "X", reason: "y" }), "LEASE_LOST");
    assert.equal(store.get(id)?.status, "IN_PROGRESS");
    assert.equal(store.get(id)?.version, 2);

    clock.t += 59_999;
    store.heartbeat(id, "s1"); // продлили на 60 с
    clock.t += 60_000; // ровно на границе — уже истёк
    throwsCode(() => store.heartbeat(id, "s1"), "LEASE_LOST");

    // Потерянный исполнитель может ещё менять файлы: повторной выдачи нет.
    const next = claim(store, "s2");
    assert.equal(next, null);
    assert.equal(store.get(id)?.failure?.code, "EXECUTOR_LOST");
    throwsCode(() => store.heartbeat(id, "s1"), "LEASE_LOST");
    throwsCode(() => store.report(id, "s1", report()), "LEASE_LOST");
    throwsCode(() => store.acknowledgeCancel(id, "s1"), "LEASE_LOST");
    throwsCode(() => store.report(id, "s2", report()), "LEASE_LOST");
    throwsCode(() => store.heartbeat(id, "s2"), "LEASE_LOST"); // уже не IN_PROGRESS
  }),
);

test(
  "report / fail: проверка формы",
  setup(({ store }) => {
    const { id } = store.submit(spec());
    claim(store);
    throwsCode(() => store.report(id, "s1", report({ summary: "" })), "INVALID_INPUT");
    throwsCode(() => store.report(id, "s1", report({ changedFiles: undefined as unknown as string[] })), "INVALID_INPUT");
    throwsCode(() => store.report(id, "s1", report({ checks: [{ command: "x" } as never] })), "INVALID_INPUT");
    throwsCode(() => store.report(id, "s1", report({ artifacts: [{ type: "video", path: "p" } as never] })), "INVALID_INPUT");
    throwsCode(() => store.report(id, "s1", report({ openQuestions: [1] as unknown as string[] })), "INVALID_INPUT");
    throwsCode(() => store.fail(id, "s1", { code: "", reason: "r" }), "INVALID_INPUT");
    throwsCode(() => store.submitVerdict(id, { decision: "approve", by: "codex" }), "INVALID_STATE");
    assert.equal(store.get(id)?.status, "IN_PROGRESS");

    const failed = store.fail(id, "s1", { code: "QUOTA_EXHAUSTED", reason: "лимит" });
    assert.equal(failed.status, "FAILED");
    assert.deepEqual(failed.failure, { code: "QUOTA_EXHAUSTED", reason: "лимит" });
    throwsCode(() => store.fail(id, "s1", { code: "X", reason: "y" }), "INVALID_STATE");
    throwsCode(() => store.submitVerdict(id, { decision: "retry" as never, by: "codex" }), "INVALID_INPUT");
  }),
);

test(
  "recoverExpired: потеря исполнителя останавливает задание без повторной выдачи",
  setup(({ store, clock }) => {
    const { id } = store.submit(spec({ leaseMs: 60_000 }));
    const other = store.submit(spec({ projectId: "crm" }));
    claim(store, "crm-s", "crm");

    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      const claimed = claim(store, `s${attempt}`);
      assert.equal(claimed?.attempt, attempt);
      assert.deepEqual(store.recoverExpired(), [], "срок ещё не истёк");
      clock.t += 60_000;
      const recovered = store.recoverExpired();
      assert.equal(recovered.length, 1);
      assert.equal(recovered[0].id, id);
      if (attempt < MAX_DELIVERY_ATTEMPTS) {
        assert.equal(recovered[0].status, "QUEUED");
        assert.equal(recovered[0].owner, undefined);
        assert.equal(recovered[0].leaseExpiresAt, undefined);
        assert.equal(recovered[0].attempt, attempt);
      } else {
        assert.equal(recovered[0].status, "FAILED");
        assert.equal(recovered[0].failure?.code, "EXECUTOR_LOST");
      }
    }
    assert.equal(claim(store, "late"), null);
    assert.deepEqual(store.recoverExpired(), []);
    const types = store.events(id).map((e) => e.type);
    assert.equal(types.filter((t) => t === "lease_expired").length, MAX_DELIVERY_ATTEMPTS);
    assert.equal(types.filter((t) => t === "requeued").length, MAX_DELIVERY_ATTEMPTS - 1);
    assert.equal(types.at(-1), "failed");

    // задание другого проекта с длинным сроком не затронуто; явный now его восстанавливает
    assert.equal(store.get(other.id)?.status, "IN_PROGRESS");
    const forced = store.recoverExpired(clock.t + DEFAULT_LEASE_MS);
    assert.deepEqual(
      forced.map((t) => [t.id, t.status]),
      [[other.id, "FAILED"]],
    );

    // запрошена отмена, а исполнитель пропал → CANCELLED
    const third = store.submit(spec({ leaseMs: 60_000 }));
    claim(store, "gone");
    store.cancel(third.id, "codex");
    clock.t += 60_000;
    assert.equal(store.recoverExpired()[0].status, "CANCELLED");
  }),
);

test(
  "claimNext: изоляция по проекту и исполнителю, порядок FIFO",
  setup(({ store, clock }) => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      ids.push(store.submit(spec({ title: `v${i}` })).id);
      clock.t += 10;
    }
    const crm = store.submit(spec({ projectId: "crm" }));
    const forClaude = store.submit(spec({ executorId: "claude-worker" }));

    assert.equal(claim(store, "x", "crm", "claude-worker"), null);
    assert.equal(claim(store, "x", "crm")?.id, crm.id);
    assert.equal(claim(store, "x", "crm"), null);
    assert.equal(claim(store, "y", "viewer", "claude-worker")?.id, forClaude.id);
    assert.equal(claim(store, "y", "viewer", "claude-worker"), null);

    assert.deepEqual(
      ids.map(() => claim(store, "z")?.id),
      ids,
    );
    assert.equal(claim(store, "z"), null);
    throwsCode(() => store.claimNext({ projectId: "viewer", executorId: DEFAULT_EXECUTOR_ID, owner: "" }), "INVALID_INPUT");

    // list: фильтры и limit
    assert.equal(store.list({ status: "IN_PROGRESS" }).length, 6);
    assert.equal(store.list({ status: ["QUEUED", "REPORTED"] }).length, 0);
    assert.equal(store.list({ executorId: "claude-worker" }).length, 1);
    assert.deepEqual(
      store.list({ projectId: "viewer", limit: 2 }).map((t) => t.id),
      ids.slice(0, 2),
    );
  }),
);

test(
  "outbox уведомлений — только при notify.telegram",
  setup(({ store }) => {
    const silent = store.submit(spec());
    claim(store);
    store.report(silent.id, "s1", report());
    store.submitVerdict(silent.id, { decision: "approve", by: "codex" });
    assert.deepEqual(store.pendingNotifications(), []);

    const loud = store.submit(spec({ notify: { telegram: true, chatId: 42 } }));
    assert.deepEqual(store.pendingNotifications(), []);
    claim(store);
    store.heartbeat(loud.id, "s1");
    assert.deepEqual(store.pendingNotifications(), []);
    store.report(loud.id, "s1", report());
    store.submitVerdict(loud.id, { decision: "request_changes", by: "codex" });
    claim(store);
    store.report(loud.id, "s1", report());
    store.submitVerdict(loud.id, { decision: "approve", by: "codex" });

    const pending = store.pendingNotifications();
    assert.deepEqual(
      pending.map((n) => [n.taskId, n.kind]),
      [
        [loud.id, "REPORTED"],
        [loud.id, "REPORTED"],
        [loud.id, "APPROVED"],
      ],
    );
    assert.equal(typeof pending[0].id, "number");
    assert.equal(typeof pending[0].createdAt, "string");
    store.markNotificationSent(pending[0].id);
    assert.equal(store.pendingNotifications().length, 2);

    const failing = store.submit(spec({ notify: { telegram: true, chatId: 42 } }));
    claim(store);
    store.fail(failing.id, "s1", { code: "EXECUTOR_ERROR", reason: "r" });
    assert.equal(store.pendingNotifications().at(-1)?.kind, "FAILED");

    // отмена уведомлений не порождает
    const cancelled = store.submit(spec({ notify: { telegram: true, chatId: 42 } }));
    store.cancel(cancelled.id, "codex");
    assert.equal(store.pendingNotifications().length, 3);
  }),
);

test(
  "секреты вычищаются из спецификации, отчёта, вердикта и событий",
  setup(({ store }) => {
    const botToken = `123456789:${"AAF"}${"x".repeat(32)}`;
    const task = store.submit(
      spec({
        goal: `Проверь бота, BOT_TOKEN=${botToken}`,
        acceptance: [`Authorization: Bearer ${"t".repeat(30)} работает`],
        constraints: ["Cookie: sid=secret"],
        meta: { note: "API_KEY=abc", nested: { list: [`${"ghp_"}${"a".repeat(36)}`] } },
      }),
    );
    claim(store);
    store.report(
      task.id,
      "s1",
      report({
        summary: `Ответ сервера содержал ${botToken}`,
        checks: [{ command: "curl -H 'X: 1' https://x.test/?token=abc", ok: true, details: "PASSWORD=hunter2" }],
        openQuestions: [`hash=${"ab".repeat(32)}`],
      }),
    );
    store.submitVerdict(task.id, { decision: "request_changes", by: "codex", notes: "SECRET=zzz убери" });

    const raw = JSON.stringify([store.get(task.id), store.events(task.id)]);
    for (const leak of [botToken, "t".repeat(30), "sid=secret", "API_KEY=abc", "a".repeat(36), "token=abc", "hunter2", "ab".repeat(32), "zzz"]) {
      assert.equal(raw.includes(leak), false, `утечка: ${leak}`);
    }
    const stored = store.get(task.id);
    assert.equal(stored?.goal, "Проверь бота, BOT_TOKEN=[REDACTED]");
    assert.equal(stored?.verdicts[0].notes, "SECRET=[REDACTED] убери");
    // несекретное не тронуто
    assert.equal(stored?.report?.revision, "f417417a0c3b9d2e5f6a7b8c9d0e1f2a3b4c5d6e");
    assert.deepEqual(stored?.report?.artifacts, [{ type: "log", path: "C:\\tmp\\out.log" }]);
  }),
);

test(
  "waitForChange: изменение через второй дескриптор, тайм-аут, NOT_FOUND",
  setup(async ({ store, dbPath, now }) => {
    const task = store.submit(spec());
    const second = openStore({ dbPath, now });
    try {
      const startedAt = Date.now();
      const waiting = store.waitForChange(task.id, task.version, 10_000);
      setTimeout(() => {
        second.claimNext({ projectId: "viewer", executorId: DEFAULT_EXECUTOR_ID, owner: "other-process" });
      }, 150);
      const changed = await waiting;
      assert.equal(changed.status, "IN_PROGRESS");
      assert.equal(changed.owner, "other-process");
      assert.ok(changed.version > task.version);
      assert.ok(Date.now() - startedAt < 5000, "не должен ждать до тайм-аута");

      // уже изменилось — возвращает сразу
      assert.equal((await store.waitForChange(task.id, 0, 10_000)).version, changed.version);

      const t1 = Date.now();
      const same = await store.waitForChange(task.id, changed.version, 400);
      assert.equal(same.version, changed.version);
      assert.ok(Date.now() - t1 >= 350, "должен дождаться тайм-аута");

      await assert.rejects(
        () => store.waitForChange("T-999999", 0, 100),
        (error: unknown) => error instanceof QueueError && error.code === "NOT_FOUND",
      );
    } finally {
      second.close();
    }
  }),
);

test(
  "waitForChange замечает пропавшего исполнителя",
  setup(async ({ store, clock }) => {
    const task = store.submit(spec({ leaseMs: 60_000 }));
    const claimed = claim(store);
    assert.ok(claimed);
    clock.t += 60_000;
    const changed = await store.waitForChange(task.id, claimed.version, 5000);
    assert.equal(changed.status, "FAILED");
    assert.equal(changed.failure?.code, "EXECUTOR_LOST");
  }),
);

test(
  "данные переживают close / reopen, миграция идемпотентна",
  setup(({ store, dbPath }) => {
    const task = store.submit(spec({ notify: { telegram: true, chatId: 7 }, meta: { a: 1 } }));
    claim(store);
    store.report(task.id, "s1", report());
    const before = store.get(task.id);
    const eventsBefore = store.events(task.id);
    store.close();
    store.close(); // повторный close безопасен

    const reopened = openStore({ dbPath });
    try {
      assert.deepEqual(reopened.get(task.id), before);
      assert.deepEqual(reopened.events(task.id), eventsBefore);
      assert.equal(reopened.getProject("va")?.id, "viewer");
      assert.equal(reopened.pendingNotifications().length, 1);
      assert.equal(reopened.submit(spec()).id, "T-000002");
    } finally {
      reopened.close();
    }
  }),
);

test("хранилище в памяти и importTask", () => {
  const store = openStore({ dbPath: ":memory:" });
  try {
    store.registerProject({ id: "p", name: "P", path: "C:\\p" });
    assert.equal(store.submit(spec({ projectId: "p" })).id, "T-000001");
    const base = {
      ...spec({ projectId: "P" }),
      executorId: DEFAULT_EXECUTOR_ID,
      status: "FAILED" as const,
      round: 0,
      attempt: 0,
      cancelRequested: false,
      verdicts: [],
      failure: { code: "EXECUTOR_ERROR", reason: "TOKEN=abc" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      legacyId: "CMD-001",
    };
    const imported = store.importTask(base);
    assert.equal(imported.id, "T-000002");
    assert.equal(imported.projectId, "p");
    assert.equal(imported.status, "FAILED");
    assert.equal(imported.version, 1);
    assert.equal(imported.legacyId, "CMD-001");
    assert.equal(imported.createdAt, "2026-01-01T00:00:00.000Z");
    assert.equal(imported.failure?.reason, "TOKEN=[REDACTED]");
    assert.deepEqual(store.importTask({ ...base, title: "другое" }), imported);
    assert.equal(store.list().length, 2);
    assert.deepEqual(
      store.events(imported.id).map((e) => e.type),
      ["imported"],
    );
    throwsCode(() => store.importTask({ ...base, legacyId: "CMD-002", projectId: "ghost" }), "UNKNOWN_PROJECT");
  } finally {
    store.close();
  }
});
