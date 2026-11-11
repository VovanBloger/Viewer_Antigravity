import fs from "node:fs";
import path from "node:path";
import type { TelegramClient } from "./client.ts";
import type { OutboxDeliveryResult } from "./types.ts";
import { TtsService } from "./audio/tts.ts";
import { getDevBotSettings } from "./config.ts";
import { escapeHtml } from "./security.ts";
import type { SqliteTaskStore } from "../../runtime/queue/store.ts";
import { DevBotDb } from "./db.ts";

export interface OutboxServiceOptions {
  maxRetries?: number;
  ttsCacheDir?: string;
  dataDir?: string;
  db?: DevBotDb;
}

export class OutboxService {
  private client: TelegramClient;
  private store: SqliteTaskStore;
  private db: DevBotDb;
  private maxRetries: number;
  private ttsCacheDir: string;

  constructor(client: TelegramClient, store: SqliteTaskStore, options?: OutboxServiceOptions) {
    this.client = client;
    this.store = store;
    this.maxRetries = options?.maxRetries ?? 5;

    const settings = getDevBotSettings(options?.dataDir);
    this.ttsCacheDir = options?.ttsCacheDir || settings.ttsCacheDir;
    if (!fs.existsSync(this.ttsCacheDir)) {
      fs.mkdirSync(this.ttsCacheDir, { recursive: true });
    }

    this.db = options?.db || new DevBotDb(path.join(settings.dataDir, "devbot.sqlite"));
  }

  getDb(): DevBotDb {
    return this.db;
  }

  /**
   * Delivers pending notifications from SQLite store with durable chunk and retry state.
   *
   * Note on Telegram delivery semantics:
   * Telegram Bot API lacks client-generated request idempotency keys for sendMessage/sendVoice.
   * There is an irreducible ambiguous-send window if the network connection drops between
   * Telegram accepting the HTTP POST and the client receiving HTTP 200. We minimize this window
   * by recording exact per-chunk and per-channel progress in SQLite immediately around network calls.
   */
  async deliverPending(): Promise<OutboxDeliveryResult[]> {
    const notifications = this.store.pendingNotifications();
    const results: OutboxDeliveryResult[] = [];
    const now = Date.now();

    for (const notif of notifications) {
      const task = this.store.get(notif.taskId);
      if (!task) {
        // Missing task — mark sent to avoid blocking queue
        this.store.markNotificationSent(notif.id);
        this.db.deleteOutboxProgress(notif.id);
        continue;
      }

      // Check if Telegram notification is requested
      if (!task.notify?.telegram || !task.notify.chatId) {
        // Local task (e.g. Codex diagnostic/develop) — no Telegram/TTS notifications
        this.store.markNotificationSent(notif.id);
        this.db.deleteOutboxProgress(notif.id);
        results.push({
          notificationId: notif.id,
          taskId: task.id,
          textSent: false,
          voiceSent: false,
        });
        continue;
      }

      const chatId = task.notify.chatId;

      // 1. Load or initialize persistent progress record in SQLite
      let progress = this.db.getOutboxProgress(notif.id);
      if (!progress) {
        // Freeze report snapshot per event: delayed old rounds NEVER send newest report!
        const snapshot = JSON.stringify({
          taskId: task.id,
          projectId: task.projectId,
          goal: task.goal,
          kind: notif.kind,
          round: task.round,
          summary: task.report?.summary || null,
          verdicts: task.verdicts,
          failure: task.failure,
        });

        const fullMessageText = this.formatMessageFromSnapshot(snapshot);
        // Pre-calculate chunks
        const chunks = (this.client as any).constructor.splitIntoChunks(fullMessageText, 3900);
        const voiceRequested = Boolean(task.notify.tts && notif.kind === "REPORTED" && task.report?.summary);

        progress = this.db.initOutboxProgress(
          notif.id,
          task.id,
          chatId,
          snapshot,
          chunks.length,
          voiceRequested
        );
      }

      // Check retry deadline
      if (progress.next_retry_at > now) {
        // Skip for now, retry deadline not reached
        continue;
      }

      let textDelivered = Boolean(progress.text_delivered);
      let voiceDelivered = Boolean(progress.voice_delivered);
      const voicePending = Boolean(progress.voice_pending);

      try {
        // 2. Deliver Text Chunks if not yet completed
        if (!textDelivered) {
          const fullMessageText = this.formatMessageFromSnapshot(progress.report_snapshot);
          const chunks = (this.client as any).constructor.splitIntoChunks(fullMessageText, 3900);

          for (let i = progress.text_chunks_sent; i < chunks.length; i++) {
            const sendRes = await this.client.sendMessage(chatId, chunks[i]);
            if (!sendRes || sendRes.ok === false) {
              const errMsg = sendRes?.error || sendRes?.description || "Failed to send Telegram message";
              throw new Error(errMsg);
            }
            progress.text_chunks_sent = i + 1;
            this.db.updateOutboxProgress(notif.id, { text_chunks_sent: i + 1 });
          }

          textDelivered = true;
          this.db.updateOutboxProgress(notif.id, { text_delivered: 1 });
        }

        // 3. Deliver Voice if pending and not yet delivered
        if (voicePending && !voiceDelivered) {
          const snapshotObj = JSON.parse(progress.report_snapshot);
          const author = (task.meta?.author as string) || "Владимир";
          const script = await TtsService.generateSpokenScript(snapshotObj.goal, snapshotObj.summary || "", author);

          const audioFileName = `report_${task.id}_${Date.now()}.ogg`;
          const audioFilePath = path.join(this.ttsCacheDir, audioFileName);

          const synthesized = await TtsService.synthesize(script, audioFilePath);
          if (!synthesized) {
            throw new Error("TTS synthesis produced empty or invalid audio file");
          }

          const voiceRes = await this.client.sendVoice(
            chatId,
            audioFilePath,
            `🎙 Голосовой отчёт по задаче #${task.id}`
          );

          if (!voiceRes || voiceRes.ok === false) {
            throw new Error(voiceRes?.error || voiceRes?.description || "Failed to send Telegram voice note");
          }

          voiceDelivered = true;
          this.db.updateOutboxProgress(notif.id, { voice_delivered: 1, voice_pending: 0 });
        }

        // 4. Mark notification fully handled in store only when both text and voice succeeded
        const allDone = textDelivered && (!voicePending || voiceDelivered);
        if (allDone) {
          this.store.markNotificationSent(notif.id);
          this.db.deleteOutboxProgress(notif.id);

          results.push({
            notificationId: notif.id,
            taskId: task.id,
            textSent: textDelivered,
            voiceSent: voiceDelivered,
          });
        }
      } catch (err: any) {
        const attempts = progress.attempts + 1;
        // Exponential backoff retry deadline
        const delayMs = Math.min(300_000, Math.pow(2, attempts) * 1000);
        const nextRetryAt = Date.now() + delayMs;

        this.db.updateOutboxProgress(notif.id, {
          attempts,
          next_retry_at: nextRetryAt,
          last_error: err.message || String(err),
        });

        console.error(
          `[OutboxService] Delivery error for notification #${notif.id} (attempt ${attempts}, next retry in ${delayMs / 1000}s):`,
          err.message || err
        );

        results.push({
          notificationId: notif.id,
          taskId: task.id,
          textSent: textDelivered,
          voiceSent: voiceDelivered,
          error: err.message || String(err),
        });

        // Do not drop notification silently on maxRetries; keep it pending with backoff
      }
    }

    return results;
  }

