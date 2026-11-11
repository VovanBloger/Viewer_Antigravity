/**
 * Viewer 2 — общий слой между хранилищем и интерфейсами (MCP-сервер и CLI),
 * чтобы оба вели себя одинаково: одни и те же проверки, вырезание секретов и тексты прогресса.
 */

import { redactDeep } from "./queue/redact.ts";
import { QueueError, TERMINAL_STATUSES } from "./queue/types.ts";
import type { AgentTask, TaskEvent, TaskFilter, TaskSpec, TaskStatus, TaskStore, Verdict } from "./queue/types.ts";

export interface ServiceError {
  code: string;
  message: string;
}

/** Задание в том виде, в каком оно уходит наружу (моделям и оператору). */
export type PublicTask = AgentTask & { progress?: string };

export interface TaskListItem {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  round: number;
  updatedAt: string;
  progress: string;
}

export interface PublicTaskOptions {
  /** Обрезать длинные тексты, убрать служебные поля и добавить строку progress. */
  compact?: boolean;
  /** Текущее время (Unix ms) для строки прогресса — подменяется в тестах. */
  now?: number;
}

export interface WaitOptions {
  /** Версия, которую вызывающий уже видел. Не задана — ждём изменения относительно текущего состояния. */
  sinceVersion?: number;
  timeoutMs: number;
}

export interface WaitResult {
  task: AgentTask;
  changed: boolean;
}

export const DEFAULT_LIST_LIMIT = 20;
export const SUMMARY_LIMIT = 2000;
export const CHECK_DETAILS_LIMIT = 500;
export const VERDICT_NOTES_LIMIT = 1000;

/** Поля контракта AgentTask. Всё, чего здесь нет, наружу не выдаётся. */
const PUBLIC_KEYS = [
  "id",
  "projectId",
  "executorId",
  "coordinatorId",
  "kind",
  "title",
  "goal",
  "acceptance",
  "constraints",
  "allowedPaths",
  "checks",
  "expectedArtifacts",
  "baseRevision",
  "branch",
  "workdir",
  "notify",
  "idempotencyKey",
  "leaseMs",
  "meta",
  "status",
  "round",
  "attempt",
  "owner",
  "leaseExpiresAt",
  "heartbeatAt",
  "cancelRequested",
  "report",
  "verdicts",
  "failure",
  "version",
  "createdAt",
  "updatedAt",
  "legacyId",
] as const satisfies readonly (keyof AgentTask)[];

/** В кратком виде не нужны: это служебные данные постановки, а не состояние задания. */
const COMPACT_OMIT: readonly string[] = ["idempotencyKey", "leaseMs", "meta", "notify"];

/** Превращает любую ошибку в { code, message }; сообщение проходит через вырезание секретов. */
export function toServiceError(error: unknown): ServiceError {
  if (error instanceof QueueError) return { code: error.code, message: redactDeep(error.message) };
  const message = error instanceof Error ? error.message : String(error);
  return { code: "INTERNAL", message: redactDeep(message) };
}

