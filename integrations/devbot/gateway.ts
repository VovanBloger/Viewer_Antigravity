import fs from "node:fs";
import path from "node:path";
import type { TelegramClient } from "./client.ts";
import { BotHandlers } from "./handlers.ts";
import { OutboxService } from "./outbox.ts";
import { getDevBotSettings, ensureDevBotDirectories, registerDefaultProjects } from "./config.ts";
import type { SqliteTaskStore } from "../../runtime/queue/store.ts";

export interface GatewayOptions {
  dataDir?: string;
  defaultProjectId?: string;
  allowedUsers?: Set<string>;
  configPath?: string;
  pollTimeout?: number;
}

export class TelegramGateway {
  private client: TelegramClient;
  private store: SqliteTaskStore;
  private handlers: BotHandlers;
  private outbox: OutboxService;
  private dataDir: string;
  private lockFile: string;
  private offsetFile: string;
  private isRunning = false;
  private processedUpdates: Set<number> = new Set();
  private maxSeenUpdates = 5000;
  private pollTimeout: number;

  constructor(client: TelegramClient, store: SqliteTaskStore, options?: GatewayOptions) {
    this.client = client;
    this.store = store;

    const settings = getDevBotSettings(options?.dataDir);
    ensureDevBotDirectories(settings);

    this.dataDir = settings.dataDir;
    this.lockFile = path.join(settings.lockDir, "dev-bot.lock");
    this.offsetFile = path.join(settings.dataDir, "update_offset.json");
    this.pollTimeout = options?.pollTimeout ?? 25;

    // Register default projects in store if not present
    registerDefaultProjects(store, options?.configPath);

    this.handlers = new BotHandlers(client, store, {
      dataDir: this.dataDir,
      defaultProjectId: options?.defaultProjectId || settings.defaultProjectId,
      allowedUsers: options?.allowedUsers || settings.allowedUsers,
    });

    this.outbox = new OutboxService(client, store, {
      ttsCacheDir: settings.ttsCacheDir,
    });

    this.loadState();
  }

  getHandlers(): BotHandlers {
    return this.handlers;
  }

  getOutbox(): OutboxService {
    return this.outbox;
  }

  private loadState(): void {
    try {
      if (fs.existsSync(this.offsetFile)) {
        const raw = fs.readFileSync(this.offsetFile, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.seen)) {
          for (const id of parsed.seen) {
            if (typeof id === "number") this.processedUpdates.add(id);
          }
        }
      }
    } catch {
      // Ignore initial state read errors
    }
  }

  private saveState(offset: number): void {
    try {
      // Keep seen updates bounded to prevent memory growth
      const seenArray = Array.from(this.processedUpdates).slice(-this.maxSeenUpdates);
      fs.writeFileSync(
        this.offsetFile,
        JSON.stringify({ offset, seen: seenArray, updatedAt: new Date().toISOString() }, null, 2),
        "utf-8"
      );
    } catch (e: any) {
      console.warn("[TelegramGateway] Warning: failed to save offset state:", e.message || e);
    }
  }

  getOffset(): number {
    try {
      if (fs.existsSync(this.offsetFile)) {
        const raw = fs.readFileSync(this.offsetFile, "utf-8");
        const parsed = JSON.parse(raw);
        if (typeof parsed.offset === "number") return parsed.offset;
      }
    } catch {}
    return 0;
  }

  checkSingleInstance(): boolean {
    try {
      if (fs.existsSync(this.lockFile)) {
        const pidStr = fs.readFileSync(this.lockFile, "utf-8").trim();
        const pid = parseInt(pidStr, 10);
        if (!isNaN(pid) && pid !== process.pid) {
          try {
            process.kill(pid, 0);
            return false; // Already running alive process
          } catch {
            // Stale lock
          }
        }
      }
      fs.mkdirSync(path.dirname(this.lockFile), { recursive: true });
      fs.writeFileSync(this.lockFile, String(process.pid), "utf-8");
      return true;
    } catch {
      return true;
    }
  }

  cleanupLock(): void {
    try {
      if (fs.existsSync(this.lockFile)) {
        const pid = parseInt(fs.readFileSync(this.lockFile, "utf-8").trim(), 10);
        if (pid === process.pid) {
          fs.unlinkSync(this.lockFile);
        }
      }
    } catch {}
  }

  /**
   * Run a single poll iteration: get updates, dedup, dispatch to handlers, deliver outbox.
   * Returns count of newly processed updates.
   */
  async pollOnce(): Promise<number> {
    let offset = this.getOffset();
    const updates = await this.client.getUpdates(offset, 50, this.pollTimeout);

    let processedCount = 0;
    for (const update of updates) {
      if (update.update_id >= offset) {
        offset = update.update_id + 1;
      }

      // Strict update_id deduplication
      if (this.processedUpdates.has(update.update_id)) {
        continue;
      }

      this.processedUpdates.add(update.update_id);
      processedCount += 1;

      try {
        await this.handlers.handleUpdate(update);
      } catch (err: any) {
        console.error(`[TelegramGateway] Error handling update ${update.update_id}:`, err.message || err);
      }
    }

    if (updates.length > 0) {
      this.saveState(offset);
    }

    // Process outbox delivery
    try {
      await this.outbox.deliverPending();
    } catch (outboxErr: any) {
      console.warn("[TelegramGateway] Outbox delivery error:", outboxErr.message || outboxErr);
    }

    return processedCount;
  }

  async start(): Promise<void> {
    if (!this.checkSingleInstance()) {
      console.log(`ℹ️ [TelegramGateway] Бот уже запущен в системе. Завершаю повторный процесс.`);
      return;
    }

    this.isRunning = true;

    process.on("exit", () => this.cleanupLock());
    process.on("SIGINT", () => {
      this.cleanupLock();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      this.cleanupLock();
      process.exit(0);
    });

    console.log("==================================================");
    console.log("🚀 ЗАПУСК VIEWER 2 TELEGRAM GATEWAY (SQLITE QUEUE)");
    console.log("==================================================");

    if (!this.client.isConfigured()) {
      console.warn("⚠️ TELEGRAM_BOT_TOKEN не настроен. Ожидание конфигурации...");
    } else {
      const me = await this.client.apiCall("getMe");
      if (me.ok) {
        console.log(`✔ Авторизован бот: @${me.result.username} («${me.result.first_name}», ID: ${me.result.id})`);
        await this.client.deleteWebhook();
        await this.client.setMyCommands([
          { command: "start", description: "Главное меню и статус" },
          { command: "projects", description: "Выбор активного проекта" },
          { command: "status", description: "Статус очереди Viewer 2" },
          { command: "help", description: "Справка по командам" },
        ]);
      }
    }

    while (this.isRunning) {
      try {
        await this.pollOnce();
      } catch (err: any) {
        console.error("[TelegramGateway] Polling loop error:", err.message || err);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    this.cleanupLock();
  }
}