  private formatMessageFromSnapshot(rawSnapshot: string): string {
    const s = JSON.parse(rawSnapshot);
    const project = this.store.getProject(s.projectId);
    const projectName = project ? `${escapeHtml(project.name)} (<code>${escapeHtml(project.id)}</code>)` : `<code>${escapeHtml(s.projectId)}</code>`;

    if (s.kind === "REPORTED") {
      const summary = s.summary || "Отчёт сдан";
      return (
        `✅ <b>ANTIGRAVITY: ЗАДАЧА #${escapeHtml(s.taskId)} ВЫПОЛНЕНА!</b>\n\n` +
        `📁 Проект: <b>${projectName}</b>\n` +
        `📝 <b>Команда:</b> <i>«${escapeHtml(s.goal)}»</i>\n\n` +
        `<b>Результат выполнения:</b>\n${escapeHtml(summary)}`
      );
    }

    if (s.kind === "APPROVED") {
      return (
        `🎉 <b>ЗАДАЧА #${escapeHtml(s.taskId)} ПРИНЯТА (APPROVED)!</b>\n\n` +
        `📁 Проект: <b>${projectName}</b>\n` +
        `📝 <b>Команда:</b> <i>«${escapeHtml(s.goal)}»</i>\n\n` +
        `Координатор утвердил результаты задания.`
      );
    }

    if (s.kind === "FAILED") {
      const errorMsg = s.failure?.reason || "Неизвестная ошибка";
      return (
        `❌ <b>ANTIGRAVITY: ОШИБКА ВЫПОЛНЕНИЯ #${escapeHtml(s.taskId)}</b>\n\n` +
        `📁 Проект: <b>${projectName}</b>\n` +
        `📝 <b>Команда:</b> <i>«${escapeHtml(s.goal)}»</i>\n\n` +
        `<b>Текст ошибки:</b>\n${escapeHtml(errorMsg)}`
      );
    }

    if (s.kind === "RETURNED") {
      const notes = s.verdicts?.[s.verdicts.length - 1]?.notes || s.failure?.reason || "Требуются исправления";
      return (
        `⚠️ <b>ЗАДАЧА #${escapeHtml(s.taskId)} ВОЗВРАЩЕНА НА ДОРАБОТКУ</b>\n\n` +
        `📁 Проект: <b>${projectName}</b>\n` +
        `📝 <b>Команда:</b> <i>«${escapeHtml(s.goal)}»</i>\n\n` +
        `<b>Замечания координатора:</b>\n${escapeHtml(notes)}`
      );
    }

    return (
      `ℹ️ <b>УВЕДОМЛЕНИЕ ПО ЗАДАЧЕ #${escapeHtml(s.taskId)}</b>\n\n` +
      `📁 Проект: <b>${projectName}</b>\n` +
      `Статус: <b>${escapeHtml(s.kind)}</b>`
    );
  }
}
