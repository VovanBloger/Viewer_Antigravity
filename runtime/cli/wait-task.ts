/**
 * Viewer 2 — ожидатель заданий для беседы-исполнителя (замена wait-command.ts из Dev Bot).
 *
 *   tsx runtime/cli/wait-task.ts --project=<id> [--executor=antigravity] [--owner=<имя>]
 *                                [--timeout-min=<n>] [--poll-ms=1500] [--db=<путь>]
 *
 * Блокируется, пока в очереди проекта не появится задание, затем печатает в stdout РОВНО ОДНУ
 * строку JSON и завершается с кодом 0. Всё остальное (баннер, heartbeat) идёт в stderr.
 * Файлы-блокировки не нужны: выдача задания атомарна, несколько ожидателей на проект допустимы.
 */

import { randomBytes } from "node:crypto";
import os from "node:os";

import { openStore } from "../queue/store.ts";
import type { SqliteTaskStore } from "../queue/store.ts";
import { DEFAULT_EXECUTOR_ID } from "../queue/types.ts";
import { toPublicTask, toServiceError } from "../service.ts";
import { ArgError, assertKnownOptions, optNumber, optString, parseArgs, quoteArg } from "./args.ts";

const SOURCE = "VIEWER_AGENT_QUEUE";
const DEFAULT_POLL_MS = 1500;
const BANNER_EVERY_MS = 5 * 60 * 1000;
/** Столько сбоев чтения очереди подряд — и ожидатель сдаётся, чтобы не висеть молча. */
const MAX_CONSECUTIVE_ERRORS = 10;
const TASK_CLI = "npm run --silent agents:task --";
const WAIT_CLI = "npm run --silent agents:wait --";

function info(message: string): void {
  console.error(`[wait-task] ${message}`);
}

