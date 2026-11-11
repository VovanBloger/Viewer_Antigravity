/**
 * Импорт очереди старого моста (Antigravity Dev Bot) в новое хранилище.
 * Исходные файлы только читаются — в них никогда ничего не пишется.
 */

import fs from "node:fs";

import type { ImportedTask, SqliteTaskStore } from "./store.ts";
import { DEFAULT_EXECUTOR_ID, QueueError } from "./types.ts";
import type { TaskStatus } from "./types.ts";

/** Формат команды Dev Bot (src/core/queue.ts → DevCommand); читаем только нужные поля. */
interface LegacyCommand {
  id?: unknown;
  projectId?: unknown;
  chatId?: unknown;
  author?: unknown;
  text?: unknown;
  status?: unknown;
  createdAt?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  result?: unknown;
  error?: unknown;
  attachments?: unknown;
}

interface LegacyProject {
  id?: unknown;
  name?: unknown;
  path?: unknown;
  aliases?: unknown;
}

export interface LegacyImportOptions {
  /** data/queue.json старого моста. */
  queueFile: string;
  /** config/projects.config.json старого моста. */
  projectsFile?: string;
}

export interface LegacyImportResult {
  /** Сколько проектов зарегистрировано (или обновлено) из projectsFile. */
  projects: number;
  imported: number;
  /** Пропущено: PENDING_CONFIRMATION, уже импортированные ранее и записи без id / с неизвестным статусом. */
  skipped: number;
  /** Не импортированные команды с незарегистрированным проектом, в виде "CMD-001 (projectId)". */
  unknownProject: string[];
}

const STATUS_MAP: Record<string, TaskStatus> = {
  QUEUED: "QUEUED",
  IN_PROGRESS: "QUEUED",
  COMPLETED: "APPROVED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, ""));
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isoOr(value: unknown, fallback: string): string {
  const text = str(value);
  if (!text) return fallback;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? fallback : new Date(ms).toISOString();
}

function importProjects(store: SqliteTaskStore, file: string): number {
  const raw = readJson(file) as { projects?: unknown };
  const list = Array.isArray(raw?.projects) ? (raw.projects as LegacyProject[]) : [];
  let count = 0;
  for (const item of list) {
    const id = str(item?.id);
    const projectPath = str(item?.path);
    if (!id || !projectPath) continue;
    const name = str(item.name) ?? id;
    const aliases = Array.isArray(item.aliases) ? item.aliases.filter((a): a is string => typeof a === "string") : [];
    try {
      store.registerProject({ id, name, path: projectPath, aliases });
    } catch (error) {
      // Алиас занят другим проектом — регистрируем без алиасов, точный id важнее.
      if (!(error instanceof QueueError) || error.code !== "INVALID_INPUT") throw error;
      store.registerProject({ id, name, path: projectPath });
    }
    count += 1;
  }
  return count;
}

export function importLegacyQueue(store: SqliteTaskStore, options: LegacyImportOptions): LegacyImportResult {
  const result: LegacyImportResult = { projects: 0, imported: 0, skipped: 0, unknownProject: [] };
  if (options.projectsFile) result.projects = importProjects(store, options.projectsFile);

  const raw = readJson(options.queueFile) as { commands?: unknown };
  const commands = Array.isArray(raw?.commands) ? (raw.commands as LegacyCommand[]) : [];
  const epoch = new Date(0).toISOString();
  // В старом файле новые команды лежат первыми; импортируем от старых к новым, чтобы сохранить порядок FIFO.
  const ordered = commands
    .map((command, index) => ({ command, index, createdAt: isoOr(command?.createdAt, epoch) }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || b.index - a.index);

  for (const { command, createdAt } of ordered) {
    const legacyId = str(command?.id);
    const legacyStatus = str(command?.status) ?? "";
    const status = STATUS_MAP[legacyStatus];
    if (!legacyId || !status) {
      result.skipped += 1;
      continue;
    }
    if (store.getByLegacyId(legacyId)) {
      result.skipped += 1;
      continue;
    }
    const projectId = str(command.projectId) ?? "";
    const project = store.getProject(projectId);
    if (!project || project.id.toLowerCase() !== projectId.trim().toLowerCase()) {
      result.unknownProject.push(`${legacyId} (${projectId})`);
      continue;
    }

    const text = (str(command.text) ?? legacyId).trim();
    const firstLine = text.split(/\r?\n/, 1)[0].trim() || legacyId;
    const chatId = typeof command.chatId === "number" && Number.isFinite(command.chatId) ? command.chatId : undefined;
    const finishedAt = isoOr(command.completedAt, isoOr(command.startedAt, createdAt));

    const task: ImportedTask = {
      projectId: project.id,
      executorId: DEFAULT_EXECUTOR_ID,
      kind: "develop",
      title: firstLine.length > 80 ? firstLine.slice(0, 80) : firstLine,
      goal: text,
      acceptance: [],
      coordinatorId: "telegram",
      notify: chatId === undefined ? { telegram: false } : { telegram: true, chatId },
      meta: {
        author: str(command.author) ?? "",
        attachments: Array.isArray(command.attachments) ? command.attachments : [],
        legacy: true,
      },
      status,
      round: 0,
      attempt: 0,
      cancelRequested: false,
      verdicts: [],
      createdAt,
      updatedAt: status === "QUEUED" ? createdAt : finishedAt,
      legacyId,
    };
    if (status === "APPROVED") {
      task.report = {
        summary: str(command.result) ?? "",
        changedFiles: [],
        checks: [],
        artifacts: [],
        openQuestions: [],
      };
    }
    if (status === "FAILED") {
      task.failure = { code: "EXECUTOR_ERROR", reason: str(command.error) ?? "Причина не указана" };
    }

    const eventData: Record<string, unknown> = { legacyStatus };
    if (legacyStatus === "IN_PROGRESS") {
      eventData.note = "В старой очереди задание выполнялось; прежний исполнитель неизвестен — возвращено в QUEUED";
    }
    store.importTask(task, eventData);
    result.imported += 1;
  }
  return result;
}
