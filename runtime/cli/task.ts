/**
 * Viewer 2 — CLI исполнителя и оператора очереди заданий.
 *
 *   tsx runtime/cli/task.ts <команда> … [--db=<путь>]
 *
 * Данные — JSON в stdout (его разбирают агенты), сообщения для человека — в stderr.
 * При ошибке: ненулевой код выхода и { code, message } в stdout.
 */

import fs from "node:fs";

import { importLegacyQueue } from "../queue/legacy-import.ts";
import { openStore } from "../queue/store.ts";
import type { SqliteTaskStore } from "../queue/store.ts";
import { QueueError } from "../queue/types.ts";
import type { TaskReport, TaskSpec, TaskStatus } from "../queue/types.ts";
import {
  cancelTask,
  getTask,
  listTasks,
  recentEvents,
  submitTask,
  submitVerdict,
  toListItem,
  toPublicTask,
  toServiceError,
  waitTask,
} from "../service.ts";
import {
  ArgError,
  assertKnownOptions,
  fileRef,
  optFlag,
  optList,
  optNumber,
  optString,
  parseArgs,
  requireString,
  stripBom,
} from "./args.ts";
import type { ParsedArgs } from "./args.ts";

const USAGE = `Использование: agents:task -- <команда> … [--db=<путь к базе>]

Координатор / оператор:
  submit @spec.json                      поставить задание (spec — объект TaskSpec)
  get <id> [--full]                      состояние задания и последние события
  list [--project=] [--status=] [--limit=20]
  events <id>                            полный журнал задания
  wait <id> [--since=<version>] [--timeout-sec=120]
  cancel <id> --by=<кто>
  verdict <id> approve|request_changes [--notes=<текст|@файл>] --by=<кто>
                                         approve ничего не сливает и не деплоит
Исполнитель:
  heartbeat <id> --owner=<владелец>      продлить владение; в ответе cancelRequested
  report <id> @report.json --owner=<владелец>
  fail <id> <причина|@файл> --owner=<владелец> [--code=EXECUTOR_ERROR]
  ack-cancel <id> --owner=<владелец>
Обслуживание:
  projects list
  projects add --id= --name= --path= [--alias=a,b]
  import-legacy --file=<queue.json> [--projects=<projects.config.json>]
  recover                                остановить задания с истёкшим сроком владения`;

const STATUSES: readonly TaskStatus[] = ["QUEUED", "IN_PROGRESS", "REPORTED", "APPROVED", "RETURNED", "FAILED", "CANCELLED"];

interface Outcome {
  data: unknown;
  /** Сообщение для человека (stderr). */
  note?: string;
}

function say(message: string): void {
  console.error(`[agents:task] ${message}`);
}

function readTextFile(file: string): string {
  try {
    return stripBom(fs.readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new QueueError("INVALID_INPUT", `Не удалось прочитать файл "${file}": ${reason}`);
  }
}

/** Читает JSON из аргумента "@файл" (допускается и просто путь). */
function readJsonArg<T>(arg: string | undefined, label: string): T {
  if (arg === undefined) throw new ArgError(`Не указан файл: ${label}`);
  const file = fileRef(arg) ?? arg;
  const text = readTextFile(file);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new QueueError("INVALID_INPUT", `Файл "${file}" не является корректным JSON: ${reason}`);
  }
}

/** "текст" либо "@файл" с текстом. */
function textArg(value: string): string {
  const file = fileRef(value);
  return file === undefined ? value : readTextFile(file).trim();
}

function taskIdArg(args: ParsedArgs, index: number = 1): string {
  const id = args.positionals[index];
  if (id === undefined) throw new ArgError("Не указан id задания (например, T-000001)");
  return id;
}

function noExtra(args: ParsedArgs, count: number): void {
  if (args.positionals.length > count) throw new ArgError(`Лишний аргумент: ${args.positionals[count]}`);
}

