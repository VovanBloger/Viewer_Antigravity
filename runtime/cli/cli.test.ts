import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const TASK_CLI = path.join(HERE, "task.ts");
const WAIT_CLI = path.join(HERE, "wait-task.ts");
const FAKE_TOKEN = `123456789:AAF${"z".repeat(32)}`;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Json {
  [key: string]: unknown;
}

interface TaskView {
  id: string;
  status: string;
  round: number;
  version: number;
  report?: { summary: string };
  verdicts: { decision: string; notes?: string; round: number }[];
}

interface Ctx {
  dir: string;
  dbPath: string;
  /** Запускает task.ts; база задаётся переменной VIEWER_QUEUE_DB. */
  task: (...args: string[]) => RunResult & { json: Json };
  /** Запускает wait-task.ts в фоне; база задаётся опцией --db. */
  waiter: (...args: string[]) => { done: Promise<RunResult>; exited: () => boolean };
  writeJson: (name: string, value: unknown, bom?: boolean) => string;
}

function setup(run: (ctx: Ctx) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-queue-cli-"));
    const dbPath = path.join(dir, "queue.db");
    const env = { ...process.env, VIEWER_QUEUE_DB: dbPath };
    const task: Ctx["task"] = (...args) => {
      const result = spawnSync(process.execPath, ["--import", "tsx", TASK_CLI, ...args], { cwd: ROOT, env, encoding: "utf8" });
      let json: Json = {};
      try {
        json = JSON.parse(result.stdout) as Json;
      } catch {
        assert.fail(`stdout не является JSON (${args.join(" ")}): ${result.stdout}\n${result.stderr}`);
      }
      return { code: result.status, stdout: result.stdout, stderr: result.stderr, json };
    };
    const waiter: Ctx["waiter"] = (...args) => {
      // Переменную окружения убираем: проверяем, что --db работает сама по себе.
      const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
      delete cleanEnv.VIEWER_QUEUE_DB;
      const child = spawn(process.execPath, ["--import", "tsx", WAIT_CLI, `--db=${dbPath}`, ...args], { cwd: ROOT, env: cleanEnv });
      let stdout = "";
      let stderr = "";
      let exited = false;
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      const done = new Promise<RunResult>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => {
          exited = true;
          resolve({ code, stdout, stderr });
        });
      });
      return { done, exited: () => exited };
    };
    const writeJson: Ctx["writeJson"] = (name, value, bom = false) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, `${bom ? "\uFEFF" : ""}${JSON.stringify(value, null, 2)}`, "utf8");
      return file;
    };
    try {
      await run({ dir, dbPath, task, waiter, writeJson });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  };
}

