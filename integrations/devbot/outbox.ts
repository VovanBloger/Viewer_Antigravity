import fs from "node:fs";
import path from "node:path";
import type { TelegramClient } from "./client.ts";
import type { OutboxDeliveryResult } from "./types.ts";
import { TtsService } from "./audio/tts.ts";
import { getDevBotSettings } from "./config.ts";
import type { SqliteTaskStore } from "../../runtime/queue/store.ts";

export interface OutboxServiceOptions {
  maxRetries?: number;
  ttsCacheDir?: string;
}

export class OutboxService {
  private client: TelegramClient;
  private store: SqliteTaskStore;
  private maxRetries: number;
  private ttsCacheDir: string;
  private retryMap: Map<number, { attempts: number; textDelivered: boolean }> = new Map();

  constructor(client: TelegramClient, store: SqliteTaskStore, options?: OutboxServiceOptions) {
    this.client = client;
    this.store = store;
    this.maxRetries = options?.maxRetries ?? 3;

    const settings = getDevBotSettings();
    this.ttsCacheDir = options?.ttsCacheDir || settings.ttsCacheDir;
    if (!fs.existsSync(this.ttsCacheDir)) {
      fs.mkdirSync(this.ttsCacheDir, { recursive: true });
    }
  }

  async deliverPending(): Promise<OutboxDeliveryResult[]> {
    const notifications = this.store.pendingNotifications();
    const results: OutboxDeliveryResult[] = [];

    for (const notif of notifications) {
      const task = this.store.get(notif.taskId);
      if (!task) {
        // Missing task — mark sent to avoid infinite loop
        this.store.markNotificationSent(notif.id);
        continue;
      }

      // Check if Telegram notification is requested
      if (!task.notify?.telegram || !task.notify.chatId) {
        // Local task (e.g. Codex diagnostic/develop) — no Telegram/TTS notifications
        this.store.markNotificationSent(notif.id);
        results.push({
          notificationId: notif.id,
          taskId: task.id,
          textSent: false,
          voiceSent: false,
        });
        continue;
      }

      const chatId = task.notify.chatId;
      const state = this.retryMap.get(notif.id) || { attempts: 0, textDelivered: false };

      try {
        let textSent = state.textDelivered;
        let voiceSent = false;

        // 1. Send Text Report if not yet delivered
        if (!textSent) {
          const textMessage = this.formatMessage(task, notif.kind);
          const sendRes = await this.client.sendMessage(chatId, textMessage);
          if (sendRes && sendRes.ok !== false) {
            textSent = true;
            state.textDelivered = true;
          } else {
            throw new Error(sendRes?.error || sendRes?.description || "Failed to send Telegram message");
          }
        }

        // 2. Send Voice Report if requested and task completed with report
        if (task.notify.tts && notif.kind === "REPORTED" && task.report?.summary) {
          try {
            const author = (task.meta?.author as string) || "Владимир";
            const script = await TtsService.generateSpokenScript(task.goal, task.report.summary, author);
            const audioFileName = `report_${task.id}_${Date.now()}.ogg`;
            const audioFilePath = path.join(this.ttsCacheDir, audioFileName);

            const synthesized = await TtsService.synthesize(script, audioFilePath);
            if (synthesized) {
              const voiceRes = await this.client.sendVoice(
                chatId,
                audioFilePath,
                `🎙 Голосовой отчёт по задаче #${task.id}`
              );
              if (voiceRes && voiceRes.ok !== false) {
                voiceSent = true;
              }
            }
          } catch (voiceErr: any) {
            // Voice failure does NOT cause text re-send!
            console.warn(`[OutboxService] Warning: TTS failed for task ${task.id}:`, voiceErr.message || voiceErr);
          }
        }

        // Notification fully handled
        this.store.markNotificationSent(notif.id);
        this.retryMap.delete(notif.id);

        results.push({
          notificationId: notif.id,
          taskId: task.id,
          textSent,
          voiceSent,
        });
      } catch (err: any) {
        state.attempts += 1;
        this.retryMap.set(notif.id, state);

        console.error(`[OutboxService] Delivery error for notification #${notif.id} (attempt ${state.attempts}):`, err.message || err);

        results.push({
          notificationId: notif.id,
          taskId: task.id,
          textSent: state.textDelivered,
          voiceSent: false,
          error: err.message || String(err),
        });

        if (state.attempts >= this.maxRetries) {
          console.warn(`[OutboxService] Max retries (${this.maxRetries}) reached for notification #${notif.id}. Dropping.`);
          this.store.markNotificationSent(notif.id);
          this.retryMap.delete(notif.id);
        }
      }
    }

    return results;
  }

  private formatMessage(task: any, kind: string): string {
    const project = this.store.getProject(task.projectId);
    const projectName = project ? `${project.name} (<code>${project.id}</code>)` : `<code>${task.projectId}</code>`;

    if (kind === "REPORTED") {
      const summary = task.report?.summary || "Отчёт сдан";
      return (
        `✅ <b>ANTIGRAVITY: ЗАДАЧА #${task.id} ВЫПОЛНЕНА!</b>\n\n` +
        `📁 Проект: <b>${projectName}</b>\n` +
        `📝 <b>Команда:</b> <i>«${task.goal}»</i>\n\n` +
        `<b>Результат выполнения:</b>\n${summary}`
      );
    }

    if (kind === "APPROVED") {
      return (
        `🎉 <b>ЗАДАЧА #${task.id} ПРИНЯТА (APPROVED)!</b>\n\n` +
        `📁 Проект: <b>${projectName}</b>\n` +
        `📝 <b>Команда:</b> <i>«${task.goal}»</i>\n\n` +
        `Координатор утвердил результаты задания.`
      );
    }

    if (kind === "FAILED") {
      const errorMsg = task.failure?.reason || "Неизвестная ошибка";
      return (
        `❌ <b>ANTIGRAVITY: ОШИБКА ВЫПОЛНЕНИЯ #${task.id}</b>\n\n` +
        `📁 Проект: <b>${projectName}</b>\n` +
        `📝 <b>Команда:</b> <i>«${task.goal}»</i>\n\n` +
        `<b>Текст ошибки:</b>\n${errorMsg}`
      );
    }

    if (kind === "RETURNED") {
      const notes = task.verdicts?.[task.verdicts.length - 1]?.notes || task.failure?.reason || "Требуются исправления";
      return (
        `⚠️ <b>ЗАДАЧА #${task.id} ВОЗВРАЩЕНА НА ДОРАБОТКУ</b>\n\n` +
        `📁 Проект: <b>${projectName}</b>\n` +
        `📝 <b>Команда:</b> <i>«${task.goal}»</i>\n\n` +
        `<b>Замечания координатора:</b>\n${notes}`
      );
    }

    return (
      `ℹ️ <b>УВЕДОМЛЕНИЕ ПО ЗАДАЧЕ #${task.id}</b>\n\n` +
      `📁 Проект: <b>${projectName}</b>\n` +
      `Статус: <b>${kind}</b>`
    );
  }
}
