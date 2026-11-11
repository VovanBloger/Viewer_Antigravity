/**
 * Viewer 2 — канонический адаптер ожидателя задач для проектов Telegram Dev Bot.
 *
 *   tsx integrations/devbot/runner/wait-command.ts --project=<id> --db=<путь> [--owner=<имя>] [--executor=antigravity]
 *
 * Требует явного указания --project и --db, сверяет путь проекта, не убивает чужие процессы,
 * атомарно захватывает задачу и печатает в stdout ровно одну строку JSON с инструкциями.
 */

import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config();

import { openStore, defaultDbPath } from "../../../runtime/queue/index.ts";
import { toPublicTask } from "../../../runtime/service.ts";
import { parseArgs, optString, requireString, quoteArg } from "../../../runtime/cli/args.ts";

function info(msg: string): void {
  console.error(`[wait-command] ${msg}`);
}

function defaultOwner(executorId: string): string {
  const host = os.hostname().replace(/[^A-Za-z0-9_-]/g, "") || "host";
  return `${executorId}-${host}-${randomBytes(3).toString("hex")}`;
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

  let projectArg: string;
  try {
    projectArg = requireString(parsed, "project").trim().toLowerCase();
  } catch {
    info("Ошибка: параметр --project=<id> обязателен (угадывание по cwd запрещено)");
    return 2;
  }

  const dbPath = optString(parsed, "db") || process.env.VIEWER_QUEUE_DB || defaultDbPath();
  const executorId = (optString(parsed, "executor") || "antigravity").trim();
  const owner = (optString(parsed, "owner") || defaultOwner(executorId)).trim();
  const pollMs = 1500;

  const store = openStore({ dbPath });

  const project = store.getProject(projectArg);
  if (!project) {
    info(`Ошибка: проект «${projectArg}» не зарегистрирован в базе ${dbPath}. Выход.`);
    store.close();
    return 2;
  }

  info(`Слушатель активен для: ${project.name} (${project.id})`);
  info(`Исполнитель: ${executorId}, владелец: ${owner}`);
  info(`Каталог проекта: ${project.path}`);
  info(`Тихое ожидание (0 токенов)...`);

  const taskCli = "npm run --silent devbot:cmd --";
  const waitCli = "npm run --silent devbot:wait --";

  let loops = 0;
  while (true) {
    loops += 1;
    try {
      const task = store.claimNext({
        projectId: project.id,
        executorId,
        owner,
      });

      if (task) {
        const payload = {
          source: "VIEWER_AGENT_QUEUE",
          status: "NEW_TASK",
          owner,
          project: {
            id: project.id,
            name: project.name,
            path: project.path,
          },
          task: toPublicTask(task),
          instructions: {
            heartbeat: `${taskCli} heartbeat ${task.id} --owner=${quoteArg(owner)} --db=${quoteArg(dbPath)}`,
            report: `${taskCli} complete ${task.id} "@report.json" --owner=${quoteArg(owner)} --db=${quoteArg(dbPath)}`,
            fail: `${taskCli} fail ${task.id} "ПРИЧИНА" --owner=${quoteArg(owner)} --db=${quoteArg(dbPath)}`,
            rearm: `${waitCli} --project=${quoteArg(project.id)} --executor=${quoteArg(executorId)} --db=${quoteArg(dbPath)}`,
          },
        };

        process.stdout.write(`${JSON.stringify(payload)}\n`);
        store.close();
        return 0;
      }
    } catch (err: any) {
      info(`Ошибка чтения очереди: ${err.message || err}`);
    }

    if (loops % 120 === 0) {
      info(`💓 Heartbeat [${project.id}]: слушатель активен, время: ${new Date().toLocaleTimeString("ru-RU")}`);
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

main().then((code) => {
  process.exit(code);
}).catch((err) => {
  info(`Фатальная ошибка: ${err.message || err}`);
  process.exit(1);
});
