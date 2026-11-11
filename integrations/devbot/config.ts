import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import type { TaskStore } from "../../runtime/queue/types.ts";
import type { DevBotProjectConfig } from "./types.ts";

// Load environment variables if available
dotenv.config();

export interface DevBotSettings {
  token: string;
  allowedUsers: Set<string>;
  dataDir: string;
  incomingDir: string;
  ttsCacheDir: string;
  lockDir: string;
  defaultProjectId: string;
}

export function getDevBotSettings(customDataDir?: string): DevBotSettings {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim().replace(/^["']|["']$/g, "");
  const rawAllowed = process.env.TELEGRAM_ALLOWED_USERS || "356165930,Vovanbloger";
  const allowedUsers = new Set(
    rawAllowed.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  );

  const baseDataDir = customDataDir || process.env.DEVBOT_DATA_DIR || path.resolve(process.cwd(), ".viewer-live", "devbot");
  const dataDir = path.resolve(baseDataDir);
  const incomingDir = path.join(dataDir, "incoming");
  const ttsCacheDir = path.join(dataDir, "cache", "tts");
  const lockDir = path.join(dataDir, "locks");

  return {
    token,
    allowedUsers,
    dataDir,
    incomingDir,
    ttsCacheDir,
    lockDir,
    defaultProjectId: (process.env.DEFAULT_PROJECT_ID || "viewer").trim().toLowerCase(),
  };
}

export function ensureDevBotDirectories(settings: DevBotSettings): void {
  for (const dir of [settings.dataDir, settings.incomingDir, settings.ttsCacheDir, settings.lockDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function loadProjectConfigs(configPath?: string): DevBotProjectConfig[] {
  const candidates = [
    configPath,
    process.env.DEVBOT_PROJECTS_CONFIG,
    path.resolve(process.cwd(), "config", "projects.config.json"),
    path.resolve(process.cwd(), "integrations", "devbot", "projects.config.example.json"),
  ].filter((p): p is string => Boolean(p && fs.existsSync(p)));

  if (candidates.length > 0) {
    try {
      const raw = fs.readFileSync(candidates[0], "utf-8").replace(/^\uFEFF/, "");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.projects)) {
        return parsed.projects.map((p: any) => ({
          ...p,
          path: path.isAbsolute(p.path) ? p.path : path.resolve(process.cwd(), p.path),
        }));
      }
    } catch (e) {
      console.warn("[DevBotConfig] Warning: could not parse projects config:", e);
    }
  }

  // Fallback defaults
  return [
    {
      id: "viewer",
      name: "Viewer 2",
      icon: "👁️",
      description: "Мобильная студия предварительного просмотра и управления агентами Viewer 2",
      path: process.cwd(),
      aliases: ["viewer", "вьювер", "вивер", "студия", "viewer2"],
    },
    {
      id: "crm",
      name: "Журнал ERP & CRM",
      icon: "📊",
      description: "Система управления заказами, сменами, сотрудниками и финансами",
      path: "c:\\Users\\vovan\\Desktop\\Журнал CRM",
      aliases: ["crm", "срм", "журнал", "erp"],
    },
    {
      id: "vpn",
      name: "Антенна VPN",
      icon: "🛡️",
      description: "Сервис VPN, Reality ноды, Remnawave",
      path: "h:\\Мой диск\\VPN",
      aliases: ["vpn", "впн", "антенна", "antenna"],
    },
    {
      id: "myassagent",
      name: "Тг ассистент (@MyAssAgent)",
      icon: "🎭",
      description: "Telegram Serverless-бот (tgcloud), персональный секретарь",
      path: "c:\\Users\\vovan\\Desktop\\MyAssAgent",
      aliases: ["assistant", "myass", "secretary", "личный", "тг ассистент", "ассистент"],
    },
    {
      id: "devbot",
      name: "Antigravity Dev Bot",
      icon: "🤖",
      description: "Телеграм-бот AI-разработчика и координатор Antigravity",
      path: "c:\\Users\\vovan\\Desktop\\Antigravity Dev Bot",
      aliases: ["devbot", "девобот", "dev bot"],
    },
    {
      id: "game",
      name: "Игра Cyber Empire",
      icon: "🎮",
      description: "Telegram Mini App игра Cyber Empire",
      path: "c:\\Users\\vovan\\Desktop\\vpn-tycoon_-cyber-empire",
      aliases: ["game", "игра", "игру", "cyber empire"],
    },
  ];
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
