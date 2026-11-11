import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { openStore } from "../queue/store.ts";
import type { SqliteTaskStore } from "../queue/store.ts";
import type { TaskReport } from "../queue/types.ts";
import { createServer } from "./server.ts";

const FAKE_TOKEN = `123456789:AAF${"k".repeat(32)}`;

interface Ctx {
  store: SqliteTaskStore;
  /** Вызывает инструмент и возвращает разобранный JSON вместе с признаком ошибки. */
  call: (name: string, args?: Record<string, unknown>) => Promise<{ data: Record<string, unknown>; isError: boolean }>;
  /** Весь текст, который сервер когда-либо вернул клиенту. */
  outputs: string[];
  client: Client;
}

interface TaskView {
  id: string;
  status: string;
  round: number;
  version: number;
  progress: string;
  report?: TaskReport;
  verdicts: { decision: string; notes?: string }[];
}

function setup(run: (ctx: Ctx) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-queue-mcp-"));
    const store = openStore({ dbPath: path.join(dir, "queue.db") });
    store.registerProject({ id: "viewer", name: "Viewer Antigravity", path: "C:\\work\\viewer", aliases: ["va"] });
    const server = createServer(store);
    const client = new Client({ name: "test-coordinator", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const outputs: string[] = [];
    const call: Ctx["call"] = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as { type: string; text: string }[];
      assert.equal(content.length, 1, "ровно один элемент content");
      assert.equal(content[0].type, "text");
      outputs.push(content[0].text);
      return { data: JSON.parse(content[0].text) as Record<string, unknown>, isError: result.isError === true };
    };
    try {
      await run({ store, call, outputs, client });
    } finally {
      await client.close();
      await server.close();
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

const SPEC = {
  projectId: "viewer",
  kind: "develop",
  title: "Проверка моста",
  goal: "Сделать и отчитаться",
  acceptance: ["npm test проходит"],
  coordinatorId: "codex",
};

function report(summary: string): TaskReport {
  return {
    summary,
    changedFiles: ["a.ts"],
    checks: [{ command: "npm test", ok: true, details: `BOT_TOKEN=${FAKE_TOKEN}` }],
    artifacts: [],
    openQuestions: [],
    model: "gemini-flash",
  };
}

function claim(store: SqliteTaskStore, owner: string): string {
  const task = store.claimNext({ projectId: "viewer", executorId: "antigravity", owner });
  assert.ok(task, "задание должно быть выдано исполнителю");
  return task.id;
}

test(
  "набор инструментов и описание submit_verdict",
  setup(async ({ client }) => {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [
        "cancel_agent_task",
        "get_agent_task",
        "list_agent_tasks",
        "list_projects",
        "submit_agent_task",
        "submit_verdict",
        "wait_agent_task",
      ],
    );
    const verdict = tools.find((tool) => tool.name === "submit_verdict");
    assert.match(verdict?.description ?? "", /does NOT merge, push or deploy/);
    const submit = tools.find((tool) => tool.name === "submit_agent_task");
    assert.deepEqual([...(submit?.inputSchema.required ?? [])].sort(), ["acceptance", "coordinatorId", "goal", "kind", "projectId", "title"]);
  }),
);

test(
  "полный цикл: submit → отчёт → wait → request_changes → … → approve; секрет не утекает",
  setup(async ({ store, call, outputs }) => {
    const projects = await call("list_projects");
    assert.deepEqual((projects.data.projects as { id: string }[]).map((p) => p.id), ["viewer"]);

    const submitted = await call("submit_agent_task", { ...SPEC, leaseMinutes: 5, idempotencyKey: "mcp-flow-1" });
    assert.equal(submitted.isError, false);
    const created = submitted.data.task as TaskView;
    assert.equal(created.status, "QUEUED");
    assert.equal(created.progress, "В очереди, ждёт исполнителя");
    assert.equal(store.get(created.id)?.leaseMs, 5 * 60_000);

    // Повторная отправка с тем же ключом не создаёт второе задание.
    const repeated = await call("submit_agent_task", { ...SPEC, idempotencyKey: "mcp-flow-1" });
    assert.equal((repeated.data.task as TaskView).id, created.id);

    // Исполнитель берёт задание напрямую через хранилище и сдаёт отчёт, пока координатор ждёт.
    assert.equal(claim(store, "w1"), created.id);
    const inProgress = store.get(created.id);
    assert.ok(inProgress);
    setTimeout(() => store.heartbeat(created.id, "w1"), 50);
    setTimeout(() => store.report(created.id, "w1", report(`Готово. Токен бота ${FAKE_TOKEN}`)), 500);
    const startedAt = Date.now();
    const waited = await call("wait_agent_task", { taskId: created.id, sinceVersion: inProgress.version, timeoutSeconds: 20 });
    assert.equal(waited.data.changed, true);
    assert.ok(Date.now() - startedAt >= 400, "heartbeat не должен будить координатора раньше отчёта");
    const reported = waited.data.task as TaskView;
    assert.equal(reported.status, "REPORTED");
    assert.equal(reported.progress, "Ждёт вердикта координатора");
    assert.match(reported.report?.summary ?? "", /\[REDACTED\]/);

    // Раунд 1.
    const first = await call("submit_verdict", {
      taskId: created.id,
      decision: "request_changes",
      by: "codex",
      notes: `Поправь тесты и убери ${FAKE_TOKEN} из лога`,
    });
    const returned = first.data.task as TaskView;
    assert.equal(returned.status, "QUEUED");
    assert.equal(returned.round, 1);
    assert.match(returned.progress, /раунд 1/);

    // Вердикт для задания не в REPORTED отклоняется.
    const early = await call("submit_verdict", { taskId: created.id, decision: "approve", by: "codex" });
    assert.equal(early.isError, true);
    assert.equal(early.data.code, "INVALID_STATE");

    claim(store, "w2");
    store.report(created.id, "w2", report("Исправлено, раунд 1"));
    const second = await call("submit_verdict", { taskId: created.id, decision: "request_changes", by: "codex", notes: "Ещё раз" });
    assert.equal((second.data.task as TaskView).round, 2);

    claim(store, "w3");
    store.report(created.id, "w3", report("Исправлено, раунд 2"));
    const noWait = await call("wait_agent_task", { taskId: created.id, timeoutSeconds: 20 });
    assert.equal((noWait.data.task as TaskView).status, "REPORTED");

    const approved = await call("submit_verdict", { taskId: created.id, decision: "approve", by: "codex" });
    const final = approved.data.task as TaskView;
    assert.equal(final.status, "APPROVED");
    assert.equal(final.verdicts.length, 3);

    const compact = await call("get_agent_task", { taskId: created.id });
    assert.equal((compact.data.task as TaskView).status, "APPROVED");
    assert.ok(!("idempotencyKey" in (compact.data.task as object)));
    const events = compact.data.events as { type: string }[];
    assert.ok(events.length > 0 && events.length <= 10);
    assert.equal(events[events.length - 1].type, "verdict");
    const full = await call("get_agent_task", { taskId: created.id, full: true });
    assert.equal((full.data.task as { idempotencyKey?: string }).idempotencyKey, "mcp-flow-1");

    const listed = await call("list_agent_tasks", { projectId: "va", status: "APPROVED" });
    assert.deepEqual(
      (listed.data.tasks as Record<string, unknown>[]).map((row) => Object.keys(row).sort()),
      [["id", "progress", "projectId", "round", "status", "title", "updatedAt"]],
    );
    await call("list_agent_tasks", { coordinatorId: "codex", limit: 5 });

    assert.ok(outputs.length >= 12);
    for (const text of outputs) assert.ok(!text.includes(FAKE_TOKEN), "токен бота не должен попадать в ответы инструментов");
  }),
);

test(
  "ошибки: неизвестный проект, несуществующее задание, отмена",
  setup(async ({ store, call }) => {
    const unknown = await call("submit_agent_task", { ...SPEC, projectId: "ghost" });
    assert.equal(unknown.isError, true);
    assert.equal(unknown.data.code, "UNKNOWN_PROJECT");
    assert.equal(typeof unknown.data.message, "string");
    assert.equal(store.list().length, 0, "задание для неизвестного проекта не создаётся");

    const listUnknown = await call("list_agent_tasks", { projectId: "ghost" });
    assert.equal(listUnknown.data.code, "UNKNOWN_PROJECT");

    for (const name of ["get_agent_task", "wait_agent_task"]) {
      const missing = await call(name, { taskId: "T-000999" });
      assert.equal(missing.isError, true);
      assert.equal(missing.data.code, "NOT_FOUND");
    }

    const noChat = await call("submit_agent_task", { ...SPEC, notifyTelegram: true });
    assert.equal(noChat.data.code, "INVALID_INPUT");
    const withChat = await call("submit_agent_task", { ...SPEC, notifyTelegram: true, chatId: 42 });
    const notified = withChat.data.task as TaskView;
    assert.deepEqual(store.get(notified.id)?.notify, { telegram: true, chatId: 42 });

    // Отмена задания в очереди — сразу; выполняемого — только флаг.
    const cancelled = await call("cancel_agent_task", { taskId: notified.id, by: "codex" });
    assert.equal((cancelled.data.task as TaskView).status, "CANCELLED");
    const running = (await call("submit_agent_task", SPEC)).data.task as TaskView;
    claim(store, "w1");
    const requested = await call("cancel_agent_task", { taskId: running.id, by: "codex" });
    assert.equal((requested.data.task as TaskView).status, "IN_PROGRESS");
    assert.match((requested.data.task as TaskView).progress, /запрошена отмена/);
    const again = await call("cancel_agent_task", { taskId: notified.id, by: "codex" });
    assert.equal(again.data.code, "INVALID_STATE");

    const timedOut = await call("wait_agent_task", { taskId: running.id, sinceVersion: 999, timeoutSeconds: 0.2 });
    assert.equal(timedOut.data.changed, false);
  }),
);
