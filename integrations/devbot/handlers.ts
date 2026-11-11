import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { TelegramClient } from "./client.ts";
import type { DevBotAttachment, PendingConfirmation, TelegramUpdate } from "./types.ts";
import { SecurityGuard, escapeHtml } from "./security.ts";
import { Keyboards } from "./keyboards.ts";
import { SttService } from "./audio/stt.ts";
import { getDevBotSettings, ensureDevBotDirectories } from "./config.ts";
import type { SqliteTaskStore } from "../../runtime/queue/store.ts";
import { DevBotDb } from "./db.ts";

export interface BotHandlersOptions {
  dataDir?: string;
  defaultProjectId?: string;
  allowedUsers?: Set<number>;
  db?: DevBotDb;
}

export class BotHandlers {
  private client: TelegramClient;
  private store: SqliteTaskStore;
  private db: DevBotDb;
  private dataDir: string;
  private incomingDir: string;
  private allowedUsers: Set<number>;
  private defaultProjectId: string;

  constructor(client: TelegramClient, store: SqliteTaskStore, options?: BotHandlersOptions) {
    this.client = client;
    this.store = store;

    const settings = getDevBotSettings(options?.dataDir);
    ensureDevBotDirectories(settings);

    this.dataDir = settings.dataDir;
    this.incomingDir = settings.incomingDir;
    this.allowedUsers = options?.allowedUsers || settings.allowedUsers;
    this.defaultProjectId = (options?.defaultProjectId || settings.defaultProjectId || "viewer").toLowerCase();
    this.db = options?.db || new DevBotDb(path.join(this.dataDir, "devbot.sqlite"));
  }

  getDb(): DevBotDb {
    return this.db;
  }

  getActiveProjectId(chatId?: number): string {
    if (chatId) {
      const persisted = this.db.getSelectedProject(chatId);
      if (persisted && this.store.getProject(persisted)) {
        return persisted;
      }
    }
    return this.defaultProjectId;
  }

