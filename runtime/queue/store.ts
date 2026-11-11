/**
 * Viewer 2 — хранилище очереди на SQLite (встроенный node:sqlite, без нативных зависимостей).
 *
 * Все изменяющие операции идут внутри BEGIN IMMEDIATE … COMMIT, поэтому два процесса
 * не могут получить одно задание или потерять запись друг друга.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

import { redactDeep } from "./redact.ts";
import {
  DEFAULT_EXECUTOR_ID,
  DEFAULT_LEASE_MS,
  MAX_DELIVERY_ATTEMPTS,
  MAX_FIX_ROUNDS,
  QueueError,
  TERMINAL_STATUSES,
} from "./types.ts";
import type {
  AgentTask,
  ClaimOptions,
  Project,
  TaskEvent,
  TaskFailure,
  TaskFilter,
  TaskKind,
  TaskReport,
  TaskSpec,
  TaskStatus,
  TaskStore,
  Verdict,
} from "./types.ts";

export interface PendingNotification {
  id: number;
  taskId: string;
  kind: string;
  createdAt: string;
}

/** Задание в произвольном состоянии для импорта из старой очереди. */
export type ImportedTask = Omit<AgentTask, "id" | "version"> & { legacyId: string };

export interface SqliteTaskStore extends TaskStore {
  /** Неотправленные уведомления (outbox). Отсюда ничего не отправляется — это делает отдельный доставщик. */
  pendingNotifications(): PendingNotification[];
  markNotificationSent(id: number): void;
  /** Вставляет задание в произвольном состоянии; идемпотентно по legacyId (возвращает существующее). */
  importTask(task: ImportedTask, eventData?: Record<string, unknown>): AgentTask;
  getByLegacyId(legacyId: string): AgentTask | undefined;
  /** Алиасы для удобства интеграции с верстаком и API-мостами */
  listTasks(filter?: TaskFilter): AgentTask[];
  submitTask(spec: TaskSpec): AgentTask;
}

export interface OpenStoreOptions {
  dbPath?: string;
  /** Источник времени (Unix ms) — подменяется в тестах. */
  now?: () => number;
}

const MIN_LEASE_MS = 60_000;
const MAX_LEASE_MS = 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 300;
/** Раз в столько опросов waitForChange запускает восстановление истёкших сроков владения. */
const RECOVER_EVERY_POLLS = 10;
const TASK_KINDS: readonly TaskKind[] = ["develop", "test", "browser-check", "review", "diagnostic"];
const ARTIFACT_TYPES: readonly string[] = ["screenshot", "log", "diff", "file"];
const ALL_STATUSES: readonly TaskStatus[] = ["QUEUED", "IN_PROGRESS", "REPORTED", ...TERMINAL_STATUSES];
/** Статусы, при достижении которых в outbox кладётся уведомление (если notify.telegram). */
const NOTIFY_STATUSES: readonly TaskStatus[] = ["REPORTED", "FAILED", "APPROVED", "RETURNED"];

const SPEC_KEYS = [
  "projectId",
  "executorId",
  "kind",
  "title",
  "goal",
  "acceptance",
  "constraints",
  "allowedPaths",
  "checks",
  "expectedArtifacts",
  "coordinatorId",
  "baseRevision",
  "branch",
  "workdir",
  "notify",
  "idempotencyKey",
  "leaseMs",
  "meta",
] as const satisfies readonly (keyof TaskSpec)[];

const SCHEMA_V1 = `
CREATE TABLE projects (
  key     TEXT PRIMARY KEY,
  id      TEXT NOT NULL,
  name    TEXT NOT NULL,
  path    TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE tasks (
  seq              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key      TEXT NOT NULL REFERENCES projects(key),
  executor_id      TEXT NOT NULL,
  coordinator_id   TEXT NOT NULL,
  status           TEXT NOT NULL,
  idempotency_key  TEXT,
  legacy_id        TEXT UNIQUE,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1,
  round            INTEGER NOT NULL DEFAULT 0,
  attempt          INTEGER NOT NULL DEFAULT 0,
  owner            TEXT,
  lease_expires_at INTEGER,
  heartbeat_at     INTEGER,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  spec             TEXT NOT NULL,
  report           TEXT,
  verdicts         TEXT NOT NULL DEFAULT '[]',
  failure          TEXT
);
CREATE UNIQUE INDEX tasks_idempotency ON tasks(coordinator_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX tasks_claim ON tasks(project_key, executor_id, status, created_at, seq);
CREATE INDEX tasks_lease ON tasks(status, lease_expires_at);
CREATE TABLE events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  task_seq INTEGER NOT NULL REFERENCES tasks(seq),
  at       TEXT NOT NULL,
  type     TEXT NOT NULL,
  actor    TEXT NOT NULL,
  data     TEXT
);
CREATE INDEX events_task ON events(task_seq, id);
CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_seq   INTEGER NOT NULL REFERENCES tasks(seq),
  kind       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at    TEXT
);
CREATE INDEX notifications_pending ON notifications(sent_at, id);
`;

