import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import type { TaskStore } from "../../runtime/queue/types.ts";
import type { DevBotProjectConfig } from "./types.ts";

// Load environment variables if available
dotenv.config();

export interface DevBotSettings {
  token: string;
  allowedUsers: Set<number>;
  dataDir: string;
  incomingDir: string;
  ttsCacheDir: string;
  defaultProjectId: string;
}

export function parseAllowedUsers(raw?: string): Set<number> {
  const source = raw ?? process.env.TELEGRAM_ALLOWED_USERS ?? "";
  const allowed = new Set<number>();
  for (const part of source.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num > 0) {
      allowed.add(num);
    }
  }
  return allowed;
}

export function getDevBotSettings(customDataDir?: string): DevBotSettings {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim().replace(/^["']|["']$/g, "");
  const allowedUsers = parseAllowedUsers();

  const baseDataDir = customDataDir || process.env.DEVBOT_DATA_DIR || path.resolve(process.cwd(), ".viewer-live", "devbot");
  const dataDir = path.resolve(baseDataDir);
  const incomingDir = path.join(dataDir, "incoming");
  const ttsCacheDir = path.join(dataDir, "cache", "tts");

  return {
    token,
    allowedUsers,
    dataDir,
    incomingDir,
    ttsCacheDir,
    defaultProjectId: (process.env.DEFAULT_PROJECT_ID || "viewer").trim().toLowerCase(),
  };
}

export function ensureDevBotDirectories(settings: DevBotSettings): void {
  for (const dir of [settings.dataDir, settings.incomingDir, settings.ttsCacheDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Loads project configurations from a specified file or environment variable.
 * Throws explicit error on invalid JSON or missing required fields; does not swallow errors.
 */
export function loadProjectConfigs(configPath?: string): DevBotProjectConfig[] {
  const targetPath = configPath || process.env.DEVBOT_PROJECTS_CONFIG;
  if (!targetPath) {
    // Only return default relocatable viewer project when no config is configured
    return [
      {
        id: "viewer",
        name: "Viewer 2",
        icon: "👁️",
        description: "Мобильная студия предварительного просмотра и управления агентами Viewer 2",
        path: process.cwd(),
        aliases: ["viewer", "вьювер", "вивер", "студия", "viewer2"],
      },
    ];
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(`[DevBotConfig] Конфигурационный файл проектов не найден: ${targetPath}`);
  }

  const raw = fs.readFileSync(targetPath, "utf-8").replace(/^\uFEFF/, "");
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`[DevBotConfig] Ошибка парсинга JSON конфигурации проектов (${targetPath}): ${err.message || err}`);
  }

  if (!parsed || !Array.isArray(parsed.projects)) {
    throw new Error(`[DevBotConfig] Неверная структура конфигурации: ожидается массив "projects" в ${targetPath}`);
  }

  return parsed.projects.map((p: any, idx: number) => {
    if (!p.id || typeof p.id !== "string") {
      throw new Error(`[DevBotConfig] Проект #${idx} не содержит обязательного поля "id"`);
    }
    if (!p.path || typeof p.path !== "string") {
      throw new Error(`[DevBotConfig] Проект "${p.id}" не содержит обязательного поля "path"`);
    }
    return {
      id: p.id.trim().toLowerCase(),
      name: p.name || p.id,
      icon: p.icon || "📁",
      description: p.description || "",
      path: path.isAbsolute(p.path) ? p.path : path.resolve(path.dirname(targetPath), p.path),
      aliases: Array.isArray(p.aliases) ? p.aliases.map((a: any) => String(a).toLowerCase().trim()) : [],
    };
  });
}

export function registerDefaultProjects(store: TaskStore, configPath?: string): DevBotProjectConfig[] {
  const projects = loadProjectConfigs(configPath);
  for (const p of projects) {
    try {
      store.registerProject({
        id: p.id,
        name: p.name,
        path: p.path,
        aliases: p.aliases,
      });
    } catch {
      // Already registered or duplicate alias — ignore safely
    }
  }
  return projects;
}
