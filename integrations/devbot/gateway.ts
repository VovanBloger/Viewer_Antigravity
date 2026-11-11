import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { TelegramClient } from "./client.ts";
import { BotHandlers } from "./handlers.ts";
import { OutboxService } from "./outbox.ts";
import { getDevBotSettings, ensureDevBotDirectories, registerDefaultProjects } from "./config.ts";
import type { SqliteTaskStore } from "../../runtime/queue/store.ts";
import { DevBotDb } from "./db.ts";

export interface GatewayOptions {
  dataDir?: string;
  defaultProjectId?: string;
  allowedUsers?: Set<number>;
  configPath?: string;
  pollTimeout?: number;
  db?: DevBotDb;
}

export class TelegramGateway {
  private client: TelegramClient;
  private store: SqliteTaskStore;
  private db: DevBotDb;
  private handlers: BotHandlers;
  private outbox: OutboxService;
  private dataDir: string;
  private isRunning = false;
  private pollTimeout: number;
  private botIdentity: string;
  private pollerOwnerId: string;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(client: TelegramClient, store: SqliteTaskStore, options?: GatewayOptions) {
    this.client = client;
    this.store = store;

    const settings = getDevBotSettings(options?.dataDir);
    ensureDevBotDirectories(settings);

    this.dataDir = settings.dataDir;
    this.pollTimeout = options?.pollTimeout ?? 25;
    this.db = options?.db || new DevBotDb(path.join(this.dataDir, "devbot.sqlite"));

    // Register default projects in store
    registerDefaultProjects(store, options?.configPath);

    this.handlers = new BotHandlers(client, store, {
      dataDir: this.dataDir,
      defaultProjectId: options?.defaultProjectId || settings.defaultProjectId,
      allowedUsers: options?.allowedUsers || settings.allowedUsers,
      db: this.db,
    });

    this.outbox = new OutboxService(client, store, {
      ttsCacheDir: settings.ttsCacheDir,
      db: this.db,
    });

    // Derive stable bot identity bound to token
    const rawToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
    this.botIdentity = rawToken
      ? createHash("sha256").update(rawToken).digest("hex").slice(0, 16)
      : "devbot_default";

    this.pollerOwnerId = `poller-${process.pid}-${randomBytes(4).toString("hex")}`;
  }

  getDb(): DevBotDb {
    return this.db;
  }

  getHandlers(): BotHandlers {
    return this.handlers;
  }

  getOutbox(): OutboxService {
    return this.outbox;
  }

  getOffset(): number {
    return this.db.getCursorOffset(this.botIdentity);
  }

  // =========================================================================
  // Atomic Single-Poller Lock (Point 1: Fail-closed, DB-bound)
  // =========================================================================

  checkSingleInstance(): boolean {
    return this.db.acquireLock(this.botIdentity, this.pollerOwnerId, process.pid, 30_000);
  }

  cleanupLock(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.db.releaseLock(this.botIdentity, this.pollerOwnerId);
  }

  /**
   * Run a single poll iteration:
   * 1. Fetches updates from Telegram using cursor from DB.
   * 2. Durably commits updates to SQLite inbox and updates cursor atomically.
   * 3. Dispatches pending inbox updates to handlers.
   * 4. Delivers pending outbox notifications with chunk/retry progress.
   */
  async pollOnce(): Promise<number> {
    const offset = this.getOffset();
    const updates = await this.client.getUpdates(offset, 50, this.pollTimeout);

    // 1. Ingest into SQLite inbox durably (cursor is updated inside transaction)
    if (updates.length > 0) {
      this.db.ingestInboundUpdates(updates, this.botIdentity);
    }

    // 2. Process all pending updates from SQLite inbox FIFO
    const pending = this.db.getPendingInboxUpdates(50);
    let processedCount = 0;

    for (const item of pending) {
      try {
        await this.handlers.handleUpdate(item.payload);
        this.db.markUpdateProcessed(item.update_id);
        processedCount += 1;
      } catch (err: any) {
        console.error(`[TelegramGateway] Error handling update ${item.update_id}:`, err.message || err);
        this.db.markUpdateFailed(item.update_id, err.message || String(err));
      }
    }

    // 3. Process persistent outbox delivery
    try {
      await this.outbox.deliverPending();
    } catch (outboxErr: any) {
      console.warn("[TelegramGateway] Outbox delivery error:", outboxErr.message || outboxErr);
    }

    return processedCount;
  }

  async start(): Promise<void> {
    if (!this.checkSingleInstance()) {
      console.error(`[TelegramGateway] Ошибка: другой процесс уже держит активный шлюз (bot: ${this.botIdentity}). Завершаю работу (fail-closed).`);
      return;
    }

    this.isRunning = true;

    // Start background poller heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.db.heartbeatLock(this.botIdentity, this.pollerOwnerId, 30_000);
    }, 10_000);

    const onShutdown = () => {
      this.stop();
      process.exit(0);
    };

    process.on("exit", () => this.cleanupLock());
    process.on("SIGINT", onShutdown);
    process.on("SIGTERM", onShutdown);

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