/** stdout ожидателя — ровно одна строка JSON. */
function singleLine(result: RunResult): Json {
  const lines = result.stdout.split("\n").filter((line) => line.trim().length > 0);
  assert.equal(lines.length, 1, `ожидалась одна строка JSON, получено: ${result.stdout}`);
  return JSON.parse(lines[0]) as Json;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test(
  "полный цикл через настоящие CLI: ожидатель → heartbeat → отчёт → возврат → отчёт → approve",
  { timeout: 120_000 },
  setup(async ({ task, waiter, writeJson }) => {
    const added = task("projects", "add", "--id=viewer", "--name=Viewer Antigravity", "--path=C:/work/viewer", "--alias=va,Вьювер");
    assert.equal(added.code, 0, added.stderr);
    assert.deepEqual((added.json.project as Json).aliases, ["va", "Вьювер"]);
    assert.equal((task("projects", "list").json.projects as Json[]).length, 1);

    // Ожидатель взводится ДО постановки задания и должен проснуться сам.
    const first = waiter("--project=va", "--poll-ms=200", "--owner=worker-1");
    await sleep(2500);
    assert.equal(first.exited(), false, "пока заданий нет, ожидатель должен ждать");

    const specFile = writeJson(
      "spec.json",
      {
        projectId: "viewer",
        kind: "diagnostic",
        title: "Проверка моста",
        goal: "Выполни node --version",
        acceptance: ["В отчёте есть версия Node"],
        checks: ["node --version"],
        coordinatorId: "codex",
      },
      true,
    );
    const submitted = task("submit", `@${specFile}`);
    assert.equal(submitted.code, 0, submitted.stderr);
    const created = submitted.json.task as TaskView;
    assert.equal(created.status, "QUEUED");

    const woke = await first.done;
    assert.equal(woke.code, 0, woke.stderr);
    const delivery = singleLine(woke);
    assert.equal(delivery.source, "VIEWER_AGENT_QUEUE");
    assert.equal(delivery.status, "NEW_TASK");
    assert.equal(delivery.owner, "worker-1");
    assert.equal((delivery.project as Json).path, "C:/work/viewer");
    const delivered = delivery.task as TaskView & { goal: string; acceptance: string[] };
    assert.equal(delivered.id, created.id);
    assert.equal(delivered.status, "IN_PROGRESS");
    assert.equal(delivered.round, 0);
    assert.equal(delivered.goal, "Выполни node --version");
    const instructions = delivery.instructions as Record<string, string>;
    assert.deepEqual(Object.keys(instructions).sort(), ["ackCancel", "fail", "heartbeat", "rearm", "report"]);
    for (const key of ["heartbeat", "report", "fail", "ackCancel"]) {
      assert.ok(instructions[key].includes(created.id), key);
      assert.ok(instructions[key].includes("--owner=worker-1"), key);
      assert.ok(instructions[key].includes("--db="), key);
    }
    assert.match(instructions.heartbeat, /agents:task -- heartbeat T-\d{6} --owner=worker-1/);
    assert.match(instructions.rearm, /agents:wait -- --project=viewer --executor=antigravity/);
    assert.match(woke.stderr, /Жду задания/);

    const beat = task("heartbeat", created.id, "--owner=worker-1");
    assert.equal(beat.code, 0, beat.stderr);
    assert.equal(beat.json.cancelRequested, false);
    assert.equal(beat.json.taskId, created.id);

    const stranger = task("heartbeat", created.id, "--owner=чужой");
    assert.equal(stranger.code, 1);
    assert.equal(stranger.json.code, "LEASE_LOST");

    const reportFile = writeJson(
      "report.json",
      {
        summary: `Node v24. Случайно попавший токен: ${FAKE_TOKEN}`,
        changedFiles: [],
        checks: [{ command: "node --version", ok: true, details: "v24.19.0" }],
        artifacts: [],
        openQuestions: [],
        model: "gemini-flash",
      },
      true,
    );
    const reported = task("report", created.id, `@${reportFile}`, "--owner=worker-1");
    assert.equal(reported.code, 0, reported.stderr);
    assert.equal((reported.json.task as TaskView).status, "REPORTED");
    assert.ok(!reported.stdout.includes(FAKE_TOKEN));

    const waited = task("wait", created.id, "--timeout-sec=5");
    assert.equal((waited.json.task as TaskView).status, "REPORTED");

    const notesFile = path.join(path.dirname(reportFile), "notes.txt");
    fs.writeFileSync(notesFile, "\uFEFFДобавь в отчёт ревизию git", "utf8");
    const verdict = task("verdict", created.id, "request_changes", `--notes=@${notesFile}`, "--by=codex");
    assert.equal(verdict.code, 0, verdict.stderr);
    assert.equal((verdict.json.task as TaskView).status, "QUEUED");
    assert.equal((verdict.json.task as TaskView).round, 1);

    // Второй ожидатель получает то же задание с раундом 1, прошлым отчётом и замечаниями.
    const second = await waiter("--project=viewer", "--poll-ms=200", "--owner=worker-2").done;
    assert.equal(second.code, 0, second.stderr);
    const redelivery = singleLine(second);
    const again = redelivery.task as TaskView;
    assert.equal(again.id, created.id);
    assert.equal(again.round, 1);
    assert.equal(again.verdicts.length, 1);
    assert.equal(again.verdicts[0].notes, "Добавь в отчёт ревизию git");
    assert.match(again.report?.summary ?? "", /Node v24/);
    assert.ok(!second.stdout.includes(FAKE_TOKEN), "токен не должен попадать исполнителю");

    // Прежний владелец отчёт сдать уже не может.
    const stale = task("report", created.id, `@${reportFile}`, "--owner=worker-1");
    assert.equal(stale.code, 1);
    assert.equal(stale.json.code, "LEASE_LOST");

    const fixed = task("report", created.id, reportFile, "--owner=worker-2");
    assert.equal(fixed.code, 0, fixed.stderr);

    const approved = task("verdict", created.id, "approve", "--by=codex");
    assert.equal(approved.code, 0, approved.stderr);
    assert.equal((approved.json.task as TaskView).status, "APPROVED");
    assert.match(approved.stderr, /слияние и деплой не выполнялись/);

    const got = task("get", created.id, "--full");
    assert.equal((got.json.task as TaskView).verdicts.length, 2);
    const events = task("events", created.id).json.events as { type: string }[];
    assert.deepEqual(
      events.map((event) => event.type),
      ["submitted", "claimed", "heartbeat", "reported", "verdict", "requeued", "claimed", "reported", "verdict"],
    );
    const listed = task("list", "--project=viewer", "--status=approved", "--limit=5");
    assert.equal((listed.json.tasks as Json[]).length, 1);
    assert.deepEqual(task("recover").json.recovered, []);
    for (const out of [got.stdout, listed.stdout, JSON.stringify(events)]) assert.ok(!out.includes(FAKE_TOKEN));
  }),
);

test(
  "ожидатель: неизвестный проект → код 2; нет --project → код 2; тайм-аут → IDLE_TIMEOUT",
  { timeout: 60_000 },
  setup(async ({ task, waiter }) => {
    task("projects", "add", "--id=viewer", "--name=Viewer", "--path=C:/work/viewer");

    const unknown = await waiter("--project=ghost").done;
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /не зарегистрирован/);
    assert.match(unknown.stderr, /Известные проекты: viewer/);
    assert.equal(singleLine(unknown).code, "UNKNOWN_PROJECT");

    const missing = await waiter().done;
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /--project/);

    const idle = await waiter("--project=viewer", "--timeout-min=0.01", "--poll-ms=100").done;
    assert.equal(idle.code, 0, idle.stderr);
    assert.deepEqual(singleLine(idle), { source: "VIEWER_AGENT_QUEUE", status: "IDLE_TIMEOUT" });
  }),
);

