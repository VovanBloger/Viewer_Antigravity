import fs from "node:fs";
import path from "node:path";
import type { TelegramClient } from "./client.ts";
import type { DevBotAttachment, PendingConfirmation, TelegramUpdate } from "./types.ts";
import { SecurityGuard } from "./security.ts";
import { Keyboards } from "./keyboards.ts";
import { SttService } from "./audio/stt.ts";
import { getDevBotSettings, ensureDevBotDirectories } from "./config.ts";
import type { SqliteTaskStore } from "../../runtime/queue/store.ts";

export interface BotHandlersOptions {
  dataDir?: string;
  defaultProjectId?: string;
  allowedUsers?: Set<string>;
}

export class BotHandlers {
  private client: TelegramClient;
  private store: SqliteTaskStore;
  private dataDir: string;
  private incomingDir: string;
  private allowedUsers: Set<string>;
  private activeProjectId: string;
  private pendingConfirmations: Map<string, PendingConfirmation> = new Map();
  private confirmationCounter = 0;

  constructor(client: TelegramClient, store: SqliteTaskStore, options?: BotHandlersOptions) {
    this.client = client;
    this.store = store;

    const settings = getDevBotSettings(options?.dataDir);
    ensureDevBotDirectories(settings);

    this.dataDir = settings.dataDir;
    this.incomingDir = settings.incomingDir;
    this.allowedUsers = options?.allowedUsers || settings.allowedUsers;
    this.activeProjectId = (options?.defaultProjectId || settings.defaultProjectId || "viewer").toLowerCase();
  }

  getActiveProjectId(): string {
    return this.activeProjectId;
  }

  setActiveProjectId(id: string): boolean {
    const project = this.store.getProject(id);
    if (!project) return false;
    this.activeProjectId = project.id;
    return true;
  }

  getPendingConfirmations(): Map<string, PendingConfirmation> {
    return this.pendingConfirmations;
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }

