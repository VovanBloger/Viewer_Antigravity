import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config();

import { openStore, defaultDbPath } from "../../../runtime/queue/index.ts";
import { parseArgs, optString, requireString } from "../../../runtime/cli/args.ts";

function readContent(arg: string): string {
  if (arg.startsWith("@")) {
    const filePath = arg.slice(1).trim().replace(/^["']|["']$/g, "");
    if (!fs.existsSync(filePath)) {
      throw new Error(`Файл отчёта не найден: ${filePath}`);
    }
    return fs.readFileSync(filePath, "utf-8");
  }
  return arg;
}

function resolveTask(store: any, targetId: string) {
  if (!targetId) return undefined;
  let task = store.get(targetId);
  if (!task) {
    task = store.getByLegacyId(targetId);
  }
  if (!task) {
    const match = /^T-(\d+)$/i.exec(targetId);
    if (!match && /^\d+$/.test(targetId)) {
      task = store.get(`T-${targetId.padStart(6, "0")}`);
    }
  }
  return task;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const action = parsed.positionals[0]?.toLowerCase();
  const targetId = parsed.positionals[1];

  const dbPath = optString(parsed, "db") || process.env.VIEWER_QUEUE_DB || defaultDbPath();
  const explicitOwner = optString(parsed, "owner");

  const store = openStore({ dbPath });

  if (action === "status") {
    const all = store.list();
    const projects = store.listProjects();

    const queued = all.filter((t) => t.status === "QUEUED").length;
    const inProgress = all.filter((t) => t.status === "IN_PROGRESS").length;
    const reported = all.filter((t) => t.status === "REPORTED").length;
    const approved = all.filter((t) => t.status === "APPROVED").length;
    const failed = all.filter((t) => t.status === "FAILED").length;

    console.log("==========================================");
    console.log("📊 СТАТУС VIEWER 2 TELEGRAM GATEWAY");
    console.log("==========================================");
    console.log(`База SQLite:     ${dbPath}`);
    console.log(`Всего заданий:   ${all.length}`);
    console.log(`В очереди:       ${queued}`);
    console.log(`В работе:        ${inProgress}`);
    console.log(`Сдано (REPORT):  ${reported}`);
    console.log(`Принято:         ${approved}`);
    console.log(`Ошибок:          ${failed}`);
    console.log("\nЗарегистрированные проекты:");
    for (const p of projects) {
      console.log(`  • [${p.id}] ${p.name}: ${p.path}`);
    }
    return;
  }

  if (action === "start") {
    if (!targetId) {
      console.error("Укажите ID команды (например: T-000001 или CMD-001)");
      process.exit(1);
    }
    const task = resolveTask(store, targetId);
    if (!task) {
      console.error(`❌ Задание #${targetId} не найдено`);
      process.exit(1);
    }

    if (!explicitOwner) {
      console.error("Ошибка: требуется явный параметр --owner=<имя> (имперсонация запрещена)");
      process.exit(1);
    }

    if (task.status === "QUEUED") {
      store.claimNext({
        projectId: task.projectId,
        executorId: task.executorId,
        owner: explicitOwner,
      });
    }

    console.log(`✔ Задание #${task.id} (${task.projectId}) переведено в статус IN_PROGRESS для владельца ${explicitOwner}`);
    return;
  }

  if (action === "complete") {
    if (!targetId || !parsed.positionals[2]) {
      console.error("Использование: complete <TASK_ID> <текст_или_@файл> --owner=<владелец> [--db=<путь>]");
      process.exit(1);
    }

    if (!explicitOwner) {
      console.error("Ошибка: требуется явный параметр --owner=<имя>");
      process.exit(1);
    }

    const task = resolveTask(store, targetId);
    if (!task) {
      console.error(`❌ Задание #${targetId} не найдено`);
      process.exit(1);
    }

    if (task.status === "APPROVED" || task.status === "REPORTED") {
      console.log(`ℹ️ Задание #${task.id} уже имеет статус ${task.status}.`);
      return;
    }

    const reportText = readContent(parsed.positionals[2]);

    // Report task via store - saving result in SQLite queue
    // Outbox notifications are sent exclusively by the gateway daemon (Point 2: single sender)
    store.report(task.id, explicitOwner, {
      summary: reportText,
      changedFiles: [],
      checks: [],
      artifacts: [],
      openQuestions: [],
    });

    console.log(`✔ Задание #${task.id} сохранено в очереди со статусом REPORTED (доставка выполняется шлюзом)`);
    return;
  }

  if (action === "fail") {
    if (!targetId || !parsed.positionals[2]) {
      console.error("Использование: fail <TASK_ID> <текст_ошибки_или_@файл> --owner=<владелец> [--db=<путь>]");
      process.exit(1);
    }

    if (!explicitOwner) {
      console.error("Ошибка: требуется явный параметр --owner=<имя>");
      process.exit(1);
    }

    const task = resolveTask(store, targetId);
    if (!task) {
      console.error(`❌ Задание #${targetId} не найдено`);
      process.exit(1);
    }

    const errorText = readContent(parsed.positionals[2]);
    store.fail(task.id, explicitOwner, {
      code: "EXECUTOR_ERROR",
      reason: errorText,
    });

    console.log(`✔ Задание #${task.id} сохранено в очереди со статусом FAILED (доставка выполняется шлюзом)`);
    return;
  }

  console.log("Использование: cli.ts [status|start|complete|fail] [TASK_ID] [данные] --owner=<владелец> [--db=<путь>]");
}

main().catch((err) => {
  console.error("Ошибка CLI:", err.message || err);
  process.exit(1);
});