async function runCommand(store: SqliteTaskStore, args: ParsedArgs): Promise<Outcome> {
  const command = args.positionals[0];
  const known = (names: string[]): void => assertKnownOptions(args, [...names, "db"]);
  const compact = { compact: true };

  switch (command) {
    case "submit": {
      known([]);
      noExtra(args, 2);
      const spec = readJsonArg<TaskSpec>(args.positionals[1], "submit @spec.json");
      const task = submitTask(store, spec);
      return { data: { task: toPublicTask(task, compact) }, note: `Задание ${task.id} в очереди проекта ${task.projectId}` };
    }
    case "get": {
      known(["full"]);
      noExtra(args, 2);
      const task = getTask(store, taskIdArg(args));
      return {
        data: { task: toPublicTask(task, { compact: !optFlag(args, "full") }), events: recentEvents(store, task.id, 10) },
      };
    }
    case "list": {
      known(["project", "status", "limit"]);
      noExtra(args, 1);
      const status = optString(args, "status")?.toUpperCase() as TaskStatus | undefined;
      if (status !== undefined && !STATUSES.includes(status)) {
        throw new ArgError(`Недопустимый статус "${status}". Допустимые: ${STATUSES.join(", ")}`);
      }
      const tasks = listTasks(store, {
        projectId: optString(args, "project"),
        status,
        limit: optNumber(args, "limit", { min: 1, integer: true }),
      });
      return { data: { tasks: tasks.map((task) => toListItem(task)) }, note: `Заданий: ${tasks.length}` };
    }
    case "events": {
      known([]);
      noExtra(args, 2);
      return { data: { events: recentEvents(store, taskIdArg(args), 0) } };
    }
    case "wait": {
      known(["since", "timeout-sec"]);
      noExtra(args, 2);
      const result = await waitTask(store, taskIdArg(args), {
        sinceVersion: optNumber(args, "since", { min: 0, integer: true }),
        timeoutMs: (optNumber(args, "timeout-sec", { min: 0 }) ?? 120) * 1000,
      });
      return {
        data: { changed: result.changed, task: toPublicTask(result.task, compact) },
        note: result.changed ? `Задание ${result.task.id}: ${result.task.status}` : "Изменений нет (тайм-аут)",
      };
    }
    case "cancel": {
      known(["by"]);
      noExtra(args, 2);
      const task = cancelTask(store, taskIdArg(args), requireString(args, "by"));
      return {
        data: { task: toPublicTask(task, compact) },
        note: task.status === "CANCELLED" ? `Задание ${task.id} отменено` : `Задание ${task.id}: отмена запрошена, исполнитель увидит её при heartbeat`,
      };
    }
    case "verdict": {
      known(["notes", "by"]);
      noExtra(args, 3);
      const id = taskIdArg(args);
      const decision = args.positionals[2];
      if (decision !== "approve" && decision !== "request_changes") {
        throw new ArgError("Решение должно быть approve или request_changes");
      }
      const by = requireString(args, "by");
      const rawNotes = optString(args, "notes");
      const notes = rawNotes === undefined ? undefined : textArg(rawNotes);
      const task = submitVerdict(store, id, { decision, by, ...(notes !== undefined ? { notes } : {}) });
      return {
        data: { task: toPublicTask(task, compact) },
        note: `Задание ${task.id}: ${task.status}${decision === "approve" ? " (слияние и деплой не выполнялись)" : ""}`,
      };
    }
    case "heartbeat": {
      known(["owner"]);
      noExtra(args, 2);
      const result = store.heartbeat(taskIdArg(args), requireString(args, "owner"));
      const lease = result.task.leaseExpiresAt;
      return {
        data: {
          taskId: result.task.id,
          status: result.task.status,
          cancelRequested: result.cancelRequested,
          ...(lease !== undefined ? { leaseExpiresAt: new Date(lease).toISOString() } : {}),
        },
        note: result.cancelRequested
          ? `Координатор запросил отмену задания ${result.task.id}: остановитесь и выполните ack-cancel`
          : `Владение заданием ${result.task.id} продлено`,
      };
    }
    case "report": {
      known(["owner"]);
      noExtra(args, 3);
      const id = taskIdArg(args);
      const owner = requireString(args, "owner");
      const report = readJsonArg<TaskReport>(args.positionals[2], "report <id> @report.json");
      const task = store.report(id, owner, report);
      return {
        data: { task: toPublicTask(task, compact) },
        note: task.status === "CANCELLED" ? `Задание ${task.id} было отменено; отчёт сохранён` : `Отчёт по заданию ${task.id} сдан, ждёт вердикта`,
      };
    }
    case "fail": {
      known(["owner", "code"]);
      noExtra(args, 3);
      const id = taskIdArg(args);
      const owner = requireString(args, "owner");
      const rawReason = args.positionals[2];
      if (rawReason === undefined) throw new ArgError("Не указана причина: fail <id> <причина|@файл> --owner=");
      const task = store.fail(id, owner, { code: optString(args, "code") ?? "EXECUTOR_ERROR", reason: textArg(rawReason) });
      return { data: { task: toPublicTask(task, compact) }, note: `Задание ${task.id} отмечено как невыполненное` };
    }
    case "ack-cancel": {
      known(["owner"]);
      noExtra(args, 2);
      const task = store.acknowledgeCancel(taskIdArg(args), requireString(args, "owner"));
      return { data: { task: toPublicTask(task, compact) }, note: `Отмена задания ${task.id} подтверждена` };
    }
    case "projects": {
      const sub = args.positionals[1];
      noExtra(args, 2);
      if (sub === "list") {
        known([]);
        return { data: { projects: store.listProjects() } };
      }
      if (sub === "add") {
        known(["id", "name", "path", "alias"]);
        const aliases = optList(args, "alias");
        const project = store.registerProject({
          id: requireString(args, "id"),
          name: requireString(args, "name"),
          path: requireString(args, "path"),
          ...(aliases !== undefined ? { aliases } : {}),
        });
        return { data: { project }, note: `Проект ${project.id} зарегистрирован` };
      }
      throw new ArgError("Ожидается: projects list | projects add --id= --name= --path= [--alias=a,b]");
    }
    case "import-legacy": {
      known(["file", "projects"]);
      noExtra(args, 1);
      const projectsFile = optString(args, "projects");
      const result = importLegacyQueue(store, {
        queueFile: requireString(args, "file"),
        ...(projectsFile !== undefined ? { projectsFile } : {}),
      });
      return { data: result, note: `Импортировано заданий: ${result.imported}, пропущено: ${result.skipped}` };
    }
    case "recover": {
      known([]);
      noExtra(args, 1);
      const recovered = store.recoverExpired().map((task) => toListItem(task));
      return { data: { recovered }, note: `Заданий с истёкшим сроком владения: ${recovered.length}` };
    }
    default:
      throw new ArgError(command === undefined ? "Не указана команда" : `Неизвестная команда: ${command}`);
  }
}

async function main(): Promise<number> {
  let store: SqliteTaskStore | undefined;
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.positionals[0] === "help" || args.options.help === true) {
      console.error(USAGE);
      return 0;
    }
    const dbPath = optString(args, "db");
    store = openStore(dbPath === undefined ? {} : { dbPath });
    const outcome = await runCommand(store, args);
    process.stdout.write(`${JSON.stringify(outcome.data, null, 2)}\n`);
    if (outcome.note) say(outcome.note);
    return 0;
  } catch (error) {
    if (error instanceof ArgError) {
      process.stdout.write(`${JSON.stringify({ code: "INVALID_INPUT", message: error.message }, null, 2)}\n`);
      say(`Ошибка: ${error.message}`);
      console.error(USAGE);
      return 2;
    }
    const failure = toServiceError(error);
    process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
    say(`Ошибка ${failure.code}: ${failure.message}`);
    return 1;
  } finally {
    store?.close();
  }
}

main().then(
  (code) => process.stdout.write("", () => process.exit(code)),
  (error: unknown) => {
    console.error("[agents:task] Непредвиденная ошибка:", toServiceError(error).message);
    process.exit(1);
  },
);
