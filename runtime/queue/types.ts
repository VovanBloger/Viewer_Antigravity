/**
 * Viewer 2 — контракт очереди заданий для агентов.
 *
 * Схема: координатор (Codex / Claude) → очередь → ожидающая беседа Antigravity
 * → отчёт → вердикт координатора.
 *
 * Этот файл — единый источник правды для store, MCP-сервера, CLI и ожидателя.
 * Только стираемый синтаксис TypeScript (без enum / parameter properties),
 * чтобы файлы запускались и через tsx, и через встроенный type stripping Node 24.
 */

/** Сколько раз задание можно вернуть на исправление, прежде чем оно уйдёт координатору (RETURNED). */
export const MAX_FIX_ROUNDS = 2;
/** Потерянный исполнитель может ещё менять файлы: автоматической повторной выдачи нет. */
export const MAX_DELIVERY_ATTEMPTS = 1;
/** Срок владения по умолчанию: исполнитель — беседа модели, а не процесс, поэтому срок длинный. */
export const DEFAULT_LEASE_MS = 30 * 60 * 1000;
export const DEFAULT_EXECUTOR_ID = "antigravity";

export type TaskStatus =
  /** Ждёт исполнителя. */
  | "QUEUED"
  /** Выдано исполнителю; действует срок владения (lease). */
  | "IN_PROGRESS"
  /** Исполнитель сдал отчёт; ждёт вердикта координатора. */
  | "REPORTED"
  /** Координатор принял результат. Слияние и деплой НЕ выполняются автоматически. */
  | "APPROVED"
  /** Исчерпаны раунды исправлений — задача возвращена координатору с причиной. */
  | "RETURNED"
  /** Исполнитель сообщил об ошибке либо потерян MAX_DELIVERY_ATTEMPTS раз. */
  | "FAILED"
  | "CANCELLED";

export const TERMINAL_STATUSES: readonly TaskStatus[] = ["APPROVED", "RETURNED", "FAILED", "CANCELLED"];

export type TaskKind = "develop" | "test" | "browser-check" | "review" | "diagnostic";

export interface NotifyOptions {
  /** Отправить отчёт в Telegram через Dev Bot. По умолчанию false для локальных заданий. */
  telegram?: boolean;
  /** Синтезировать голосовой отчёт. По умолчанию false. */
  tts?: boolean;
  /** chatId получателя — обязателен, если telegram = true. */
  chatId?: number;
}

/** То, что присылает координатор. */
export interface TaskSpec {
  /** Точный id зарегистрированного проекта. Неизвестный проект → QueueError("UNKNOWN_PROJECT"). */
  projectId: string;
  /** Кому адресовано задание. По умолчанию DEFAULT_EXECUTOR_ID. */
  executorId?: string;
  kind: TaskKind;
  title: string;
  /** Цель в свободной форме. */
  goal: string;
  /** Проверяемые условия готовности. */
  acceptance: string[];
  constraints?: string[];
  /** Разрешённые области изменений (glob-пути относительно проекта). Пусто = без ограничений. */
  allowedPaths?: string[];
  /** Команды, которые исполнитель обязан запустить программно (сборка, тесты). */
  checks?: string[];
  expectedArtifacts?: string[];
  /** Кто поставил задачу и будет выносить вердикт: "codex", "claude", "telegram", … */
  coordinatorId: string;
  baseRevision?: string;
  /** Ветка / worktree, в которой следует работать. */
  branch?: string;
  /** Переопределение рабочего каталога; по умолчанию — путь проекта. */
  workdir?: string;
  notify?: NotifyOptions;
  /** Повторная отправка с тем же ключом возвращает уже созданное задание. */
  idempotencyKey?: string;
  /** Срок владения в миллисекундах; по умолчанию DEFAULT_LEASE_MS. */
  leaseMs?: number;
  /** Произвольные данные источника (например, вложения Telegram). Секреты сюда не класть. */
  meta?: Record<string, unknown>;
}

export interface CheckResult {
  command: string;
  ok: boolean;
  details?: string;
}

export interface Artifact {
  type: "screenshot" | "log" | "diff" | "file";
  /** Локальный путь. Содержимое в очередь не кладётся. */
  path: string;
  note?: string;
}

/** То, что сдаёт исполнитель. */
export interface TaskReport {
  summary: string;
  /** Итоговая ревизия кода (commit sha), если были изменения. */
  revision?: string;
  changedFiles: string[];
  checks: CheckResult[];
  artifacts: Artifact[];
  openQuestions: string[];
  /** Модель, заявленная исполнителем. Не проверяется мостом. */
  model?: string;
}

export interface Verdict {
  decision: "approve" | "request_changes";
  notes?: string;
  /** Кто вынес вердикт. */
  by: string;
}

export interface VerdictRecord extends Verdict {
  /** Раунд, к которому относится вердикт. */
  round: number;
  at: string;
}

export interface TaskFailure {
  /** Машинный код: "EXECUTOR_ERROR" | "EXECUTOR_LOST" | "FIX_ROUNDS_EXHAUSTED" | "QUOTA_EXHAUSTED" | … */
  code: string;
  reason: string;
}