test(
  "task.ts: ошибки, отмена через heartbeat и fail",
  { timeout: 60_000 },
  setup(async ({ task, waiter, writeJson }) => {
    task("projects", "add", "--id=viewer", "--name=Viewer", "--path=C:/work/viewer");
    const spec = { projectId: "viewer", kind: "develop", title: "t", goal: "g", acceptance: ["a"], coordinatorId: "claude" };

    const ghost = task("submit", `@${writeJson("ghost.json", { ...spec, projectId: "ghost" })}`);
    assert.equal(ghost.code, 1);
    assert.equal(ghost.json.code, "UNKNOWN_PROJECT");

    const usage = task("nonsense");
    assert.equal(usage.code, 2);
    assert.equal(usage.json.code, "INVALID_INPUT");
    const typo = task("list", "--projct=viewer");
    assert.equal(typo.code, 2);
    const noOwner = task("heartbeat", "T-000001");
    assert.equal(noOwner.code, 2);
    assert.match(noOwner.stderr, /--owner/);
    assert.equal(task("get", "T-000999").json.code, "NOT_FOUND");

    const specFile = writeJson("spec.json", spec);
    const one = task("submit", `@${specFile}`).json.task as TaskView;
    const two = task("submit", `@${specFile}`).json.task as TaskView;

    // Отмена выполняемого задания: исполнитель узнаёт о ней из heartbeat и подтверждает.
    const delivery = singleLine(await waiter("--project=viewer", "--poll-ms=100", "--owner=w1").done);
    assert.equal((delivery.task as TaskView).id, one.id);
    const cancel = task("cancel", one.id, "--by=claude");
    assert.equal((cancel.json.task as TaskView).status, "IN_PROGRESS");
    const beat = task("heartbeat", one.id, "--owner=w1");
    assert.equal(beat.json.cancelRequested, true);
    assert.match(beat.stderr, /ack-cancel/);
    assert.equal((task("ack-cancel", one.id, "--owner=w1").json.task as TaskView).status, "CANCELLED");

    const next = singleLine(await waiter("--project=viewer", "--poll-ms=100", "--owner=w1").done);
    assert.equal((next.task as TaskView).id, two.id);
    const failed = task("fail", two.id, "Квота исчерпана", "--owner=w1", "--code=QUOTA_EXHAUSTED");
    assert.equal(failed.code, 0, failed.stderr);
    const failedTask = failed.json.task as TaskView & { failure: { code: string; reason: string } };
    assert.equal(failedTask.status, "FAILED");
    assert.deepEqual(failedTask.failure, { code: "QUOTA_EXHAUSTED", reason: "Квота исчерпана" });
  }),
);