interface TaskRow {
  seq: number;
  status: string;
  created_at: string;
  updated_at: string;
  version: number;
  round: number;
  attempt: number;
  owner: string | null;
  lease_expires_at: number | null;
  heartbeat_at: number | null;
  cancel_requested: number;
  legacy_id: string | null;
  spec: string;
  report: string | null;
  verdicts: string;
  failure: string | null;
}

interface ProjectRow {
  key: string;
  id: string;
  name: string;
  path: string;
  aliases: string;
}

export function defaultDbPath(): string {
  return process.env.VIEWER_QUEUE_DB || path.join(os.homedir(), ".viewer-antigravity", "agent-queue.db");
}

function taskId(seq: number): string {
  return `T-${String(seq).padStart(6, "0")}`;
}

function seqOf(id: string): number | undefined {
  const match = /^T-(\d{1,15})$/i.exec(typeof id === "string" ? id.trim() : "");
  return match ? Number(match[1]) : undefined;
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function invalid(message: string): QueueError {
  return new QueueError("INVALID_INPUT", message);
}

function requireActor(value: unknown, label: string): void {
  if (!isNonEmptyString(value)) throw invalid(`Поле ${label} обязательно`);
}

function validateSpec(spec: TaskSpec): void {
  if (spec === null || typeof spec !== "object") throw invalid("Спецификация задания должна быть объектом");
  for (const key of ["projectId", "title", "goal", "coordinatorId"] as const) {
    if (!isNonEmptyString(spec[key])) throw invalid(`Поле ${key} обязательно и не может быть пустым`);
  }
  if (!TASK_KINDS.includes(spec.kind)) throw invalid(`Недопустимый kind: ${String(spec.kind)}`);
  if (!isStringArray(spec.acceptance)) throw invalid("Поле acceptance должно быть массивом строк");
  for (const key of ["constraints", "allowedPaths", "checks", "expectedArtifacts"] as const) {
    if (spec[key] !== undefined && !isStringArray(spec[key])) throw invalid(`Поле ${key} должно быть массивом строк`);
  }
  if (spec.executorId !== undefined && !isNonEmptyString(spec.executorId)) {
    throw invalid("Поле executorId не может быть пустым");
  }
  if (spec.idempotencyKey !== undefined && !isNonEmptyString(spec.idempotencyKey)) {
    throw invalid("Поле idempotencyKey не может быть пустым");
  }
  if (spec.leaseMs !== undefined) {
    if (!Number.isInteger(spec.leaseMs) || spec.leaseMs < MIN_LEASE_MS || spec.leaseMs > MAX_LEASE_MS) {
      throw invalid(`Поле leaseMs должно быть целым от ${MIN_LEASE_MS} до ${MAX_LEASE_MS} мс`);
    }
  }
  if (spec.notify !== undefined) {
    if (spec.notify === null || typeof spec.notify !== "object") throw invalid("Поле notify должно быть объектом");
    if (spec.notify.telegram === true && !Number.isFinite(spec.notify.chatId)) {
      throw invalid("Для notify.telegram = true обязателен notify.chatId");
    }
  }
  if (spec.meta !== undefined && (spec.meta === null || typeof spec.meta !== "object" || Array.isArray(spec.meta))) {
    throw invalid("Поле meta должно быть объектом");
  }
}

function validateReport(report: TaskReport): void {
  if (report === null || typeof report !== "object") throw invalid("Отчёт должен быть объектом");
  if (!isNonEmptyString(report.summary)) throw invalid("Поле summary отчёта обязательно");
  if (!isStringArray(report.changedFiles)) throw invalid("Поле changedFiles должно быть массивом строк");
  if (!isStringArray(report.openQuestions)) throw invalid("Поле openQuestions должно быть массивом строк");
  if (report.revision !== undefined && typeof report.revision !== "string") throw invalid("Поле revision должно быть строкой");
  if (report.model !== undefined && typeof report.model !== "string") throw invalid("Поле model должно быть строкой");
  if (!Array.isArray(report.checks)) throw invalid("Поле checks должно быть массивом");
  for (const check of report.checks) {
    if (check === null || typeof check !== "object" || !isNonEmptyString(check.command) || typeof check.ok !== "boolean") {
      throw invalid("Каждый элемент checks должен иметь вид { command, ok, details? }");
    }
    if (check.details !== undefined && typeof check.details !== "string") throw invalid("Поле details должно быть строкой");
  }
  if (!Array.isArray(report.artifacts)) throw invalid("Поле artifacts должно быть массивом");
  for (const artifact of report.artifacts) {
    if (
      artifact === null ||
      typeof artifact !== "object" ||
      !ARTIFACT_TYPES.includes(artifact.type) ||
      !isNonEmptyString(artifact.path)
    ) {
      throw invalid("Каждый элемент artifacts должен иметь вид { type, path, note? }");
    }
    if (artifact.note !== undefined && typeof artifact.note !== "string") throw invalid("Поле note должно быть строкой");
  }
}

/** Оставляет в отчёте только поля контракта. */
function cleanReport(report: TaskReport): TaskReport {
  const out: TaskReport = {
    summary: report.summary,
    changedFiles: [...report.changedFiles],
    checks: report.checks.map((c) => ({ command: c.command, ok: c.ok, ...(c.details !== undefined ? { details: c.details } : {}) })),
    artifacts: report.artifacts.map((a) => ({ type: a.type, path: a.path, ...(a.note !== undefined ? { note: a.note } : {}) })),
    openQuestions: [...report.openQuestions],
  };
  if (report.revision !== undefined) out.revision = report.revision;
  if (report.model !== undefined) out.model = report.model;
  return redactDeep(out);
}

function pickSpec(source: TaskSpec): TaskSpec {
  const out: Record<string, unknown> = {};
  for (const key of SPEC_KEYS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out as unknown as TaskSpec;
}

function checkLease(leaseMs: number | undefined): void {
  if (leaseMs !== undefined && (!Number.isFinite(leaseMs) || leaseMs <= 0)) {
    throw invalid("leaseMs должен быть положительным числом");
  }
}

export function openStore(options: OpenStoreOptions = {}): SqliteTaskStore {
  const dbPath = options.dbPath ?? defaultDbPath();
  const now = options.now ?? Date.now;
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

  const db = new DatabaseSync(dbPath);
  // busy_timeout — первым, чтобы параллельное открытие несколькими процессами не падало с SQLITE_BUSY.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const all = <T>(sql: string, ...params: SQLInputValue[]): T[] => db.prepare(sql).all(...params) as unknown as T[];
  const one = <T>(sql: string, ...params: SQLInputValue[]): T | undefined =>
    db.prepare(sql).get(...params) as unknown as T | undefined;
  const run = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);

  function tx<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // транзакция уже откатана самим SQLite
      }
      throw error;
    }
  }

  // Идемпотентная миграция схемы.
  tx(() => {
    const version = one<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0;
    if (version < 1) {
      db.exec(SCHEMA_V1);
      db.exec("PRAGMA user_version = 1");
    }
  });

  const iso = (ms: number = now()): string => new Date(ms).toISOString();

  // ── проекты ──

  function toProject(row: ProjectRow): Project {
    const aliases = JSON.parse(row.aliases) as string[];
    return { id: row.id, name: row.name, path: row.path, ...(aliases.length > 0 ? { aliases } : {}) };
  }

  function listProjects(): Project[] {
    return all<ProjectRow>("SELECT * FROM projects ORDER BY key").map(toProject);
  }

  function getProject(idOrAlias: string): Project | undefined {
    if (!isNonEmptyString(idOrAlias)) return undefined;
    const key = norm(idOrAlias);
    const direct = one<ProjectRow>("SELECT * FROM projects WHERE key = ?", key);
    if (direct) return toProject(direct);
    return listProjects().find((project) => (project.aliases ?? []).some((alias) => norm(alias) === key));
  }

  function registerProject(project: Project): Project {
    if (project === null || typeof project !== "object") throw invalid("Проект должен быть объектом");
    for (const key of ["id", "name", "path"] as const) {
      if (!isNonEmptyString(project[key])) throw invalid(`Поле проекта ${key} обязательно`);
    }
    if (project.aliases !== undefined && !isStringArray(project.aliases)) {
      throw invalid("Поле aliases должно быть массивом строк");
    }
    const id = project.id.trim();
    const key = norm(id);
    const aliases: string[] = [];
    for (const raw of project.aliases ?? []) {
      const alias = raw.trim();
      if (alias && norm(alias) !== key && !aliases.some((a) => norm(a) === norm(alias))) aliases.push(alias);
    }
    return tx(() => {
      for (const name of [id, ...aliases]) {
        const owner = getProject(name);
        if (owner && norm(owner.id) !== key) {
          throw invalid(`Идентификатор или алиас "${name}" уже занят проектом "${owner.id}"`);
        }
      }
      run(
        `INSERT INTO projects (key, id, name, path, aliases) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET id = excluded.id, name = excluded.name, path = excluded.path, aliases = excluded.aliases`,
        key,
        id,
        project.name.trim(),
        project.path,
        JSON.stringify(aliases),
      );
      return getProject(id) as Project;
    });
  }

  function requireProject(idOrAlias: string): Project {
    const project = getProject(idOrAlias);
    if (!project) throw new QueueError("UNKNOWN_PROJECT", `Неизвестный проект: "${String(idOrAlias)}"`);
    return project;
  }

  // ── задания: чтение / запись ──

  function toTask(row: TaskRow): AgentTask {
    const spec = JSON.parse(row.spec) as TaskSpec & { executorId: string };
    const task: AgentTask = {
      ...spec,
      id: taskId(row.seq),
      status: row.status as TaskStatus,
      round: row.round,
      attempt: row.attempt,
      cancelRequested: row.cancel_requested === 1,
      verdicts: JSON.parse(row.verdicts) as AgentTask["verdicts"],
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (row.owner !== null) task.owner = row.owner;
    if (row.lease_expires_at !== null) task.leaseExpiresAt = row.lease_expires_at;
    if (row.heartbeat_at !== null) task.heartbeatAt = row.heartbeat_at;
    if (row.report !== null) task.report = JSON.parse(row.report) as TaskReport;
    if (row.failure !== null) task.failure = JSON.parse(row.failure) as TaskFailure;
    if (row.legacy_id !== null) task.legacyId = row.legacy_id;
    return task;
  }

  function get(id: string): AgentTask | undefined {
    const seq = seqOf(id);
    if (seq === undefined) return undefined;
    const row = one<TaskRow>("SELECT * FROM tasks WHERE seq = ?", seq);
    return row ? toTask(row) : undefined;
  }

  function mustGet(id: string): AgentTask {
    const task = get(id);
    if (!task) throw new QueueError("NOT_FOUND", `Задание не найдено: ${String(id)}`);
    return task;
  }

  function addEvent(task: AgentTask, type: string, actor: string, data?: Record<string, unknown>): void {
    run(
      "INSERT INTO events (task_seq, at, type, actor, data) VALUES (?, ?, ?, ?, ?)",
      seqOf(task.id) as number,
      iso(),
      type,
      actor,
      data ? JSON.stringify(redactDeep(data)) : null,
    );
  }

  /** Сохраняет изменяемые поля задания; version + 1. Вызывать только внутри tx. */
  function save(task: AgentTask, previousStatus: TaskStatus): AgentTask {
    task.version += 1;
    task.updatedAt = iso();
    run(
      `UPDATE tasks SET status = ?, updated_at = ?, version = ?, round = ?, attempt = ?, owner = ?,
         lease_expires_at = ?, heartbeat_at = ?, cancel_requested = ?, report = ?, verdicts = ?, failure = ?
       WHERE seq = ?`,
      task.status,
      task.updatedAt,
      task.version,
      task.round,
      task.attempt,
      task.owner ?? null,
      task.leaseExpiresAt ?? null,
      task.heartbeatAt ?? null,
      task.cancelRequested ? 1 : 0,
      task.report ? JSON.stringify(task.report) : null,
      JSON.stringify(task.verdicts),
      task.failure ? JSON.stringify(task.failure) : null,
      seqOf(task.id) as number,
    );
    if (task.status !== previousStatus && task.notify?.telegram === true && NOTIFY_STATUSES.includes(task.status)) {
      run(
        "INSERT INTO notifications (task_seq, kind, created_at) VALUES (?, ?, ?)",
        seqOf(task.id) as number,
        task.status,
        task.updatedAt,
      );
    }
    return task;
  }

  function insertTask(spec: TaskSpec & { executorId: string }, state: Omit<AgentTask, keyof TaskSpec | "id" | "version">): AgentTask {
    const result = run(
      `INSERT INTO tasks (project_key, executor_id, coordinator_id, status, idempotency_key, legacy_id, created_at,
         updated_at, version, round, attempt, owner, lease_expires_at, heartbeat_at, cancel_requested, spec, report,
         verdicts, failure)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      norm(spec.projectId),
      spec.executorId,
      spec.coordinatorId,
      state.status,
      spec.idempotencyKey ?? null,
      state.legacyId ?? null,
      state.createdAt,
      state.updatedAt,
      state.round,
      state.attempt,
      state.owner ?? null,
      state.leaseExpiresAt ?? null,
      state.heartbeatAt ?? null,
      state.cancelRequested ? 1 : 0,
      JSON.stringify(spec),
      state.report ? JSON.stringify(state.report) : null,
      JSON.stringify(state.verdicts),
      state.failure ? JSON.stringify(state.failure) : null,
    );
    return mustGet(taskId(Number(result.lastInsertRowid)));
  }

  // ── координатор ──

  function submit(input: TaskSpec): AgentTask {
    validateSpec(input);
    const spec = redactDeep(pickSpec(input));
    return tx(() => {
      const project = requireProject(input.projectId);
      const executorId = (spec.executorId ?? DEFAULT_EXECUTOR_ID).trim();
      const coordinatorId = spec.coordinatorId.trim();
      if (spec.idempotencyKey !== undefined) {
        const existing = one<TaskRow>(
          "SELECT * FROM tasks WHERE coordinator_id = ? AND idempotency_key = ?",
          coordinatorId,
          spec.idempotencyKey,
        );
        if (existing) return toTask(existing);
      }
      const at = iso();
      const task = insertTask(
        { ...spec, projectId: project.id, executorId, coordinatorId },
        { status: "QUEUED", round: 0, attempt: 0, cancelRequested: false, verdicts: [], createdAt: at, updatedAt: at },
      );
      addEvent(task, "submitted", coordinatorId, { projectId: project.id, executorId, kind: task.kind });
      return task;
    });
  }

  function list(filter: TaskFilter = {}): AgentTask[] {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.projectId !== undefined) {
      const project = getProject(filter.projectId);
      if (!project) return [];
      where.push("project_key = ?");
      params.push(norm(project.id));
    }
    if (filter.executorId !== undefined) {
      where.push("executor_id = ?");
      params.push(filter.executorId);
    }
    if (filter.coordinatorId !== undefined) {
      where.push("coordinator_id = ?");
      params.push(filter.coordinatorId);
    }
    if (filter.status !== undefined) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      if (statuses.length === 0) return [];
      where.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    let sql = `SELECT * FROM tasks${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at, seq`;
    if (filter.limit !== undefined && Number.isInteger(filter.limit) && filter.limit > 0) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }
    return all<TaskRow>(sql, ...params).map(toTask);
  }

  function cancel(id: string, by: string): AgentTask {
    requireActor(by, "by");
    return tx(() => {
      const task = mustGet(id);
      const previous = task.status;
      if (previous === "QUEUED" || previous === "REPORTED") {
        task.status = "CANCELLED";
        delete task.leaseExpiresAt;
        save(task, previous);
        addEvent(task, "cancelled", by, { from: previous });
        return task;
      }
      if (previous === "IN_PROGRESS") {
        if (task.cancelRequested) return task;
        task.cancelRequested = true;
        save(task, previous);
        addEvent(task, "cancel_requested", by);
        return task;
      }
      throw new QueueError("INVALID_STATE", `Задание ${task.id} уже завершено (${previous}) — отменить нельзя`);
    });
  }

  function submitVerdict(id: string, verdict: Verdict): AgentTask {
    if (verdict === null || typeof verdict !== "object") throw invalid("Вердикт должен быть объектом");
    if (verdict.decision !== "approve" && verdict.decision !== "request_changes") {
      throw invalid(`Недопустимое решение: ${String(verdict.decision)}`);
    }
    requireActor(verdict.by, "by");
    if (verdict.notes !== undefined && typeof verdict.notes !== "string") throw invalid("Поле notes должно быть строкой");
    const notes = verdict.notes === undefined ? undefined : redactDeep(verdict.notes);
    return tx(() => {
      const task = mustGet(id);
      if (task.status !== "REPORTED") {
        throw new QueueError("INVALID_STATE", `Вердикт возможен только для REPORTED, а задание ${task.id} в статусе ${task.status}`);
      }
      const round = task.round;
      task.verdicts.push({ decision: verdict.decision, by: verdict.by, round, at: iso(), ...(notes !== undefined ? { notes } : {}) });
      if (verdict.decision === "approve") {
        // Только смена статуса: слияние и деплой здесь не выполняются никогда.
        task.status = "APPROVED";
      } else if (round >= MAX_FIX_ROUNDS) {
        task.status = "RETURNED";
        task.failure = {
          code: "FIX_ROUNDS_EXHAUSTED",
          reason: notes ?? `Исчерпаны раунды исправлений (${MAX_FIX_ROUNDS})`,
        };
      } else {
        // Отчёт прошлого раунда остаётся — исполнитель увидит его вместе с замечаниями.
        task.status = "QUEUED";
        task.round = round + 1;
        task.attempt = 0;
        delete task.owner;
        delete task.leaseExpiresAt;
        delete task.heartbeatAt;
      }
      save(task, "REPORTED");
      addEvent(task, "verdict", verdict.by, { decision: verdict.decision, round, status: task.status });
      if (task.status === "QUEUED") addEvent(task, "requeued", verdict.by, { reason: "request_changes", round: task.round });
      return task;
    });
  }

  // ── обслуживание ──

  /** Вызывать только внутри tx. */
  function recoverInTx(at: number, projectKey?: string): AgentTask[] {
    const rows = all<TaskRow>(
      `SELECT * FROM tasks WHERE status = 'IN_PROGRESS' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
         ${projectKey === undefined ? "" : "AND project_key = ?"} ORDER BY seq`,
      ...(projectKey === undefined ? [at] : [at, projectKey]),
    );
    return rows.map((row) => {
      const task = toTask(row);
      const lostOwner = task.owner ?? "unknown";
      addEvent(task, "lease_expired", "system", { owner: lostOwner, attempt: task.attempt });
      delete task.leaseExpiresAt;
      delete task.owner;
      delete task.heartbeatAt;
      if (task.cancelRequested) {
        // Отмена уже запрошена, а исполнитель пропал — подтверждать некому.
        task.status = "CANCELLED";
        save(task, "IN_PROGRESS");
        addEvent(task, "cancelled", "system", { reason: "lease_expired" });
      } else if (task.attempt >= MAX_DELIVERY_ATTEMPTS) {
        task.status = "FAILED";
        task.failure = {
          code: "EXECUTOR_LOST",
          reason: `Исполнитель потерян ${task.attempt} раз(а) подряд: срок владения истёк без отчёта`,
        };
        save(task, "IN_PROGRESS");
        addEvent(task, "failed", "system", { code: "EXECUTOR_LOST" });
      } else {
        task.status = "QUEUED";
        delete task.owner;
        delete task.heartbeatAt;
        save(task, "IN_PROGRESS");
        addEvent(task, "requeued", "system", { reason: "lease_expired", attempt: task.attempt });
      }
      return task;
    });
  }

  function recoverExpired(at: number = now()): AgentTask[] {
    // Дешёвая проверка без блокировки записи: обычно восстанавливать нечего.
    const pending = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM tasks WHERE status = 'IN_PROGRESS' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?",
      at,
    );
    if (!pending || pending.n === 0) return [];
    return tx(() => recoverInTx(at));
  }

  // ── исполнитель ──

  function claimNext(claim: ClaimOptions): AgentTask | null {
    if (claim === null || typeof claim !== "object") throw invalid("Параметры выдачи должны быть объектом");
    requireActor(claim.projectId, "projectId");
    requireActor(claim.executorId, "executorId");
    requireActor(claim.owner, "owner");
    checkLease(claim.leaseMs);
    return tx(() => {
      const projectKey = norm(requireProject(claim.projectId).id);
      const at = now();
      recoverInTx(at, projectKey);
      const row = one<TaskRow>(
        `SELECT * FROM tasks WHERE project_key = ? AND executor_id = ? AND status = 'QUEUED'
         ORDER BY created_at, seq LIMIT 1`,
        projectKey,
        claim.executorId.trim(),
      );
      if (!row) return null;
      const task = toTask(row);
      task.status = "IN_PROGRESS";
      task.owner = claim.owner;
      task.attempt += 1;
      task.leaseExpiresAt = at + (claim.leaseMs ?? task.leaseMs ?? DEFAULT_LEASE_MS);
      task.heartbeatAt = at;
      task.cancelRequested = false;
      save(task, "QUEUED");
      addEvent(task, "claimed", claim.owner, { round: task.round, attempt: task.attempt });
      return task;
    });
  }

  /** Проверяет, что задание принадлежит owner и выполняется. Вызывать внутри tx. */
  function owned(id: string, owner: string): AgentTask {
    const task = mustGet(id);
    if (task.owner !== owner) {
      throw new QueueError("LEASE_LOST", `Задание ${task.id} больше не принадлежит исполнителю "${owner}"`);
    }
    if (task.status !== "IN_PROGRESS") {
      throw new QueueError("INVALID_STATE", `Задание ${task.id} не выполняется (статус ${task.status})`);
    }
    return task;
  }

  function heartbeat(id: string, owner: string, leaseMs?: number): { task: AgentTask; cancelRequested: boolean } {
    requireActor(owner, "owner");
    checkLease(leaseMs);
    return tx(() => {
      const task = mustGet(id);
      const at = now();
      if (task.owner !== owner || task.status !== "IN_PROGRESS" || (task.leaseExpiresAt ?? 0) <= at) {
        throw new QueueError("LEASE_LOST", `Срок владения заданием ${task.id} потерян исполнителем "${owner}"`);
      }
      task.leaseExpiresAt = at + (leaseMs ?? task.leaseMs ?? DEFAULT_LEASE_MS);
      task.heartbeatAt = at;
      save(task, "IN_PROGRESS");
      // Подряд идущие heartbeat-события схлопываются в одно, чтобы журнал не рос.
      const last = one<{ id: number; type: string }>(
        "SELECT id, type FROM events WHERE task_seq = ? ORDER BY id DESC LIMIT 1",
        seqOf(task.id) as number,
      );
      if (last && last.type === "heartbeat") run("UPDATE events SET at = ? WHERE id = ?", iso(at), last.id);
      else addEvent(task, "heartbeat", owner);
      return { task, cancelRequested: task.cancelRequested };
    });
  }

  function report(id: string, owner: string, input: TaskReport): AgentTask {
    requireActor(owner, "owner");
    validateReport(input);
    const cleaned = cleanReport(input);
    return tx(() => {
      const task = owned(id, owner);
      task.report = cleaned;
      delete task.leaseExpiresAt;
      if (task.cancelRequested) {
        task.status = "CANCELLED";
        save(task, "IN_PROGRESS");
        addEvent(task, "cancelled", owner, { withReport: true });
      } else {
        task.status = "REPORTED";
        save(task, "IN_PROGRESS");
        addEvent(task, "reported", owner, { round: task.round, changedFiles: cleaned.changedFiles.length });
      }
      return task;
    });
  }

  function fail(id: string, owner: string, failure: TaskFailure): AgentTask {
    requireActor(owner, "owner");
    if (failure === null || typeof failure !== "object" || !isNonEmptyString(failure.code) || !isNonEmptyString(failure.reason)) {
      throw invalid("Ошибка должна иметь вид { code, reason }");
    }
    const cleaned = redactDeep({ code: failure.code, reason: failure.reason });
    return tx(() => {
      const task = owned(id, owner);
      task.status = "FAILED";
      task.failure = cleaned;
      delete task.leaseExpiresAt;
      save(task, "IN_PROGRESS");
      addEvent(task, "failed", owner, { code: cleaned.code });
      return task;
    });
  }

  function acknowledgeCancel(id: string, owner: string): AgentTask {
    requireActor(owner, "owner");
    return tx(() => {
      const task = owned(id, owner);
      if (!task.cancelRequested) {
        throw new QueueError("INVALID_STATE", `Для задания ${task.id} отмена не запрашивалась`);
      }
      task.status = "CANCELLED";
      delete task.leaseExpiresAt;
      save(task, "IN_PROGRESS");
      addEvent(task, "cancelled", owner);
      return task;
    });
  }

  async function waitForChange(id: string, sinceVersion: number, timeoutMs: number): Promise<AgentTask> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    for (let poll = 0; ; poll += 1) {
      if (poll % RECOVER_EVERY_POLLS === 0) recoverExpired();
      // Любой переход (в том числе в терминальный статус) увеличивает version.
      const task = mustGet(id);
      if (task.version > sinceVersion) return task;
      const left = deadline - Date.now();
      if (left <= 0) return task;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, left)));
    }
  }

  function events(id: string): TaskEvent[] {
    const seq = seqOf(id);
    if (seq === undefined) return [];
    return all<{ at: string; type: string; actor: string; data: string | null }>(
      "SELECT at, type, actor, data FROM events WHERE task_seq = ? ORDER BY id",
      seq,
    ).map((row) => ({
      taskId: taskId(seq),
      at: row.at,
      type: row.type,
      actor: row.actor,
      ...(row.data !== null ? { data: JSON.parse(row.data) as Record<string, unknown> } : {}),
    }));
  }

  // ── outbox и импорт ──

  function pendingNotifications(): PendingNotification[] {
    return all<{ id: number; task_seq: number; kind: string; created_at: string }>(
      "SELECT id, task_seq, kind, created_at FROM notifications WHERE sent_at IS NULL ORDER BY id",
    ).map((row) => ({ id: row.id, taskId: taskId(row.task_seq), kind: row.kind, createdAt: row.created_at }));
  }

  function markNotificationSent(id: number): void {
    tx(() => {
      run("UPDATE notifications SET sent_at = ? WHERE id = ? AND sent_at IS NULL", iso(), id);
    });
  }

  function getByLegacyId(legacyId: string): AgentTask | undefined {
    const row = one<TaskRow>("SELECT * FROM tasks WHERE legacy_id = ?", legacyId);
    return row ? toTask(row) : undefined;
  }

  function importTask(input: ImportedTask, eventData?: Record<string, unknown>): AgentTask {
    if (input === null || typeof input !== "object") throw invalid("Импортируемое задание должно быть объектом");
    if (!isNonEmptyString(input.legacyId)) throw invalid("Поле legacyId обязательно");
    if (!ALL_STATUSES.includes(input.status)) throw invalid(`Недопустимый статус: ${String(input.status)}`);
    for (const key of ["projectId", "title", "goal", "coordinatorId", "executorId", "createdAt", "updatedAt"] as const) {
      if (!isNonEmptyString(input[key])) throw invalid(`Поле ${key} обязательно и не может быть пустым`);
    }
    return tx(() => {
      const existing = getByLegacyId(input.legacyId);
      if (existing) return existing;
      const project = requireProject(input.projectId);
      const spec = redactDeep(pickSpec(input));
      const task = insertTask(
        { ...spec, projectId: project.id, executorId: input.executorId },
        {
          status: input.status,
          round: input.round ?? 0,
          attempt: input.attempt ?? 0,
          owner: input.owner,
          leaseExpiresAt: input.leaseExpiresAt,
          heartbeatAt: input.heartbeatAt,
          cancelRequested: input.cancelRequested === true,
          report: input.report ? redactDeep(input.report) : undefined,
          verdicts: input.verdicts ?? [],
          failure: input.failure ? redactDeep(input.failure) : undefined,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          legacyId: input.legacyId,
        },
      );
      addEvent(task, "imported", "legacy-import", { legacyId: input.legacyId, status: input.status, ...eventData });
      return task;
    });
  }

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    db.close();
  }

  return {
    registerProject,
    getProject,
    listProjects,
    submit,
    submitTask: submit,
    get,
    list,
    listTasks: list,
    cancel,
    submitVerdict,
    waitForChange,
    claimNext,
    heartbeat,
    report,
    fail,
    acknowledgeCancel,
    recoverExpired,
    events,
    close,
    pendingNotifications,
    markNotificationSent,
    importTask,
    getByLegacyId,
  };
}
