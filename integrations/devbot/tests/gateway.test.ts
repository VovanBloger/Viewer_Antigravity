import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openStore } from "../../../runtime/queue/index.ts";
import { TelegramClient } from "../client.ts";
import { TelegramGateway } from "../gateway.ts";
import { SttService } from "../audio/stt.ts";
import { TtsService } from "../audio/tts.ts";
import { SecurityGuard } from "../security.ts";
import { OutboxService } from "../outbox.ts";
import type { TelegramUpdate } from "../types.ts";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("1. update replay: deduplicates update_id and persists offset", async () => {
  const tmpDir = createTempDir("devbot-test-replay-");
  const dbPath = path.join(tmpDir, "queue.db");
  const store = openStore({ dbPath });

  store.registerProject({ id: "viewer", name: "Viewer 2", path: tmpDir });

  const sentMessages: any[] = [];
  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = String(url);
    if (urlStr.includes("getUpdates")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 101,
              message: {
                message_id: 1,
                date: 1000,
                chat: { id: 356165930, type: "private" },
                from: { id: 356165930, is_bot: false, first_name: "Владимир" },
                text: "Сделай тест дедупликации",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (urlStr.includes("sendMessage")) {
      const body = JSON.parse(String(init?.body || "{}"));
      sentMessages.push(body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 999 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const client = new TelegramClient({ token: "123:ABC", fetcher: mockFetch });
  const gateway = new TelegramGateway(client, store, { dataDir: tmpDir, defaultProjectId: "viewer" });

  // First poll: processes update 101
  const count1 = await gateway.pollOnce();
  assert.equal(count1, 1, "Первый проход должен обработать 1 обновление");
  assert.equal(store.list().length, 1, "Должно создаться ровно 1 задание в очереди");
  assert.equal(gateway.getOffset(), 102, "Offset должен сдвинуться на 102");

  // Replay poll: same update 101 received again
  const count2 = await gateway.pollOnce();
  assert.equal(count2, 0, "Повторный проход должен проигнорировать дубликат update_id");
  assert.equal(store.list().length, 1, "В очереди по-прежнему должно оставаться ровно 1 задание");

  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("2. voice and photo ingestion via mock transports", async () => {
  const tmpDir = createTempDir("devbot-test-media-");
  const dbPath = path.join(tmpDir, "queue.db");
  const store = openStore({ dbPath });

  store.registerProject({ id: "viewer", name: "Viewer 2", path: tmpDir });

  // Mock voice transcription
  SttService.setMockTranscriber(async (buf, mime) => {
    assert.ok(buf.length > 0, "Буфер аудио не должен быть пустым");
    assert.equal(mime, "audio/ogg");
    return "Голосовая задача через мок транскрибатор";
  });

  const filesDownloaded: string[] = [];
  const mockFetch = async (url: string | URL | Request): Promise<Response> => {
    const urlStr = String(url);
    if (urlStr.includes("getFile")) {
      return new Response(
        JSON.stringify({ ok: true, result: { file_path: "voice/file_123.oga" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (urlStr.includes("/file/bot")) {
      filesDownloaded.push(urlStr);
      return new Response(Buffer.from("FAKE_AUDIO_DATA"), { status: 200 });
    }
    if (urlStr.includes("sendChatAction") || urlStr.includes("sendMessage")) {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const client = new TelegramClient({ token: "123:ABC", fetcher: mockFetch });
  const gateway = new TelegramGateway(client, store, { dataDir: tmpDir, defaultProjectId: "viewer" });

  const voiceUpdate: TelegramUpdate = {
    update_id: 201,
    message: {
      message_id: 2,
      date: 1000,
      chat: { id: 356165930, type: "private" },
      from: { id: 356165930, is_bot: false, first_name: "Владимир" },
      voice: {
        file_id: "voice_file_123",
        file_unique_id: "uniq_123",
        duration: 5,
        mime_type: "audio/ogg",
      },
    },
  };

  await gateway.getHandlers().handleUpdate(voiceUpdate);

  const tasks = store.list();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].goal, "Голосовая задача через мок транскрибатор");
  assert.equal(tasks[0].meta?.isVoice, true);
  assert.equal(filesDownloaded.length, 1);

  // Test photo ingestion
  const photoUpdate: TelegramUpdate = {
    update_id: 202,
    message: {
      message_id: 3,
      date: 1000,
      chat: { id: 356165930, type: "private" },
      from: { id: 356165930, is_bot: false, first_name: "Владимир" },
      caption: "Поправь дизайн по этому скрину",
      photo: [
        { file_id: "thumb_id", width: 100, height: 100 },
        { file_id: "large_id", width: 800, height: 800 },
      ],
    },
  };

  await gateway.getHandlers().handleUpdate(photoUpdate);

  const tasks2 = store.list();
  assert.equal(tasks2.length, 2);
  const photoTask = tasks2.find((t) => t.id !== tasks[0].id);
  assert.ok(photoTask);
  assert.equal(photoTask?.goal, "Поправь дизайн по этому скрину");
  const attachments = photoTask?.meta?.attachments as any[];
  assert.ok(Array.isArray(attachments) && attachments.length === 1);
  assert.equal(attachments[0].type, "photo");
  assert.ok(fs.existsSync(attachments[0].filePath), "Файл фото должен быть сохранен на диск");

  SttService.setMockTranscriber(null);
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("3. unknown project rejection and project routing", async () => {
  const tmpDir = createTempDir("devbot-test-proj-");
  const dbPath = path.join(tmpDir, "queue.db");
  const store = openStore({ dbPath });

  store.registerProject({ id: "viewer", name: "Viewer 2", path: tmpDir });
  store.registerProject({ id: "crm", name: "Журнал CRM", path: tmpDir });

  const sentMessages: string[] = [];
  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(url).includes("sendMessage")) {
      const body = JSON.parse(String(init?.body || "{}"));
      sentMessages.push(body.text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const client = new TelegramClient({ token: "123:ABC", fetcher: mockFetch });
  const gateway = new TelegramGateway(client, store, { dataDir: tmpDir, defaultProjectId: "viewer" });

  // Command for registered project crm
  await gateway.getHandlers().handleUpdate({
    update_id: 301,
    message: {
      message_id: 10,
      date: 1000,
      chat: { id: 356165930, type: "private" },
      from: { id: 356165930, is_bot: false },
      text: "в срм обнови список сотрудников",
    },
  });

  const crmTasks = store.list({ projectId: "crm" });
  assert.equal(crmTasks.length, 1);
  assert.equal(crmTasks[0].projectId, "crm");

  // Unknown project test: dynamically change default to something unregistered
  const handlers = gateway.getHandlers();
  (handlers as any).activeProjectId = "nonexistent_proj";

  await handlers.handleUpdate({
    update_id: 302,
    message: {
      message_id: 11,
      date: 1000,
      chat: { id: 356165930, type: "private" },
      from: { id: 356165930, is_bot: false },
      text: "обычная задача",
    },
  });

  assert.ok(
    sentMessages.some((msg) => msg.includes("Неизвестный проект")),
    "Должно прийти сообщение о неизвестном проекте"
  );

  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("4. cancellation of dangerous commands (pending confirmation)", async () => {
  const tmpDir = createTempDir("devbot-test-cancel-");
  const dbPath = path.join(tmpDir, "queue.db");
  const store = openStore({ dbPath });
  store.registerProject({ id: "viewer", name: "Viewer 2", path: tmpDir });

  let sentMarkup: any = null;
  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(url).includes("sendMessage") || String(url).includes("editMessageText")) {
      const body = JSON.parse(String(init?.body || "{}"));
      if (body.reply_markup) sentMarkup = body.reply_markup;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    if (String(url).includes("answerCallbackQuery")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const client = new TelegramClient({ token: "123:ABC", fetcher: mockFetch });
  const gateway = new TelegramGateway(client, store, { dataDir: tmpDir, defaultProjectId: "viewer" });

  // 1. Send dangerous command: drop database
  await gateway.getHandlers().handleUpdate({
    update_id: 401,
    message: {
      message_id: 20,
      date: 1000,
      chat: { id: 356165930, type: "private" },
      from: { id: 356165930, is_bot: false },
      text: "удалить базу данных и сбросить все таблицы",
    },
  });

  // Check that task is NOT in SQLite store yet
  assert.equal(store.list().length, 0, "Опасная команда не должна сразу попадать в очередь");

  // Check confirmation buttons
  assert.ok(sentMarkup && sentMarkup.inline_keyboard);
  const cancelBtn = sentMarkup.inline_keyboard[0].find((b: any) => b.callback_data?.startsWith("cancel_cmd_"));
  assert.ok(cancelBtn, "Должна быть кнопка отмены");

  // 2. User clicks Cancel
  await gateway.getHandlers().handleUpdate({
    update_id: 402,
    callback_query: {
      id: "cb_1",
      from: { id: 356165930 },
      data: cancelBtn.callback_data,
      message: { message_id: 21, chat: { id: 356165930 } },
    },
  });

  assert.equal(store.list().length, 0, "После отмены задание не должно появиться в очереди");
  assert.equal(gateway.getHandlers().getPendingConfirmations().size, 0);

  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("5. outbox retries, voice failure resilience, and local defaults", async () => {
  const tmpDir = createTempDir("devbot-test-outbox-");
  const dbPath = path.join(tmpDir, "queue.db");
  const store = openStore({ dbPath });
  store.registerProject({ id: "viewer", name: "Viewer 2", path: tmpDir });

  let sendCount = 0;
  let voiceAttempted = false;
  let shouldFailText = false;

  const mockFetch = async (url: string | URL | Request): Promise<Response> => {
    const urlStr = String(url);
    if (urlStr.includes("sendMessage")) {
      sendCount += 1;
      if (shouldFailText) {
        return new Response(JSON.stringify({ ok: false, description: "Network error" }), { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 10 } }), { status: 200 });
    }
    if (urlStr.includes("sendVoice")) {
      voiceAttempted = true;
      return new Response(JSON.stringify({ ok: false, description: "Telegram voice error" }), { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const client = new TelegramClient({ token: "123:ABC", fetcher: mockFetch });
  const outbox = new OutboxService(client, store, { ttsCacheDir: path.join(tmpDir, "tts"), maxRetries: 3 });

  // A. Local task test: notify.telegram = false -> store does not produce notifications, outbox delivers 0
  const localTask = store.submit({
    projectId: "viewer",
    coordinatorId: "codex",
    kind: "diagnostic",
    title: "Локальный тест",
    goal: "Проверка",
    acceptance: [],
    notify: { telegram: false },
  });

  store.claimNext({ projectId: "viewer", executorId: "antigravity", owner: "test-owner" });
  store.report(localTask.id, "test-owner", {
    summary: "Локальный отчёт",
    changedFiles: [],
    checks: [],
    artifacts: [],
    openQuestions: [],
  });

  const localRes = await outbox.deliverPending();
  assert.equal(localRes.length, 0, "Локальные задачи без notify.telegram не создают уведомлений в outbox");
  assert.equal(sendCount, 0, "Локальное задание не должно делать вызовов в Telegram");

  // B. Telegram task with retry
  const tgTask = store.submit({
    projectId: "viewer",
    coordinatorId: "telegram",
    kind: "develop",
    title: "Телеграм тест",
    goal: "Сделай фичу",
    acceptance: [],
    notify: { telegram: true, tts: true, chatId: 356165930 },
  });

  store.claimNext({ projectId: "viewer", executorId: "antigravity", owner: "test-owner-2" });
  store.report(tgTask.id, "test-owner-2", {
    summary: "Успешно сделано!",
    changedFiles: [],
    checks: [],
    artifacts: [],
    openQuestions: [],
  });

  // First outbox pass: text fails
  shouldFailText = true;
  const failRes = await outbox.deliverPending();
  assert.equal(failRes.length, 1);
  assert.equal(failRes[0].textSent, false);
  assert.ok(store.pendingNotifications().length > 0, "При ошибке уведомление должно оставаться в outbox");

  // Second pass: text succeeds, voice fails at Telegram transport level
  shouldFailText = false;
  TtsService.setMockSynthesizer(async (_text, outPath) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, "FAKE_OGG_AUDIO");
    return true;
  });

  const succRes = await outbox.deliverPending();
  assert.equal(succRes.length, 1);
  assert.equal(succRes[0].textSent, true);
  assert.equal(succRes[0].voiceSent, false);
  assert.equal(voiceAttempted, true, "Синтез голоса должен быть вызван");
  assert.equal(store.pendingNotifications().length, 0, "Уведомление должно быть помечено как отправленное");

  // Third pass: nothing pending
  const emptyRes = await outbox.deliverPending();
  assert.equal(emptyRes.length, 0);

  TtsService.setMockSynthesizer(null);
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