/** Задание в том виде, в каком его возвращают store, MCP и CLI. */
export interface AgentTask extends TaskSpec {
  /** Вид "T-000123". */
  id: string;
  executorId: string;
  status: TaskStatus;
  /** Раунд исправлений: 0 — первая попытка, растёт при request_changes. */
  round: number;
  /** Сколько раз задание выдавалось исполнителю в текущем раунде. */
  attempt: number;
  /** Идентификатор текущего владельца (сессии исполнителя). */
  owner?: string;
  /** Unix ms. */
  leaseExpiresAt?: number;
  heartbeatAt?: number;
  /** Координатор попросил остановить выполняемое задание. */
  cancelRequested: boolean;
  /** Отчёт последнего раунда. */
  report?: TaskReport;
  verdicts: VerdictRecord[];
  failure?: TaskFailure;
  /** Растёт при каждом изменении — на нём основано ожидание без опроса моделью. */
  version: number;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
  /** Для заданий, импортированных из очереди Dev Bot (например, "CMD-071"). */
  legacyId?: string;
}

export interface TaskEvent {
  taskId: string;
  at: string;
  /** "submitted" | "claimed" | "heartbeat" | "reported" | "verdict" | "requeued" | "lease_expired" | "cancel_requested" | "cancelled" | "failed" | "imported" */
  type: string;
  actor: string;
  data?: Record<string, unknown>;
}

export interface Project {
  /** Точный идентификатор; сравнение без учёта регистра, без нечёткого поиска по имени. */
  id: string;
  name: string;
  /** Абсолютный путь рабочего каталога. */
  path: string;
  aliases?: string[];
}

export interface TaskFilter {
  projectId?: string;
  executorId?: string;
  coordinatorId?: string;
  status?: TaskStatus | TaskStatus[];
  limit?: number;
}

export interface ClaimOptions {
  /** Обязателен: ожидатель обслуживает ровно один проект. */
  projectId: string;
  executorId: string;
  /** Уникальное имя сессии исполнителя. */
  owner: string;
  leaseMs?: number;
}

export type QueueErrorCode =
  | "UNKNOWN_PROJECT"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "LEASE_LOST"
  | "INVALID_INPUT";

export class QueueError extends Error {
  code: QueueErrorCode;
  constructor(code: QueueErrorCode, message: string) {
    super(message);
    this.name = "QueueError";
    this.code = code;
  }
}

/**
 * Публичный интерфейс хранилища. Реализация — runtime/queue/store.ts (SQLite, node:sqlite).
 * Все изменяющие операции атомарны между процессами (BEGIN IMMEDIATE).
 */
export interface TaskStore {
  // ── проекты ──
  registerProject(project: Project): Project;
  /** Точное совпадение id или алиаса. Не найдено → undefined (никакого «активного проекта»). */
  getProject(idOrAlias: string): Project | undefined;
  listProjects(): Project[];

  // ── координатор ──
  submit(spec: TaskSpec): AgentTask;
  get(id: string): AgentTask | undefined;
  list(filter?: TaskFilter): AgentTask[];
  /**
   * QUEUED / REPORTED → сразу CANCELLED. IN_PROGRESS → cancelRequested = true,
   * исполнитель увидит это при heartbeat. Терминальные статусы → INVALID_STATE.
   */
  cancel(id: string, by: string): AgentTask;
  /**
   * Только для REPORTED. approve → APPROVED (без слияния и деплоя).
   * request_changes → round + 1 и снова QUEUED; если round уже равен MAX_FIX_ROUNDS →
   * RETURNED с failure.code = "FIX_ROUNDS_EXHAUSTED".
   */
  submitVerdict(id: string, verdict: Verdict): AgentTask;
  /**
   * Ждёт, пока version задания станет больше sinceVersion, либо истечёт timeoutMs.
   * Работает между процессами. По тайм-ауту возвращает текущее состояние.
   */
  waitForChange(id: string, sinceVersion: number, timeoutMs: number): Promise<AgentTask>;

  // ── исполнитель ──
  /** Атомарно выдаёт самое старое QUEUED-задание проекта и исполнителя. Двое не получат одно задание. */
  claimNext(options: ClaimOptions): AgentTask | null;
  /** Продлевает срок владения. Чужой или истёкший владелец → LEASE_LOST. */
  heartbeat(id: string, owner: string, leaseMs?: number): { task: AgentTask; cancelRequested: boolean };
  /** IN_PROGRESS → REPORTED. Если был запрошен cancel — отчёт сохраняется, статус CANCELLED. */
  report(id: string, owner: string, report: TaskReport): AgentTask;
  fail(id: string, owner: string, failure: TaskFailure): AgentTask;
  /** Исполнитель подтверждает остановку: IN_PROGRESS + cancelRequested → CANCELLED. */
  acknowledgeCancel(id: string, owner: string): AgentTask;

  // ── обслуживание ──
  /**
   * IN_PROGRESS с истёкшим сроком владения → FAILED / EXECUTOR_LOST,
   * либо CANCELLED, если отмена уже запрошена. Автоматического повторного запуска нет.
   */
  recoverExpired(now?: number): AgentTask[];
  events(taskId: string): TaskEvent[];
  close(): void;
}
