import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config();

import { openStore, defaultDbPath } from "../../../runtime/queue/index.ts";
import { TelegramClient } from "../client.ts";
import { OutboxService } from "../outbox.ts";
import { loadProjectConfigs } from "../config.ts";

function readContent(arg: string): string {
  if (arg.startsWith("@")) {
    const filePath = arg.slice(1).trim().replace(/^["']|["']$/g, "");
    const candidates = [
      filePath,
      path.resolve(process.cwd(), filePath),
      path.resolve("C:/Users/vovan/Desktop/Журнал CRM", filePath),
      path.resolve("H:/Мой диск/VPN", filePath),
      path.resolve("C:/Users/vovan/Desktop/MyAssAgent", filePath),
      path.resolve("C:/Users/vovan/Desktop/Antigravity Dev Bot", filePath),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        return fs.readFileSync(cand, "utf-8");
      }
    }
    throw new Error(`Файл отчёта не найден: ${filePath}`);
  }
  return arg;
}

function resolveTask(store: any, targetId: string) {
  if (!targetId) return undefined;
  // Try direct ID
  let task = store.get(targetId);
  if (!task) {
    // Try legacyId (e.g. CMD-071)
    task = store.getByLegacyId(targetId);
  }
  if (!task) {
    // Try seq format
    const match = /^T-(\d+)$/i.exec(targetId);
    if (!match && /^\d+$/.test(targetId)) {
      task = store.get(`T-${targetId.padStart(6, "0")}`);
    }
  }
  return task;
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0]?.toLowerCase();
  const targetId = args[1];

  const dbArg = args.find((a) => a.startsWith("--db="));
  const dbPath = dbArg ? dbArg.replace("--db=", "").trim() : (process.env.VIEWER_QUEUE_DB || defaultDbPath());

  const store = openStore({ dbPath });
  const client = new TelegramClient();
  const outbox = new OutboxService(client, store);

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
    console.log(`✔ Задание #${task.id} (${task.projectId}) переведено в статус IN_PROGRESS`);
    return;
  }

  if (action === "complete") {
    if (!targetId || !args[2]) {
      console.error("Использование: complete <TASK_ID> <текст_или_@файл>");
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

    const reportText = readContent(args[2]);

    // Report task via store
    store.report(task.id, task.owner || "antigravity", {
      summary: reportText,
      changedFiles: [],
      checks: [],
      artifacts: [],
      openQuestions: [],
    });

    console.log(`✔ Задание #${task.id} помечено как REPORTED`);

    // Process notification delivery via Outbox
    await outbox.deliverPending();
    return;
  }

  if (action === "fail") {
    if (!targetId || !args[2]) {
      console.error("Использование: fail <TASK_ID> <текст_ошибки_или_@файл>");
      process.exit(1);
    }
    const task = resolveTask(store, targetId);
    if (!task) {
      console.error(`❌ Задание #${targetId} не найдено`);
      process.exit(1);
    }

    const errorText = readContent(args[2]);
    store.fail(task.id, task.owner || "antigravity", {
      code: "EXECUTOR_ERROR",
      reason: errorText,
    });

    console.log(`✔ Задание #${task.id} помечено как FAILED`);
    await outbox.deliverPending();
    return;
  }

  console.log("Использование: cli.ts [status|start|complete|fail] [TASK_ID] [данные]");
}

main().catch((err) => {
  console.error("Ошибка CLI:", err);
  process.exit(1);
});