function trimText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}… [обрезано, всего ${text.length} символов]`;
}

function ago(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds} с`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} мин`;
  return `${Math.round(minutes / 60)} ч`;
}

/** Короткая строка «что сейчас с заданием» для человека и модели. */
export function describeProgress(task: AgentTask, now: number = Date.now()): string {
  switch (task.status) {
    case "QUEUED":
      if (task.round > 0) return `Возвращено на исправление, раунд ${task.round}; ждёт исполнителя`;
      if (task.attempt > 0) return `Снова в очереди после потери исполнителя (выдач: ${task.attempt})`;
      return "В очереди, ждёт исполнителя";
    case "IN_PROGRESS": {
      const beat = task.heartbeatAt === undefined ? "heartbeat не было" : `heartbeat ${ago(now - task.heartbeatAt)} назад`;
      const round = task.round > 0 ? `, раунд ${task.round}` : "";
      const cancel = task.cancelRequested ? "; запрошена отмена" : "";
      return `В работе у ${task.owner ?? "неизвестного исполнителя"}, ${beat}${round}${cancel}`;
    }
    case "REPORTED":
      return "Ждёт вердикта координатора";
    case "APPROVED":
      return "Принято координатором (слияние и деплой не выполнялись)";
    case "RETURNED":
      return "Возвращено координатору: исчерпаны раунды исправлений";
    case "FAILED":
      return `Не выполнено: ${task.failure?.code ?? "причина неизвестна"}`;
    case "CANCELLED":
      return "Отменено";
    default:
      return String(task.status);
  }
}

/**
 * Готовит задание к выдаче наружу: только поля контракта, все строки — через redactDeep.
 * В кратком режиме длинные тексты обрезаются и добавляется progress.
 */
export function toPublicTask(task: AgentTask, opts: PublicTaskOptions = {}): PublicTask {
  const source = task as unknown as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of PUBLIC_KEYS) {
    if (source[key] === undefined) continue;
    if (opts.compact && COMPACT_OMIT.includes(key)) continue;
    picked[key] = source[key];
  }
  const out = redactDeep(picked) as unknown as PublicTask;
  if (!opts.compact) return out;

  if (out.report) {
    out.report = {
      ...out.report,
      summary: trimText(out.report.summary, SUMMARY_LIMIT),
      checks: out.report.checks.map((check) =>
        check.details === undefined ? check : { ...check, details: trimText(check.details, CHECK_DETAILS_LIMIT) },
      ),
    };
  }
  out.verdicts = out.verdicts.map((verdict) =>
    verdict.notes === undefined ? verdict : { ...verdict, notes: trimText(verdict.notes, VERDICT_NOTES_LIMIT) },
  );
  if (out.failure) out.failure = { ...out.failure, reason: trimText(out.failure.reason, VERDICT_NOTES_LIMIT) };
  out.progress = describeProgress(task, opts.now);
  return out;
}

export function toListItem(task: AgentTask, now?: number): TaskListItem {
  return redactDeep({
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    status: task.status,
    round: task.round,
    updatedAt: task.updatedAt,
    progress: describeProgress(task, now),
  });
}

export function submitTask(store: TaskStore, spec: TaskSpec): AgentTask {
  return store.submit(spec);
}

/** Не найдено → QueueError("NOT_FOUND"). */
export function getTask(store: TaskStore, id: string): AgentTask {
  const task = store.get(id);
  if (!task) throw new QueueError("NOT_FOUND", `Задание не найдено: ${String(id)}`);
  return task;
}

/** Последние limit событий задания (по умолчанию 10), от старых к новым. */
export function recentEvents(store: TaskStore, id: string, limit: number = 10): TaskEvent[] {
  const events = store.events(getTask(store, id).id);
  return redactDeep(limit > 0 ? events.slice(-limit) : events);
}

/** Последние limit заданий, новые первыми. Неизвестный проект в фильтре → UNKNOWN_PROJECT. */
export function listTasks(store: TaskStore, filter: TaskFilter = {}): AgentTask[] {
  if (filter.projectId !== undefined && !store.getProject(filter.projectId)) {
    throw new QueueError("UNKNOWN_PROJECT", `Неизвестный проект: "${filter.projectId}"`);
  }
  const limit = filter.limit ?? DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) throw new QueueError("INVALID_INPUT", "limit должен быть целым положительным числом");
  // Хранилище отдаёт задания от старых к новым, а нужны самые свежие — срез делаем здесь.
  const all = store.list({ ...filter, limit: undefined });
  return all.slice(-limit).reverse();
}

/** Существенное изменение — всё, кроме продления срока владения (heartbeat). */
function differs(a: AgentTask, b: AgentTask): boolean {
  return (
    a.status !== b.status ||
    a.round !== b.round ||
    a.attempt !== b.attempt ||
    a.owner !== b.owner ||
    a.cancelRequested !== b.cancelRequested
  );
}

/**
 * Ждёт существенного изменения задания, не будя вызывающего на каждый heartbeat.
 * - sinceVersion задан и уже устарел → сразу changed = true;
 * - sinceVersion не задан, а задание ждёт вердикта или завершено → сразу changed = false (ждать нечего);
 * - по тайм-ауту → текущее состояние и changed = false.
 */
export async function waitTask(store: TaskStore, id: string, options: WaitOptions): Promise<WaitResult> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
    throw new QueueError("INVALID_INPUT", "Тайм-аут ожидания должен быть неотрицательным числом");
  }
  const since = options.sinceVersion;
  if (since !== undefined && (!Number.isInteger(since) || since < 0)) {
    throw new QueueError("INVALID_INPUT", "sinceVersion должен быть целым неотрицательным числом");
  }
  store.recoverExpired();
  const start = getTask(store, id);
  if (since !== undefined && start.version > since) return { task: start, changed: true };
  if (since === undefined && (start.status === "REPORTED" || TERMINAL_STATUSES.includes(start.status))) {
    return { task: start, changed: false };
  }
  const deadline = Date.now() + options.timeoutMs;
  let current = start;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return { task: current, changed: false };
    const next = await store.waitForChange(start.id, current.version, left);
    if (next.version === current.version) return { task: next, changed: false };
    if (differs(start, next)) return { task: next, changed: true };
    current = next;
  }
}

export function cancelTask(store: TaskStore, id: string, by: string): AgentTask {
  return store.cancel(id, by);
}

export function submitVerdict(store: TaskStore, id: string, verdict: Verdict): AgentTask {
  return store.submitVerdict(id, verdict);
}