    if (update.message) {
      await this.handleMessage(update.message);
      return;
    }
  }

  private async handleCallback(cb: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
    const chatId = cb.message?.chat.id || cb.from.id;
    const messageId = cb.message?.message_id;
    const data = cb.data || "";

    await this.client.answerCallbackQuery(cb.id);

    if (!SecurityGuard.isAuthorized(cb.from.id, cb.from.username, this.allowedUsers)) {
      await this.client.sendMessage(chatId, "⛔ У вас нет доступа к управлению этим ботом разработчика.");
      return;
    }

    // 1. Project Selection: proj_select_<id>
    if (data.startsWith("proj_select_")) {
      const projId = data.replace("proj_select_", "");
      const project = this.store.getProject(projId);
      if (project) {
        this.activeProjectId = project.id;
        const text =
          `🎯 <b>АКТИВНЫЙ ПРОЕКТ ИЗМЕНЁН:</b>\n\n` +
          `📁 <b>${project.name}</b> (<code>${project.id}</code>)\n` +
          `Путь: <code>${project.path}</code>\n\n` +
          `Все последующие задачи будут выполняться в контексте этого проекта.`;

        const keyboard = Keyboards.getProjectsInline(this.store.listProjects(), this.activeProjectId);
        if (messageId) {
          await this.client.editMessageText(chatId, messageId, text, { reply_markup: keyboard });
        } else {
          await this.client.sendMessage(chatId, text, { reply_markup: keyboard });
        }
      } else {
        await this.client.sendMessage(chatId, `⚠️ Проект "${projId}" не найден в реестре.`);
      }
      return;
    }

    // 2. Confirmation YES: confirm_cmd_<id>
    if (data.startsWith("confirm_cmd_")) {
      const confId = data.replace("confirm_cmd_", "");
      const pending = this.pendingConfirmations.get(confId);
      if (!pending) {
        await this.client.sendMessage(chatId, `⚠️ Подтверждение #${confId} не найдено или уже было обработано.`);
        return;
      }

      this.pendingConfirmations.delete(confId);

      const task = this.store.submit({
        projectId: pending.projectId,
        coordinatorId: "telegram",
        executorId: "antigravity",
        kind: "develop",
        title: pending.text.split("\n")[0].slice(0, 80),
        goal: pending.text,
        acceptance: [],
        notify: {
          telegram: true,
          tts: true,
          chatId: pending.chatId,
        },
        meta: {
          author: pending.author,
          chatId: pending.chatId,
          attachments: pending.attachments,
          dangerConfirmed: true,
          dangerReason: pending.dangerReason,
        },
      });

      const text =
        `✅ <b>ОПЕРАЦИЯ ПОДТВЕРЖДЕНА!</b>\n\n` +
        `🆔 Задание: <code>#${task.id}</code> (${task.projectId})\n` +
        `📝 <b>Задача:</b> <i>«${pending.text}»</i>\n\n` +
        `🚀 Передано в очередь на выполнение.`;

      if (messageId) {
        await this.client.editMessageText(chatId, messageId, text);
      } else {
        await this.client.sendMessage(chatId, text);
      }
      return;
    }

    // 3. Confirmation NO: cancel_cmd_<id>
    if (data.startsWith("cancel_cmd_")) {
      const confId = data.replace("cancel_cmd_", "");
      const pending = this.pendingConfirmations.get(confId);
      if (pending) {
        this.pendingConfirmations.delete(confId);
      }
      const text = `❌ <b>ОПЕРАЦИЯ ОТМЕНЕНА</b>\nКоманда снята с выполнения.`;
      if (messageId) {
        await this.client.editMessageText(chatId, messageId, text);
      } else {
        await this.client.sendMessage(chatId, text);
      }
      return;
    }
  }

  private async handleMessage(msg: NonNullable<TelegramUpdate["message"]>): Promise<void> {
    const chatId = msg.chat.id;
    const fromId = msg.from?.id || chatId;
    const author = msg.from?.first_name || msg.from?.username || "Владимир";

    if (!SecurityGuard.isAuthorized(fromId, msg.from?.username, this.allowedUsers)) {
      await this.client.sendMessage(
        chatId,
        `⛔ <b>ДОСТУП ЗАПРЕЩЁН</b>\n\nЭтот бот предназначен исключительно для авторизованных разработчиков.\nВаш ID: <code>${fromId}</code>`
      );
      return;
    }

    let text = (msg.text || msg.caption || "").trim();
    let isVoice = false;

    // Handle voice / audio notes
    const voiceObj = msg.voice || msg.audio;
    if (voiceObj && voiceObj.file_id) {
      isVoice = true;
      await this.client.sendChatAction(chatId, "record_voice");

      try {
        const fileInfo = await this.client.getFile(voiceObj.file_id);
        if (fileInfo.ok && fileInfo.result?.file_path) {
          const buffer = await this.client.downloadFile(fileInfo.result.file_path);
          const mimeType = ("mime_type" in voiceObj && voiceObj.mime_type) ? voiceObj.mime_type : "audio/ogg";
          const transcribed = await SttService.transcribe(buffer, mimeType);

          if (transcribed && transcribed.trim()) {
            text = transcribed.trim();
          } else {
            await this.client.sendMessage(
              chatId,
              "⚠️ Не удалось разобрать слова в аудиосообщении. Пожалуйста, напишите команду текстом."
            );
            return;
          }
        }
      } catch (err: any) {
        await this.client.sendMessage(chatId, `⚠️ Ошибка распознавания речи: ${err.message || err}`);
        return;
      }
    }

    // Handle documents / photos
    const attachments: DevBotAttachment[] = [];
    if (msg.photo && msg.photo.length > 0) {
      try {
        const largestPhoto = msg.photo[msg.photo.length - 1];
        const fileInfo = await this.client.getFile(largestPhoto.file_id);
        if (fileInfo.ok && fileInfo.result?.file_path) {
          const buffer = await this.client.downloadFile(fileInfo.result.file_path);
          const filename = `photo_${Date.now()}.jpg`;
          const savePath = path.join(this.incomingDir, filename);
          fs.writeFileSync(savePath, buffer);
          attachments.push({ type: "photo", filePath: savePath, fileName: filename });
          if (!text) text = `[Анализ скриншота/фото: ${filename}]`;
        }
      } catch (e: any) {
        console.warn("[BotHandlers] Photo download error:", e.message || e);
      }
    }

    if (msg.document && msg.document.file_id) {
      try {
        const fileInfo = await this.client.getFile(msg.document.file_id);
        if (fileInfo.ok && fileInfo.result?.file_path) {
          const buffer = await this.client.downloadFile(fileInfo.result.file_path);
          const filename = msg.document.file_name || `doc_${Date.now()}`;
          const savePath = path.join(this.incomingDir, filename);
          fs.writeFileSync(savePath, buffer);
          attachments.push({ type: "document", filePath: savePath, fileName: filename });
          if (!text) text = `[Файл: ${filename}]`;
        }
      } catch (e: any) {
        console.warn("[BotHandlers] Document download error:", e.message || e);
      }
    }

    if (!text) return;

    // Command: /start
    if (text === "/start") {
      const active = this.store.getProject(this.activeProjectId) || { id: this.activeProjectId, name: this.activeProjectId, path: "." };
      const welcome =
        `🤖 <b>Antigravity AI Developer Bot (Viewer 2)</b>\n\n` +
        `Здравствуйте, <b>${author}</b>! Я ваш персональный автономный бот разработки на базе SQLite-очереди Viewer.\n\n` +
        `🎯 <b>Текущий проект:</b> <b>${active.name}</b> (<code>${active.id}</code>)\n` +
        `📁 <i>Путь: <code>${active.path}</code></i>\n\n` +
        `<b>Как мной управлять:</b>\n` +
        `• <b>Голосом:</b> отправьте голосовое сообщение с задачей — я расшифрую и передам в Antigravity;\n` +
        `• <b>Текстом:</b> напишите любую задачу («исправь шапку», «добавь узел в VPN»);\n` +
        `• <b>Файлами/скриншотами:</b> пришлите картинку с комментарием;\n` +
        `• <b>Смена проекта:</b> нажмите «📂 Выбрать проект» ниже.\n\n` +
        `<i>Все сервисы готовы к работе!</i>`;

      await this.client.sendMessage(chatId, welcome, {
        reply_markup: Keyboards.getMainReply(),
      });
      await this.client.sendMessage(chatId, `Выберите активный проект для работы:`, {
        reply_markup: Keyboards.getProjectsInline(this.store.listProjects(), this.activeProjectId),
      });
      return;
    }

    // Command: /projects or "📂 Выбрать проект"
    if (text === "/projects" || text === "📂 Выбрать проект" || text === "/project") {
      const active = this.store.getProject(this.activeProjectId) || { id: this.activeProjectId, name: this.activeProjectId };
      await this.client.sendMessage(
        chatId,
        `📂 <b>ВЫБОР АКТИВНОГО ПРОЕКТА</b>\n\nТекущий выбранный: <b>${active.name}</b> (<code>${active.id}</code>)\n\nНажмите на проект для переключения:`,
        { reply_markup: Keyboards.getProjectsInline(this.store.listProjects(), this.activeProjectId) }
      );
      return;
    }

    // Command: /status or "📊 Статус системы"
    if (text === "/status" || text === "📊 Статус системы") {
      const active = this.store.getProject(this.activeProjectId) || { id: this.activeProjectId, name: this.activeProjectId, path: "." };
      const allTasks = this.store.list();
      const queuedCount = allTasks.filter((t) => t.status === "QUEUED").length;
      const inProgressCount = allTasks.filter((t) => t.status === "IN_PROGRESS").length;
      const reportedCount = allTasks.filter((t) => t.status === "REPORTED").length;
      const approvedCount = allTasks.filter((t) => t.status === "APPROVED").length;

      const statusMsg =
        `📊 <b>СТАТУС DEV BOT & ОЧЕРЕДИ VIEWER</b>\n\n` +
        `🎯 <b>Выбранный проект:</b> <b>${active.name}</b> (<code>${active.id}</code>)\n` +
        `📁 <i>Каталог: <code>${active.path}</code></i>\n\n` +
        `📥 <b>В очереди (QUEUED):</b> ${queuedCount}\n` +
        `⚙️ <b>В работе (IN_PROGRESS):</b> ${inProgressCount}\n` +
        `📋 <b>Сдано отчётов (REPORTED):</b> ${reportedCount}\n` +
        `✔ <b>Принято (APPROVED):</b> ${approvedCount}\n\n` +
        `<i>Задания обслуживаются в SQLite-очереди Viewer 2.</i>`;

      await this.client.sendMessage(chatId, statusMsg);
      return;
    }

    // Command: /help or "❓ Справка"
    if (text === "/help" || text === "❓ Справка") {
      const helpMsg =
        `📖 <b>СПРАВКА ПО УПРАВЛЕНИЮ РАЗРАБОТКОЙ</b>\n\n` +
        `• <b>Постановка задачи:</b> просто продиктуйте или напишите суть задачи.\n` +
        `• <b>Автоопределение проектов:</b> если в тексте упомянут проект («в впн добавь...» или «в срм исправь...»), задача автоматически привязывается к нужному проекту!\n` +
        `• <b>Опасные команды:</b> при операциях с базами данных, удалением файлов или деплоем бот запросит явное подтверждение кнопкой.\n` +
        `• <b>Голосовые отчёты:</b> после выполнения задачи бот пришлёт голосовое резюме отчёта и подробный технический текст.`;
      await this.client.sendMessage(chatId, helpMsg);
      return;
    }

    // Detect target project from text or fallback to active
    let targetProjectId = this.activeProjectId;
    const lower = text.toLowerCase();

    if (
      lower.startsWith("в впн") ||
      lower.startsWith("для впн") ||
      lower.includes("vpn") ||
      lower.includes("антенн")
    ) {
      targetProjectId = "vpn";
    } else if (
      lower.startsWith("в срм") ||
      lower.startsWith("для срм") ||
      lower.includes("crm") ||
      lower.includes("журнал")
    ) {
      targetProjectId = "crm";
    } else if (
      lower.includes("myass") ||
      lower.includes("ассистент") ||
      lower.includes("assistant") ||
      lower.includes("личный бот") ||
      lower.includes("личном боте") ||
      lower.includes("личный ии") ||
      lower.includes("личном ии") ||
      lower.includes("секретар")
    ) {
      targetProjectId = "myassagent";
    } else if (
      lower.startsWith("в девоботе") ||
      lower.startsWith("в боте разработки") ||
      lower.includes("devbot") ||
      lower.includes("девобот")
    ) {
      targetProjectId = "devbot";
    } else if (
      lower.startsWith("в игре") ||
      lower.includes("cyber empire") ||
      lower.includes("тайкун") ||
      lower.includes("кибер импери")
    ) {
      targetProjectId = "game";
    } else if (
      lower.startsWith("во вьювере") ||
      lower.startsWith("в вьювере") ||
      lower.includes("viewer") ||
      lower.includes("студи")
    ) {
      targetProjectId = "viewer";
    }

    // Validate project existence in store
    const project = this.store.getProject(targetProjectId);
    if (!project) {
      await this.client.sendMessage(
        chatId,
        `⚠️ <b>Неизвестный проект:</b> <code>${targetProjectId}</code>\n\nПожалуйста, выберите зарегистрированный проект через команду /projects.`,
        { reply_markup: Keyboards.getProjectsInline(this.store.listProjects(), this.activeProjectId) }
      );
      return;
    }

    // Check danger
    const danger = SecurityGuard.checkDangerous(text);

    if (danger.isDangerous) {
      this.confirmationCounter += 1;
      const confId = `CONF-${Date.now()}-${this.confirmationCounter}`;
      this.pendingConfirmations.set(confId, {
        id: confId,
        chatId,
        author,
        text,
        projectId: project.id,
        dangerReason: danger.reason || "Потенциально опасная операция",
        attachments,
        createdAt: new Date().toISOString(),
      });

      const confirmText =
        `⚠️ <b>ВНИМАНИЕ: ПОТЕНЦИАЛЬНО ОПАСНАЯ КОМАНДА!</b>\n\n` +
        `🆔 Номер: <code>#${confId}</code>\n` +
        `📁 Проект: <b>${project.name}</b> (<code>${project.id}</code>)\n` +
        `📝 <b>Текст:</b> <i>«${text}»</i>\n` +
        `⚡ <b>Причина:</b> ${danger.reason}\n\n` +
        `❓ <b>Вы действительно хотите выполнить эту операцию?</b>`;

      await this.client.sendMessage(chatId, confirmText, {
        reply_markup: Keyboards.getConfirmationInline(confId),
      });
      return;
    }

    // Submit safe task to SQLite store
    const task = this.store.submit({
      projectId: project.id,
      coordinatorId: "telegram",
      executorId: "antigravity",
      kind: "develop",
      title: text.split("\n")[0].slice(0, 80),
      goal: text,
      acceptance: [],
      notify: {
        telegram: true,
        tts: true,
        chatId,
      },
      meta: {
        author,
        chatId,
        isVoice,
        attachments,
        source: "telegram",
      },
      idempotencyKey: `tg-msg-${chatId}-${msg.message_id}`,
    });

    const acceptedText =
      `⏳ <b>ЗАДАЧА ПРИНЯТА В ОЧЕРЕДЬ VIEWER:</b>\n\n` +
      `🆔 Номер: <code>#${task.id}</code>\n` +
      `🎯 Проект: <b>${project.name}</b> (<code>${project.id}</code>)\n` +
      `📝 <b>Задача:</b> <i>«${text}»</i>\n\n` +
      (isVoice ? `🎙 <i>(Распознано из голосового сообщения)</i>\n\n` : "") +
      `<i>Выполняю... Результат и голосовой отчёт будут отправлены сюда.</i>`;

    await this.client.sendMessage(chatId, acceptedText);
  }
}