/** Единственная запись в stdout за всю жизнь процесса. */
function emit(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function defaultOwner(executorId: string): string {
  const host = os.hostname().replace(/[^A-Za-z0-9_-]/g, "") || "host";
  return `${executorId}-${host}-${randomBytes(3).toString("hex")}`;
}

async function main(): Promise<number> {
  let store: SqliteTaskStore | undefined;
  const finish = (code: number): number => {
    store?.close();
    return code;
  };

  let projectArg: string;
  let executorId: string;
  let ownerArg: string | undefined;
  let timeoutMin: number | undefined;
  let pollMs: number;
  let dbPath: string | undefined;
  try {
    const args = parseArgs(process.argv.slice(2));
    assertKnownOptions(args, ["project", "executor", "owner", "timeout-min", "poll-ms", "db"]);
    if (args.positionals.length > 0) throw new ArgError(`Лишний аргумент: ${args.positionals[0]}`);
    const project = optString(args, "project");
    if (project === undefined) {
      throw new ArgError("Не указан проект. Запуск: agents:wait -- --project=<id> (угадывание по каталогу отключено)");
    }
    projectArg = project;
    executorId = optString(args, "executor") ?? DEFAULT_EXECUTOR_ID;
    ownerArg = optString(args, "owner");
    timeoutMin = optNumber(args, "timeout-min", { min: 0 });
    pollMs = optNumber(args, "poll-ms", { min: 50, integer: true }) ?? DEFAULT_POLL_MS;
    dbPath = optString(args, "db");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    info(`Ошибка: ${message}`);
    emit({ source: SOURCE, status: "ERROR", code: "INVALID_INPUT", message });
    return 2;
  }

  try {
    store = openStore(dbPath === undefined ? {} : { dbPath });
  } catch (error) {
    const failure = toServiceError(error);
    info(`Не удалось открыть базу очереди: ${failure.message}`);
    emit({ source: SOURCE, status: "ERROR", ...failure });
    return 1;
  }
  const queue = store;

  const project = queue.getProject(projectArg);
  if (!project) {
    const known = queue.listProjects().map((p) => p.id);
    const message =
      `Проект "${projectArg}" не зарегистрирован. ` +
      (known.length > 0 ? `Известные проекты: ${known.join(", ")}.` : "Зарегистрированных проектов нет.") +
      " Другой проект автоматически не подставляется.";
    info(`Ошибка: ${message}`);
    emit({ source: SOURCE, status: "ERROR", code: "UNKNOWN_PROJECT", message, knownProjects: known });
    return finish(2);
  }

  const owner = ownerArg ?? defaultOwner(executorId);
  const dbSuffix = dbPath === undefined ? "" : ` --db=${quoteArg(dbPath)}`;
  const ownerOpt = `--owner=${quoteArg(owner)}`;

  // Сигнал остановки: закрыть базу и выйти с кодом 0, ничего не печатая в stdout.
  let wake: (() => void) | undefined;
  let stopped = false;
  const stop = (): void => {
    stopped = true;
    wake?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      }
      wake = done;
    });

  info(`Жду задания для проекта «${project.name}» (${project.id}), исполнитель ${executorId}, владелец ${owner}`);
  info("Тихое ожидание: токены не расходуются. Задание придёт одной строкой JSON в stdout.");

  const startedAt = Date.now();
  const deadline = timeoutMin === undefined ? undefined : startedAt + timeoutMin * 60_000;
  let lastBanner = startedAt;
  let errors = 0;

  while (!stopped) {
    try {
      // claimNext отмечает потерянные задания ошибкой, без автоматической повторной выдачи.
      const task = queue.claimNext({ projectId: project.id, executorId, owner });
      errors = 0;
      if (task) {
        const reportFile = `${os.tmpdir().replace(/\\/g, "/")}/report-${task.id}.json`;
        emit({
          source: SOURCE,
          status: "NEW_TASK",
          owner,
          project: { id: project.id, name: project.name, path: project.path },
          task: toPublicTask(task),
          instructions: {
            heartbeat: `${TASK_CLI} heartbeat ${task.id} ${ownerOpt}${dbSuffix}`,
            report: `${TASK_CLI} report ${task.id} ${quoteArg(`@${reportFile}`)} ${ownerOpt}${dbSuffix}`,
            fail: `${TASK_CLI} fail ${task.id} "ПРИЧИНА" ${ownerOpt}${dbSuffix}`,
            ackCancel: `${TASK_CLI} ack-cancel ${task.id} ${ownerOpt}${dbSuffix}`,
            rearm: `${WAIT_CLI} --project=${quoteArg(project.id)} --executor=${quoteArg(executorId)}${dbSuffix}`,
          },
        });
        info(`Выдано задание ${task.id} (раунд ${task.round}, выдача ${task.attempt})`);
        return finish(0);
      }
    } catch (error) {
      errors += 1;
      const failure = toServiceError(error);
      info(`Сбой чтения очереди (${errors}/${MAX_CONSECUTIVE_ERRORS}): ${failure.message}`);
      if (errors >= MAX_CONSECUTIVE_ERRORS) {
        emit({ source: SOURCE, status: "ERROR", ...failure });
        return finish(1);
      }
    }

    const now = Date.now();
    if (deadline !== undefined && now >= deadline) {
      emit({ source: SOURCE, status: "IDLE_TIMEOUT" });
      info("Заданий не было — тайм-аут ожидания. Взведите ожидатель снова.");
      return finish(0);
    }
    if (now - lastBanner >= BANNER_EVERY_MS) {
      lastBanner = now;
      info(`Ожидатель активен (${project.id}), ${new Date(now).toLocaleTimeString("ru-RU")}`);
    }
    await sleep(deadline === undefined ? pollMs : Math.max(1, Math.min(pollMs, deadline - now)));
  }

  info("Остановлен по сигналу.");
  return finish(0);
}

main().then(
  // Выход — только после того, как строка JSON действительно ушла в stdout.
  (code) => process.stdout.write("", () => process.exit(code)),
  (error: unknown) => {
    console.error("[wait-task] Непредвиденная ошибка:", toServiceError(error).message);
    process.exit(1);
  },
);
