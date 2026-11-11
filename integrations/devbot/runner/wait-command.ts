import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config();

import { openStore, defaultDbPath } from "../../../runtime/queue/index.ts";
import { getDevBotSettings, ensureDevBotDirectories, registerDefaultProjects } from "../config.ts";

function detectTargetProject(): string | undefined {
  const args = process.argv.slice(2);
  const projArg = args.find((a) => a.startsWith("--project="));
  if (projArg) return projArg.replace("--project=", "").toLowerCase().trim();

  if (process.env.DEV_PROJECT_ID) return process.env.DEV_PROJECT_ID.toLowerCase().trim();

  const cwd = process.cwd().toLowerCase();
  if (cwd.includes("viewer")) return "viewer";
  if (cwd.includes("myassagent") || cwd.includes("assistant")) return "myassagent";
  if (cwd.includes("vpn")) return "vpn";
  if (cwd.includes("antigravity dev bot")) return "devbot";
  if (cwd.includes("crm") || cwd.includes("журнал")) return "crm";
  if (cwd.includes("cyber-empire") || cwd.includes("game")) return "game";

  return undefined;
}

const targetProjectId = detectTargetProject();
const args = process.argv.slice(2);
const dbArg = args.find((a) => a.startsWith("--db="));
const dbPath = dbArg ? dbArg.replace("--db=", "").trim() : (process.env.VIEWER_QUEUE_DB || defaultDbPath());

const settings = getDevBotSettings();
ensureDevBotDirectories(settings);

const LOCK_FILE = path.join(settings.lockDir, `listener-${targetProjectId || "all"}.lock`);

function checkSingleInstance() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const raw = fs.readFileSync(LOCK_FILE, "utf-8").trim();
      let existingPid: number | null = null;
      let updatedAt = 0;
      try {
        const parsed = JSON.parse(raw);
        existingPid = parsed.pid;
        updatedAt = parsed.updatedAt || 0;
      } catch {
        existingPid = parseInt(raw, 10);
      }

      const isAlive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };

      if (existingPid && !isNaN(existingPid) && existingPid !== process.pid) {
        const isFresh = Date.now() - updatedAt < 15000;
        if (isAlive(existingPid) && isFresh && !process.argv.includes("--force")) {
          console.log(`[wait-command] Слушатель проекта ${targetProjectId} уже активно работает (PID: ${existingPid}). Выход.`);
          process.exit(0);
        }
        try {
          process.kill(existingPid);
        } catch {}
      }
    }
    touchLock();
  } catch {}
}

function touchLock() {
  try {
    fs.writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: process.pid, projectId: targetProjectId, updatedAt: Date.now() }),
      "utf-8"
    );
  } catch {}
}

function cleanupLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const raw = fs.readFileSync(LOCK_FILE, "utf-8").trim();
      let existingPid: number | null = null;
      try {
        existingPid = JSON.parse(raw).pid;
      } catch {
        existingPid = parseInt(raw, 10);
      }
      if (existingPid === process.pid) {
        fs.unlinkSync(LOCK_FILE);
      }
    }
  } catch {}
}

process.on("exit", cleanupLock);
process.on("SIGINT", () => {
  cleanupLock();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanupLock();
  process.exit(0);
});

async function main() {
  checkSingleInstance();

  const store = openStore({ dbPath });
  registerDefaultProjects(store);

  const project = targetProjectId ? store.getProject(targetProjectId) : undefined;
  const projectLabel = project ? `${project.name} (${project.id})` : (targetProjectId || "Любой проект");

  console.log(`[wait-command] 🎧 Слушатель активен для: ${projectLabel}`);
  console.log(`[wait-command] Ожидание задач из SQLite очереди Viewer (0 токенов)...`);

  const owner = `antigravity-${os.hostname()}-${process.pid}`;
  let loops = 0;

  while (true) {
    loops += 1;
    if (loops % 3 === 0) {
      touchLock();
    }

    // Determine target projects to check
    const candidateProjects = targetProjectId
      ? [targetProjectId]
      : store.listProjects().map((p) => p.id);

    for (const projId of candidateProjects) {
      const task = store.claimNext({
        projectId: projId,
        executorId: "antigravity",
        owner,
      });

      if (task) {
        const taskProject = store.getProject(task.projectId) || {
          id: task.projectId,
          name: task.projectId,
          path: process.cwd(),
        };

        console.log(
          JSON.stringify({
            source: "ANTIGRAVITY_DEV_BOT",
            status: "NEW_COMMAND",
            id: task.id,
            projectId: taskProject.id,
            projectName: taskProject.name,
            projectPath: taskProject.path,
            chatId: task.notify?.chatId,
            author: (task.meta?.author as string) || "Пользователь",
            text: task.goal,
            isDangerous: false,
            createdAt: task.createdAt,
            attachments: (task.meta?.attachments as any[]) || [],
          })
        );

        cleanupLock();
        process.exit(0);
      }
    }

    if (loops % 120 === 0) {
      console.log(`[wait-command] 💓 Heartbeat [${projectLabel}]: слушатель активен, время: ${new Date().toLocaleTimeString("ru-RU")}`);
    }

    await new Promise((r) => setTimeout(r, 1500));
  }
}

main().catch((err) => {
  cleanupLock();
  console.error("[wait-command] Error:", err);
  process.exit(1);
});