  setActiveProjectId(chatId: number, userId: number, id: string): boolean {
    const project = this.store.getProject(id);
    if (!project) return false;
    this.db.setSelectedProject(chatId, userId, project.id);
    return true;
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
    const fromId = cb.from.id;
    const messageId = cb.message?.message_id;
    const data = cb.data || "";

    await this.client.answerCallbackQuery(cb.id);

    // Strict numeric ID authorization check
    if (!SecurityGuard.isAuthorized(fromId, this.allowedUsers)) {
      await this.client.sendMessage(chatId, "⛔ У вас нет доступа к управлению этим ботом разработчика.");
      return;
    }

    // 1. Project Selection: proj_select_<id>
    if (data.startsWith("proj_select_")) {
      const projId = data.replace("proj_select_", "").trim().toLowerCase();
      const project = this.store.getProject(projId);
      if (project) {
        this.setActiveProjectId(chatId, fromId, project.id);
        const text =
          `🎯 <b>АКТИВНЫЙ ПРОЕКТ ИЗМЕНЁН:</b>\n\n` +
          `📁 <b>${escapeHtml(project.name)}</b> (<code>${escapeHtml(project.id)}</code>)\n` +
          `Путь: <code>${escapeHtml(project.path)}</code>\n\n` +
          `Все последующие задачи будут выполняться в контексте этого проекта.`;

        const keyboard = Keyboards.getProjectsInline(this.store.listProjects(), project.id);
        if (messageId) {
          await this.client.editMessageText(chatId, messageId, text, { reply_markup: keyboard });
        } else {
          await this.client.sendMessage(chatId, text, { reply_markup: keyboard });
        }
      } else {
        await this.client.sendMessage(chatId, `⚠️ Проект "${escapeHtml(projId)}" не найден в реестре.`);
      }
      return;
    }

    // 2. Confirmation YES: confirm_cmd_<id>
    if (data.startsWith("confirm_cmd_")) {
      const confId = data.replace("confirm_cmd_", "");
      const pending = this.db.getConfirmation(confId);
      if (!pending || pending.status !== "PENDING") {
        await this.client.sendMessage(chatId, `⚠️ Подтверждение #${escapeHtml(confId)} не найдено или уже было обработано.`);
        return;
      }

      // Security check: bind confirmation to original user and chat
      if (pending.userId !== fromId || pending.chatId !== chatId) {
        await this.client.sendMessage(chatId, "⛔ Подтвердить операцию может только пользователь, отдавший команду в исходном чате.");
        return;
      }

      this.db.updateConfirmationStatus(confId, "APPROVED");

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
        `🆔 Задание: <code>#${task.id}</code> (${escapeHtml(task.projectId)})\n` +
        `📝 <b>Задача:</b> <i>«${escapeHtml(pending.text)}»</i>\n\n` +
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
      const pending = this.db.getConfirmation(confId);
      if (pending) {
        if (pending.userId !== fromId || pending.chatId !== chatId) {
          await this.client.sendMessage(chatId, "⛔ Отменить операцию может только автор команды.");
          return;
        }
        this.db.updateConfirmationStatus(confId, "CANCELLED");
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
    const fromId = msg.from?.id;
    const author = msg.from?.first_name || msg.from?.username || "Владимир";

    // Enforce private chats only (Point 4)
    if (!SecurityGuard.isPrivateChat(msg.chat.type)) {
      return; // Silently drop or ignore group messages to prevent leakage
    }

    // Enforce numeric user ID authorization (Point 4)
    if (!SecurityGuard.isAuthorized(fromId, this.allowedUsers)) {
      await this.client.sendMessage(
        chatId,
        `⛔ <b>ДОСТУП ЗАПРЕЩЁН</b>\n\nЭтот бот предназначен исключительно для авторизованных разработчиков.\nВаш ID: <code>${fromId ?? "неизвестно"}</code>`
      );
      return;
    }

    const currentActiveProject = this.getActiveProjectId(chatId);
    let text = (msg.text || msg.caption || "").trim();

    // Handle voice / audio notes
    const voiceObj = msg.voice || msg.audio;
    if (voiceObj && voiceObj.file_id) {
      await this.client.sendChatAction(chatId, "record_voice");

      try {
        const fileInfo = await this.client.getFile(voiceObj.file_id);
        if (!fileInfo.ok || !fileInfo.result?.file_path) {
          throw new Error(fileInfo.description || fileInfo.error || "Не удалось получить метаданные аудиофайла");
        }

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
      } catch (err: any) {
        await this.client.sendMessage(chatId, `⚠️ Ошибка распознавания речи: ${escapeHtml(err.message || err)}`);
        return;
      }
    }

    // Handle documents / photos (Point 6: UUID names, safe display names, bounded size)
    const attachments: DevBotAttachment[] = [];
    if (msg.photo && msg.photo.length > 0) {
      try {
        const largestPhoto = msg.photo[msg.photo.length - 1];
        const fileInfo = await this.client.getFile(largestPhoto.file_id);
        if (!fileInfo.ok || !fileInfo.result?.file_path) {
          throw new Error(fileInfo.description || fileInfo.error || "Не удалось получить фото");
        }

        const buffer = await this.client.downloadFile(fileInfo.result.file_path);
        const uuid = randomUUID();
        const savedFileName = `photo_${uuid}.jpg`;
        const savePath = path.join(this.incomingDir, savedFileName);
        fs.writeFileSync(savePath, buffer);

        attachments.push({
          type: "photo",
          filePath: savePath,
          fileName: "photo.jpg",
        });

        if (!text) text = `[Анализ скриншота/фото: photo.jpg]`;
      } catch (e: any) {
        await this.client.sendMessage(chatId, `⚠️ Ошибка загрузки изображения: ${escapeHtml(e.message || e)}`);
        return;
      }
    }

    if (msg.document && msg.document.file_id) {
      try {
        const fileInfo = await this.client.getFile(msg.document.file_id);
        if (!fileInfo.ok || !fileInfo.result?.file_path) {
          throw new Error(fileInfo.description || fileInfo.error || "Не удалось получить документ");
        }

        const buffer = await this.client.downloadFile(fileInfo.result.file_path);
        const rawName = msg.document.file_name || "document.bin";
        // Sanitize display name against path traversal
        const safeDisplayName = path.basename(rawName).replace(/[^\w.-]/g, "_");
        const ext = path.extname(safeDisplayName) || ".bin";
        const uuid = randomUUID();
        const savedFileName = `doc_${uuid}${ext}`;
        const savePath = path.join(this.incomingDir, savedFileName);
        fs.writeFileSync(savePath, buffer);

        attachments.push({
          type: "document",
          filePath: savePath,
          fileName: safeDisplayName,
        });

        if (!text) text = `[Файл: ${safeDisplayName}]`;
      } catch (e: any) {
        await this.client.sendMessage(chatId, `⚠️ Ошибка загрузки документа: ${escapeHtml(e.message || e)}`);
        return;
      }
    }

    if (!text) return;

    // Command: /start
    if (text === "/start") {
      const active = this.store.getProject(currentActiveProject) || { id: currentActiveProject, name: currentActiveProject, path: "." };
      const welcome =
        `🤖 <b>Antigravity AI Developer Bot (Viewer 2)</b>\n\n` +
        `Здравствуйте, <b>${escapeHtml(author)}</b>! Я ваш персональный автономный бот разработки на базе SQLite-очереди Viewer.\n\n` +
        `🎯 <b>Текущий проект:</b> <b>${escapeHtml(active.name)}</b> (<code>${escapeHtml(active.id)}</code>)\n` +
        `📁 <i>Путь: <code>${escapeHtml(active.path)}</code></i>\n\n` +
        `<b>Как мной управлять:</b>\n` +
        `• <b>Голосом:</b> отправьте голосовое сообщение с задачей — я расшифрую и передам в Antigravity;\n` +
        `• <b>Текстом:</b> напишите задачу или используйте точный префикс (<code>/p crm ...</code>, <code>/p viewer ...</code>);\n` +
        `• <b>Файлами/скриншотами:</b> пришлите картинку с комментарием;\n` +
        `• <b>Смена проекта:</b> нажмите «📂 Выбрать проект» ниже.\n\n` +
        `<i>Все сервисы готовы к работе!</i>`;

      await this.client.sendMessage(chatId, welcome, {
        reply_markup: Keyboards.getMainReply(),
      });
      await this.client.sendMessage(chatId, `Выберите активный проект для работы:`, {
        reply_markup: Keyboards.getProjectsInline(this.store.listProjects(), currentActiveProject),
      });
      return;
    }

    // Command: /projects or "📂 Выбрать проект"
    if (text === "/projects" || text === "📂 Выбрать проект") {
      const active = this.store.getProject(currentActiveProject) || { id: currentActiveProject, name: currentActiveProject };
      await this.client.sendMessage(
        chatId,
        `📂 <b>ВЫБОР АКТИВНОГО ПРОЕКТА</b>\n\nТекущий выбранный: <b>${escapeHtml(active.name)}</b> (<code>${escapeHtml(active.id)}</code>)\n\nНажмите на проект для переключения:`,
        { reply_markup: Keyboards.getProjectsInline(this.store.listProjects(), currentActiveProject) }
      );
      return;
    }

    // Command: /project <exact-id> or /project (without args)
    if (text.startsWith("/project")) {
      const parts = text.split(/\s+/);
      if (parts.length === 1) {
        // Just /project -> show selection
        const active = this.store.getProject(currentActiveProject) || { id: currentActiveProject, name: currentActiveProject };
        await this.client.sendMessage(
          chatId,
          `📂 <b>ВЫБОР АКТИВНОГО ПРОЕКТА</b>\n\nТекущий выбранный: <b>${escapeHtml(active.name)}</b> (<code>${escapeHtml(active.id)}</code>)\n\nНажмите на проект для переключения:`,
          { reply_markup: Keyboards.getProjectsInline(this.store.listProjects(), currentActiveProject) }
        );
        return;
      }

      const requestedId = parts[1].toLowerCase().trim();
      const proj = this.store.getProject(requestedId);
      if (!proj) {
        const available = this.store.listProjects().map((p) => `<code>${escapeHtml(p.id)}</code>`).join(", ");
        await this.client.sendMessage(
          chatId,
          `⚠️ Проект «${escapeHtml(requestedId)}» не найден в реестре.\nДоступные проекты: ${available}`
        );
        return;
      }

      this.setActiveProjectId(chatId, fromId!, proj.id);
      await this.client.sendMessage(
        chatId,
        `🎯 Активный проект изменён на <b>${escapeHtml(proj.name)}</b> (<code>${escapeHtml(proj.id)}</code>)`
      );
      return;
    }

    // Command: /status or "📊 Статус системы"
    if (text === "/status" || text === "📊 Статус системы") {
      const active = this.store.getProject(currentActiveProject) || { id: currentActiveProject, name: currentActiveProject, path: "." };
      const allTasks = this.store.list();
      const queuedCount = allTasks.filter((t) => t.status === "QUEUED").length;
      const inProgressCount = allTasks.filter((t) => t.status === "IN_PROGRESS").length;
      const reportedCount = allTasks.filter((t) => t.status === "REPORTED").length;
      const approvedCount = allTasks.filter((t) => t.status === "APPROVED").length;

      const statusMsg =
        `📊 <b>СТАТУС DEV BOT & ОЧЕРЕДИ VIEWER</b>\n\n` +
        `🎯 <b>Выбранный проект:</b> <b>${escapeHtml(active.name)}</b> (<code>${escapeHtml(active.id)}</code>)\n` +
        `📁 <i>Каталог: <code>${escapeHtml(active.path)}</code></i>\n\n` +
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
        `• <b>Постановка задачи:</b> просто продиктуйте или напишите суть задачи;\n` +
        `• <b>Точная маршрутизация:</b> используйте <code>/p &lt;проект&gt; &lt;задача&gt;</code> для разовой адресации без смены активного проекта;\n` +
        `• <b>Смена проекта:</b> <code>/project &lt;id&gt;</code> или кнопка «📂 Выбрать проект»;\n` +
        `• <b>Опасные команды:</b> при операциях с базами данных, удалением файлов или деплоем бот запросит подтверждение кнопкой;\n` +
        `• <b>Голосовые отчёты:</b> после выполнения задачи бот пришлёт голосовое резюме отчёта и подробный технический текст.`;
      await this.client.sendMessage(chatId, helpMsg);
      return;
    }

    // =========================================================================
    // Exact Project Routing (Point 4: NO substring guessing!)
    // =========================================================================
    let targetProjectId = currentActiveProject;

    // Check explicit inline project prefix: /p <id> <text> or /project <id> <text>
    const explicitPrefixMatch = /^\/(?:p|project)\s+([a-zA-Z0-9_-]+)\s+([\s\S]+)$/.exec(text);
    if (explicitPrefixMatch) {
      const explicitId = explicitPrefixMatch[1].toLowerCase().trim();
      const explicitProject = this.store.getProject(explicitId);
      if (!explicitProject) {
        const available = this.store.listProjects().map((p) => `<code>${escapeHtml(p.id)}</code>`).join(", ");
        await this.client.sendMessage(
          chatId,
          `⚠️ Ошибка: проект «${escapeHtml(explicitId)}» не зарегистрирован.\n` +
          `Доступные проекты: ${available}\n` +
          `Задача отклонена (fallback на активный проект запрещён).`
        );
        return;
      }
      targetProjectId = explicitProject.id;
      text = explicitPrefixMatch[2].trim();
    }

    // Security Check: Danger Detection
    const securityCheck = SecurityGuard.checkDangerous(text);
    if (securityCheck.isDangerous) {
      const confId = `CONF-${Date.now()}-${randomUUID().slice(0, 4)}`;
      const idempotencyKey = `conf_${chatId}_${msg.message_id}_${Date.now()}`;

      this.db.saveConfirmation({
        id: confId,
        chatId,
        userId: fromId!,
        idempotencyKey,
        author,
        text,
        projectId: targetProjectId,
        dangerReason: securityCheck.reason || "Потенциально опасная операция",
        dangerCategory: securityCheck.category,
        attachments,
        createdAt: Date.now(),
        status: "PENDING",
      });

      const confirmMsg =
        `⚠️ <b>ВНИМАНИЕ! ТРЕБУЕТСЯ ПОДТВЕРЖДЕНИЕ ОПЕРАЦИИ</b>\n\n` +
        `📁 Проект: <b>${escapeHtml(targetProjectId)}</b>\n` +
        `📝 <b>Команда:</b> <i>«${escapeHtml(text)}»</i>\n\n` +
        `🚨 <b>Причина:</b> ${escapeHtml(securityCheck.reason || "Опасная операция")}\n\n` +
        `Вы уверены, что хотите выполнить данную команду?`;

      await this.client.sendMessage(chatId, confirmMsg, {
        reply_markup: Keyboards.getConfirmationInline(confId),
      });
      return;
    }

    // Normal Command -> Submit to SQLite Queue
    const task = this.store.submit({
      projectId: targetProjectId,
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
        attachments,
      },
    });

    const activeProjectObj = this.store.getProject(targetProjectId);
    const projectName = activeProjectObj ? activeProjectObj.name : targetProjectId;

    const acceptedMsg =
      `🚀 <b>ЗАДАЧА ПРИНЯТА В РАБОТУ!</b>\n\n` +
      `🆔 Номер: <code>#${task.id}</code>\n` +
      `📁 Проект: <b>${escapeHtml(projectName)}</b> (<code>${escapeHtml(targetProjectId)}</code>)\n` +
      `📝 <b>Задача:</b> <i>«${escapeHtml(text)}»</i>\n` +
      (attachments.length > 0 ? `📎 Вложений: <b>${attachments.length}</b>\n` : "") +
      `\n<i>Antigravity выполняет задачу в SQLite-очереди Viewer 2...</i>`;

    await this.client.sendMessage(chatId, acceptedMsg);
  }
}
