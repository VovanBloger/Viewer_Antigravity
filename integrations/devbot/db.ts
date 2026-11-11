import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TelegramUpdate, PendingConfirmation, DevBotAttachment } from "./types.ts";

export interface OutboxProgressRecord {
  notification_id: number;
  task_id: string;
  chat_id: number;
  report_snapshot: string;
  text_chunks_total: number;
  text_chunks_sent: number;
  text_delivered: number;
  voice_delivered: number;
  voice_pending: number;
  attempts: number;
  next_retry_at: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export class DevBotDb {
  private db: DatabaseSync;

  constructor(dbOrPath: DatabaseSync | string) {
    if (typeof dbOrPath === "string") {
      if (dbOrPath !== ":memory:") {
        const dir = path.dirname(path.resolve(dbOrPath));
        if (dir && !fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      this.db = new DatabaseSync(dbOrPath);
    } else {
      this.db = dbOrPath;
    }

    try {
      this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    } catch {
      // Memory DB or already configured
    }

    this.initSchema();
  }

  getRawDb(): DatabaseSync {
    return this.db;
  }

  close(): void {
    try {
      this.db.close();
    } catch {}
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devbot_locks (
        bot_identity TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        pid INTEGER NOT NULL,
        acquired_at INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        lease_expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devbot_cursor (
        key TEXT PRIMARY KEY,
        last_offset INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devbot_inbox (
        update_id INTEGER PRIMARY KEY,
        received_at INTEGER NOT NULL,
        update_type TEXT NOT NULL,
        chat_id INTEGER,
        user_id INTEGER,
        payload TEXT NOT NULL,
        processed_at INTEGER,
        status TEXT NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_devbot_inbox_pending ON devbot_inbox(status, update_id);

      CREATE TABLE IF NOT EXISTS devbot_chat_state (
        chat_id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        selected_project_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devbot_confirmations (
        id TEXT PRIMARY KEY,
        chat_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL,
        command_text TEXT NOT NULL,
        author TEXT NOT NULL,
        danger_reason TEXT NOT NULL,
        danger_category TEXT NOT NULL,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devbot_outbox_progress (
        notification_id INTEGER PRIMARY KEY,
        task_id TEXT NOT NULL,
        chat_id INTEGER NOT NULL,
        report_snapshot TEXT NOT NULL,
        text_chunks_total INTEGER NOT NULL DEFAULT 1,
        text_chunks_sent INTEGER NOT NULL DEFAULT 0,
        text_delivered INTEGER NOT NULL DEFAULT 0,
        voice_delivered INTEGER NOT NULL DEFAULT 0,
        voice_pending INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_retry_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  // =========================================================================
  // Atomic Single-Poller Lock (Point 1: Fail-closed, bound to bot ID & DB)
  // =========================================================================

  acquireLock(botIdentity: string, ownerId: string, pid: number, leaseMs = 30000): boolean {
    const now = Date.now();
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const row = this.db.prepare("SELECT * FROM devbot_locks WHERE bot_identity = ?").get(botIdentity) as any;

      if (!row) {
        this.db.prepare(`
          INSERT INTO devbot_locks (bot_identity, owner_id, pid, acquired_at, heartbeat_at, lease_expires_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(botIdentity, ownerId, pid, now, now, now + leaseMs);
        this.db.exec("COMMIT");
        return true;
      }

      if (row.owner_id === ownerId) {
        this.db.prepare(`
          UPDATE devbot_locks SET pid = ?, heartbeat_at = ?, lease_expires_at = ?
          WHERE bot_identity = ? AND owner_id = ?
        `).run(pid, now, now + leaseMs, botIdentity, ownerId);
        this.db.exec("COMMIT");
        return true;
      }

      if (row.lease_expires_at < now) {
        // Stale lease takeover — reconciled without killing PIDs or stealing live locks
        this.db.prepare(`
          UPDATE devbot_locks SET owner_id = ?, pid = ?, acquired_at = ?, heartbeat_at = ?, lease_expires_at = ?
          WHERE bot_identity = ?
        `).run(ownerId, pid, now, now, now + leaseMs, botIdentity);
        this.db.exec("COMMIT");
        return true;
      }

      // Live lock active — fail closed!
      this.db.exec("COMMIT");
      return false;
    } catch {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      // Fail closed on any DB error
      return false;
    }
  }

  heartbeatLock(botIdentity: string, ownerId: string, leaseMs = 30000): boolean {
    const now = Date.now();
    try {
      const res = this.db.prepare(`
        UPDATE devbot_locks SET heartbeat_at = ?, lease_expires_at = ?
        WHERE bot_identity = ? AND owner_id = ?
      `).run(now, now + leaseMs, botIdentity, ownerId);
      return res.changes > 0;
    } catch {
      return false;
    }
  }

  releaseLock(botIdentity: string, ownerId: string): void {
    try {
      this.db.prepare("DELETE FROM devbot_locks WHERE bot_identity = ? AND owner_id = ?").run(botIdentity, ownerId);
    } catch {}
  }

  // =========================================================================
  // Cursor & Durable Inbound Updates (Point 3)
  // =========================================================================

  getCursorOffset(key = "default"): number {
    try {
      const row = this.db.prepare("SELECT last_offset FROM devbot_cursor WHERE key = ?").get(key) as any;
      return row?.last_offset ? Number(row.last_offset) : 0;
    } catch {
      return 0;
    }
  }

  setCursorOffset(offset: number, key = "default"): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO devbot_cursor (key, last_offset, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET last_offset = excluded.last_offset, updated_at = excluded.updated_at
    `).run(key, offset, now);
  }

  /**
   * Durably writes updates into SQLite inbox in a single transaction.
   * Advances cursor offset atomically within the same transaction.
   */
  ingestInboundUpdates(updates: TelegramUpdate[], key = "default"): number {
    if (updates.length === 0) return 0;
    const now = Date.now();
    let newCount = 0;
    let maxUpdateId = 0;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const insertStmt = this.db.prepare(`
        INSERT OR IGNORE INTO devbot_inbox (update_id, received_at, update_type, chat_id, user_id, payload, status)
        VALUES (?, ?, ?, ?, ?, ?, 'RECEIVED')
      `);

      for (const u of updates) {
        if (u.update_id > maxUpdateId) maxUpdateId = u.update_id;
        const updateType = u.callback_query ? "callback_query" : u.message ? "message" : "other";
        const chatId = u.callback_query?.message?.chat.id || u.message?.chat.id || null;
        const userId = u.callback_query?.from.id || u.message?.from?.id || null;
        const payload = JSON.stringify(u);

        const res = insertStmt.run(u.update_id, now, updateType, chatId, userId, payload);
        if (res.changes > 0) newCount += 1;
      }

      if (maxUpdateId > 0) {
        const nextOffset = maxUpdateId + 1;
        this.db.prepare(`
          INSERT INTO devbot_cursor (key, last_offset, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET last_offset = MAX(last_offset, excluded.last_offset), updated_at = excluded.updated_at
        `).run(key, nextOffset, now);
      }

      this.db.exec("COMMIT");
      return newCount;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  getPendingInboxUpdates(limit = 50): { update_id: number; payload: TelegramUpdate }[] {
    const rows = this.db.prepare(`
      SELECT update_id, payload FROM devbot_inbox
      WHERE status = 'RECEIVED'
      ORDER BY update_id ASC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map((r) => ({
      update_id: Number(r.update_id),
      payload: JSON.parse(r.payload),
    }));
  }

  markUpdateProcessed(updateId: number): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE devbot_inbox SET status = 'PROCESSED', processed_at = ?, error = NULL
      WHERE update_id = ?
    `).run(now, updateId);
  }

  markUpdateFailed(updateId: number, error: string): void {
    this.db.prepare(`
      UPDATE devbot_inbox SET status = 'FAILED', error = ?
      WHERE update_id = ?
    `).run(error, updateId);
  }

  // =========================================================================
  // Chat Project Selection State (Point 3 & 4)
  // =========================================================================

  getSelectedProject(chatId: number): string | undefined {
    const row = this.db.prepare("SELECT selected_project_id FROM devbot_chat_state WHERE chat_id = ?").get(chatId) as any;
    return row?.selected_project_id ? String(row.selected_project_id) : undefined;
  }

  setSelectedProject(chatId: number, userId: number, projectId: string): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO devbot_chat_state (chat_id, user_id, selected_project_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET user_id = excluded.user_id, selected_project_id = excluded.selected_project_id, updated_at = excluded.updated_at
    `).run(chatId, userId, projectId, now);
  }

  // =========================================================================
  // Persistent Confirmations across restart (Point 3)
  // =========================================================================

  saveConfirmation(conf: PendingConfirmation): void {
    const idempotencyKey = conf.idempotencyKey || `conf_${conf.chatId}_${conf.id}`;
    this.db.prepare(`
      INSERT INTO devbot_confirmations (
        id, chat_id, user_id, idempotency_key, project_id, command_text,
        author, danger_reason, danger_category, attachments_json, created_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
      ON CONFLICT(id) DO UPDATE SET
        command_text = excluded.command_text,
        status = 'PENDING'
    `).run(
      conf.id,
      conf.chatId,
      conf.userId,
      idempotencyKey,
      conf.projectId,
      conf.text,
      conf.author,
      conf.dangerReason || "",
      conf.dangerCategory || "",
      JSON.stringify(conf.attachments || []),
      conf.createdAt || Date.now()
    );
  }

  getConfirmation(id: string): PendingConfirmation | undefined {
    const row = this.db.prepare("SELECT * FROM devbot_confirmations WHERE id = ?").get(id) as any;
    if (!row) return undefined;

    return {
      id: String(row.id),
      chatId: Number(row.chat_id),
      userId: Number(row.user_id),
      idempotencyKey: String(row.idempotency_key),
      projectId: String(row.project_id),
      text: String(row.command_text),
      author: String(row.author),
      dangerReason: String(row.danger_reason),
      dangerCategory: String(row.danger_category) as any,
      attachments: JSON.parse(row.attachments_json || "[]"),
      createdAt: Number(row.created_at),
      status: String(row.status) as any,
    };
  }

  updateConfirmationStatus(id: string, status: "APPROVED" | "CANCELLED" | "EXPIRED"): void {
    this.db.prepare("UPDATE devbot_confirmations SET status = ? WHERE id = ?").run(status, id);
  }

  // =========================================================================
  // Persistent Outbox Progress (Point 2)
  // =========================================================================

  getOutboxProgress(notificationId: number): OutboxProgressRecord | undefined {
    const row = this.db.prepare("SELECT * FROM devbot_outbox_progress WHERE notification_id = ?").get(notificationId) as any;
    if (!row) return undefined;
    return row as OutboxProgressRecord;
  }

  initOutboxProgress(
    notificationId: number,
    taskId: string,
    chatId: number,
    reportSnapshot: string,
    textChunksTotal: number,
    voicePending: boolean
  ): OutboxProgressRecord {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO devbot_outbox_progress (
        notification_id, task_id, chat_id, report_snapshot, text_chunks_total,
        text_chunks_sent, text_delivered, voice_delivered, voice_pending,
        attempts, next_retry_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, 0, 0, ?, ?)
      ON CONFLICT(notification_id) DO NOTHING
    `).run(notificationId, taskId, chatId, reportSnapshot, textChunksTotal, voicePending ? 1 : 0, now, now);

    return this.getOutboxProgress(notificationId)!;
  }

  updateOutboxProgress(
    notificationId: number,
    patch: {
      text_chunks_sent?: number;
      text_delivered?: number;
      voice_delivered?: number;
      voice_pending?: number;
      attempts?: number;
      next_retry_at?: number;
      last_error?: string | null;
    }
  ): void {
    const now = Date.now();
    const fields: string[] = ["updated_at = ?"];
    const values: any[] = [now];

    if (patch.text_chunks_sent !== undefined) {
      fields.push("text_chunks_sent = ?");
      values.push(patch.text_chunks_sent);
    }
    if (patch.text_delivered !== undefined) {
      fields.push("text_delivered = ?");
      values.push(patch.text_delivered);
    }
    if (patch.voice_delivered !== undefined) {
      fields.push("voice_delivered = ?");
      values.push(patch.voice_delivered);
    }
    if (patch.voice_pending !== undefined) {
      fields.push("voice_pending = ?");
      values.push(patch.voice_pending);
    }
    if (patch.attempts !== undefined) {
      fields.push("attempts = ?");
      values.push(patch.attempts);
    }
    if (patch.next_retry_at !== undefined) {
      fields.push("next_retry_at = ?");
      values.push(patch.next_retry_at);
    }
    if (patch.last_error !== undefined) {
      fields.push("last_error = ?");
      values.push(patch.last_error);
    }

    values.push(notificationId);
    this.db.prepare(`UPDATE devbot_outbox_progress SET ${fields.join(", ")} WHERE notification_id = ?`).run(...values);
  }

  deleteOutboxProgress(notificationId: number): void {
    this.db.prepare("DELETE FROM devbot_outbox_progress WHERE notification_id = ?").run(notificationId);
  }
}
