import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import { openStore } from "../../../runtime/queue/index.ts";
import { TelegramClient } from "../client.ts";
import { TelegramGateway } from "../gateway.ts";
import { SttService } from "../audio/stt.ts";
import { TtsService } from "../audio/tts.ts";
import { SecurityGuard } from "../security.ts";
import { OutboxService } from "../outbox.ts";
import { DevBotDb } from "../db.ts";
import type { TelegramUpdate } from "../types.ts";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("1. atomic single-poller ownership & contention (Point 1)", () => {
  const tmpDir = createTempDir("devbot-test-lock-");
  const dbPath = path.join(tmpDir, "queue.db");
  const db1 = new DevBotDb(dbPath);
  const db2 = new DevBotDb(dbPath);

  const botIdentity = "test_bot_123";
  const ownerA = "poller-process-A";
  const ownerB = "poller-process-B";

  // Process A acquires lock
  const acquiredA = db1.acquireLock(botIdentity, ownerA, 1111, 200);
  assert.equal(acquiredA, true, "Процесс A должен захватить блокировку");

  // Process B attempts to acquire -> fails closed
  const acquiredB = db2.acquireLock(botIdentity, ownerB, 2222, 200);
  assert.equal(acquiredB, false, "Процесс B должен получить отказ при живой блокировке A");

  // Process A releases lock
  db1.releaseLock(botIdentity, ownerA);

  // Process B acquires now
  const acquiredB2 = db2.acquireLock(botIdentity, ownerB, 2222, 200);
  assert.equal(acquiredB2, true, "Процесс B должен захватить блокировку после освобождения A");

  db1.close();
  db2.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("2. durable SQLite inbox & update replay (Point 3)", async () => {
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
  const gateway = new TelegramGateway(client, store, {
    dataDir: tmpDir,
    defaultProjectId: "viewer",
    allowedUsers: new Set([356165930]),
  });

  // First poll: ingests into SQLite inbox and processes update 101
  const count1 = await gateway.pollOnce();
  assert.equal(count1, 1, "Первый проход должен обработать 1 обновление");
  assert.equal(store.list().length, 1, "Должно создаться ровно 1 задание в очереди");
  assert.equal(gateway.getOffset(), 102, "Offset должен сдвинуться на 102");

  // Replay poll: same update 101 received again -> ignored by SQLite inbox
  const count2 = await gateway.pollOnce();
  assert.equal(count2, 0, "Повторный проход должен проигнорировать дубликат update_id");
  assert.equal(store.list().length, 1, "В очереди должно оставаться ровно 1 задание");

  store.close();
  gateway.getDb().close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("3. independent dangerous confirmations survive restart (Point 3)", async () => {
  const tmpDir = createTempDir("devbot-test-conf-");
  const dbPath = path.join(tmpDir, "queue.db");
  const store = openStore({ dbPath });
  store.registerProject({ id: "viewer", name: "Viewer 2", path: tmpDir });

  const devDb = new DevBotDb(path.join(tmpDir, "devbot.sqlite"));

  // Save two independent dangerous confirmations
  devDb.saveConfirmation({
    id: "CONF-001",
    chatId: 356165930,
    userId: 356165930,
    idempotencyKey: "key-1",
    author: "Владимир",
    text: "drop table users",
    projectId: "viewer",
    dangerReason: "Опасное удаление таблицы",
    attachments: [],
    createdAt: Date.now(),
    status: "PENDING",
  });

  devDb.saveConfirmation({
    id: "CONF-002",
    chatId: 356165930,
    userId: 356165930,
    idempotencyKey: "key-2",
    author: "Владимир",
    text: "rm -rf /critical",
    projectId: "viewer",
    dangerReason: "Удаление файлов",
    attachments: [],
    createdAt: Date.now(),
    status: "PENDING",
  });

  devDb.close();

  // Simulate process restart: reopen DB with a fresh handlers instance
  const reloadedDb = new DevBotDb(path.join(tmpDir, "devbot.sqlite"));
  const mockFetch = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  const client = new TelegramClient({ token: "123:ABC", fetcher: mockFetch });
  const gateway = new TelegramGateway(client, store, {
    dataDir: tmpDir,
    defaultProjectId: "viewer",
    allowedUsers: new Set([356165930]),
    db: reloadedDb,
  });

  // Verify both exist after restart
  assert.ok(reloadedDb.getConfirmation("CONF-001"));
  assert.ok(reloadedDb.getConfirmation("CONF-002"));

  // Approve CONF-001
  await gateway.getHandlers().handleUpdate({
    update_id: 1,
    callback_query: {
      id: "cb_1",
      from: { id: 356165930 },
      data: "confirm_cmd_CONF-001",
      message: { message_id: 10, chat: { id: 356165930 } },
    },
  });

  assert.equal(store.list().length, 1, "CONF-001 создаёт задание после одобрения");
  assert.equal(reloadedDb.getConfirmation("CONF-001")?.status, "APPROVED");

  // Cancel CONF-002
  await gateway.getHandlers().handleUpdate({
    update_id: 2,
    callback_query: {
      id: "cb_2",
      from: { id: 356165930 },
      data: "cancel_cmd_CONF-002",
      message: { message_id: 11, chat: { id: 356165930 } },
    },
  });

  assert.equal(store.list().length, 1, "Отмена CONF-002 не создаёт второе задание");
  assert.equal(reloadedDb.getConfirmation("CONF-002")?.status, "CANCELLED");

  store.close();
  reloadedDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("4. exact project routing: no substring guessing, rejects unknown (Point 4)", async () => {
  const tmpDir = createTempDir("devbot-test-routing-");
  const dbPath = path.join(tmpDir, "queue.db");
  const store = openStore({ dbPath });
  store.registerProject({ id: "viewer", name: "Viewer 2", path: tmpDir });
  store.registerProject({ id: "crm", name: "Журнал CRM", path: tmpDir });

  const sentMessages: string[] = [];
  const mockFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    if (body.text) sentMessages.push(body.text);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  };

  const client = new TelegramClient({ token: "123:ABC", fetcher: mockFetch });
  const gateway = new TelegramGateway(client, store, {
    dataDir: tmpDir,
    defaultProjectId: "viewer",
    allowedUsers: new Set([356165930]),
  });

  // A. Substring "crm" in natural text without prefix MUST remain in active project "viewer"
  await gateway.getHandlers().handleUpdate({
    update_id: 1,
    message: {
      message_id: 10,
      date: 1000,
      chat: { id: 356165930, type: "private" },
      from: { id: 356165930, is_bot: false },
      text: "проверь интеграцию crm в коде viewer",
    },
  });

  const viewerTasks = store.list({ projectId: "viewer" });
  assert.equal(viewerTasks.length, 1, "Задача без явного префикса выполняется в активном проекте");
  assert.equal(viewerTasks[0].projectId, "viewer");

  // B. Explicit prefix /p crm routes to crm
  await gateway.getHandlers().handleUpdate({
    update_id: 2,
    message: {
      message_id: 11,
      date: 1000,
      chat: { id: 356165930, type: "private" },
      from: { id: 356165930, is_bot: false },
      text: "/p crm обнови список сотрудников",
    },
  });

  const crmTasks = store.list({ projectId: "crm" });
  assert.equal(crmTasks.length, 1);
  assert.equal(crmTasks[0].projectId, "crm");

  // C. Explicit unknown project /p unknown_foo rejects with error, NO fallback
  sentMessages.length = 0;
  await gateway.getHandlers().handleUpdate({
    update_id: 3,
    message: {
      message_id: 12,
      date: 1000,
      chat: { id: 356165930, type: "private" },
      from: { id: 356165930, is_bot: false },
      text: "/p unknown_foo сделай что-нибудь",
    },
  });

  assert.equal(store.list().length, 2, "Неизвестный проект не создает задания в очереди");
  assert.ok(
    sentMessages.some((m) => m.includes("не зарегистрирован")),
    "Должно быть отправлено сообщение об ошибке незарегистрированного проекта"
  );

  store.close();
  gateway.getDb().close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("5. private chat & numeric user ID enforcement (Point 4)", async () => {
  const tmpDir = createTempDir("devbot-test-sec-");
  const dbPath = path.join(tmpDir, "queue.db");
  const store = openStore({ dbPath });
  store.registerProject({ id: "viewer", name: "Viewer 2", path: tmpDir });

  const sentMessages: string[] = [];
  const mockFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    if (body.text) sentMessages.push(body.text);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  };

  const client = new TelegramClient({ token: "123:ABC", fetcher: mockFetch });
  const gateway = new TelegramGateway(client, store, {
    dataDir: tmpDir,
    defaultProjectId: "viewer",
    allowedUsers: new Set([356165930]),
  });

  // Group chat attempt: dropped immediately
  await gateway.getHandlers().handleUpdate({
    update_id: 1,
    message: {
      message_id: 10,
      date: 1000,
      chat: { id: -1001234567, type: "supergroup" },
      from: { id: 356165930, is_bot: false },
      text: "команда в группе",
    },
  });

  assert.equal(store.list().length, 0, "Групповые сообщения не создают заданий");
  assert.equal(sentMessages.length, 0, "В группу не отправляются ответы");

  // Non-authorized numeric user ID attempt
  await gateway.getHandlers().handleUpdate({
    update_id: 2,
    message: {
      message_id: 11,
      date: 1000,
      chat: { id: 999999999, type: "private" },
      from: { id: 999999999, is_bot: false },
      text: "хакерская команда",
    },
  });

  assert.equal(store.list().length, 0);
  assert.ok(sentMessages.some((m) => m.includes("ДОСТУП ЗАПРЕЩЁН")));

  store.close();
  gateway.getDb().close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("6. file upload: UUID local name, safe basename, truthful STT failure (Point 6 & 7)", async () => {
  const tmpDir = createTempDir("devbot-test-media-");
  const dbPath = path.join(tmpDir, "queue.db");
  const store = openStore({ dbPath });
  store.registerProject({ id: "viewer", name: "Viewer 2", path: tmpDir });

  let downloadUrl = "";
  const mockFetch = async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes("getFile")) {
      return new Response(JSON.stringify({ ok: true, result: { file_path: "docs/traversal.txt" } }), { status: 200 });
    }
    if (urlStr.includes("/file/bot")) {
      downloadUrl = urlStr;
      return new Response(Buffer.from("SAFE_DATA"), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  };

  const client = new TelegramClient({ token: "123:ABC", fetcher: mockFetch });
  const gateway = new TelegramGateway(client, store, {
    dataDir: tmpDir,
    defaultProjectId: "viewer",
    allowedUsers: new Set([356165930]),
  });

  // Document upload with path traversal in file_name
  await gateway.getHandlers().handleUpdate({
    update_id: 1,
    message: {
      message_id: 20,
      date: 1000,
      chat: { id: 356165930, type: "private" },
      from: { id: 356165930, is_bot: false },
      caption: "Анализ документа",
      document: {
        file_id: "doc_123",
        file_name: "../../../etc/passwd.txt",
      },
    },
  });

  const tasks = store.list();
  assert.equal(tasks.length, 1);
  const attachments = tasks[0].meta?.attachments as any[];
  assert.ok(attachments && attachments.length === 1);
  // Display name is sanitized
  assert.equal(attachments[0].fileName, "passwd.txt");
  // Saved path is inside incomingDir with UUID
  assert.ok(attachments[0].filePath.includes(tmpDir));
  assert.ok(fs.existsSync(attachments[0].filePath));

  // Test STT failure: does NOT queue empty/partial task
  SttService.setMockTranscriber(async () => {
    throw new Error("Quota exceeded 429");
  });

  await gateway.getHandlers().handleUpdate({
    update_id: 2,
    message: {
      message_id: 21,
      date: 1000,
      chat: { id: 356165930, type: "private" },
      from: { id: 356165930, is_bot: false },
      voice: { file_id: "v_123", file_unique_id: "uniq_v", duration: 3 },
    },
  });

  assert.equal(store.list().length, 1, "При ошибке STT задача не должна создаваться");

  SttService.setMockTranscriber(null);
  store.close();
  gateway.getDb().close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("7. durable outbox progress, text never resent on voice failure or restart (Point 2)", async () => {
  const tmpDir = createTempDir("devbot-test-outbox-");
  const dbPath = path.join(tmpDir, "queue.db");
  const store = openStore({ dbPath });
  store.registerProject({ id: "viewer", name: "Viewer 2", path: tmpDir });

  let textSends = 0;
  let voiceSends = 0;
  let failVoice = true;

  const mockFetch = async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes("sendMessage")) {
      textSends += 1;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 10 } }), { status: 200 });
    }
    if (urlStr.includes("sendVoice")) {
      voiceSends += 1;
      if (failVoice) {
        return new Response(JSON.stringify({ ok: false, description: "Voice error" }), { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 11 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const client = new TelegramClient({ token: "123:ABC", fetcher: mockFetch });
  const outbox = new OutboxService(client, store, {
    dataDir: tmpDir,
    ttsCacheDir: path.join(tmpDir, "tts"),
  });

  TtsService.setMockSynthesizer(async (_text, outPath) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, "OggS_FAKE_VOICE");
    return true;
  });

  const task = store.submit({
    projectId: "viewer",
    coordinatorId: "telegram",
    kind: "develop",
    title: "Тест доставки",
    goal: "Проверить outbox",
    acceptance: [],
    notify: { telegram: true, tts: true, chatId: 356165930 },
  });

  store.claimNext({ projectId: "viewer", executorId: "antigravity", owner: "test-owner" });
  store.report(task.id, "test-owner", {
    summary: "Успешный отчёт",
    changedFiles: [],
    checks: [],
    artifacts: [],
    openQuestions: [],
  });

  // First pass: text succeeds, voice fails
  const res1 = await outbox.deliverPending();
  assert.equal(res1.length, 1);
  assert.equal(res1[0].textSent, true);
  assert.equal(res1[0].voiceSent, false);
  assert.equal(textSends, 1);
  assert.equal(voiceSends, 1);
  assert.equal(store.pendingNotifications().length, 1, "Уведомление остается в очереди пока голос не сдан");

  // Reopen outbox service (simulate restart)
  const outbox2 = new OutboxService(client, store, {
    ttsCacheDir: path.join(tmpDir, "tts"),
    db: outbox.getDb(),
  });

  // Reset retry deadline to allow immediate retry
  outbox.getDb().updateOutboxProgress(res1[0].notificationId, { next_retry_at: 0 });

  // Voice now succeeds
  failVoice = false;
  const res2 = await outbox2.deliverPending();
  assert.equal(res2.length, 1);
  assert.equal(res2[0].textSent, true);
  assert.equal(res2[0].voiceSent, true);
  assert.equal(textSends, 1, "Текст НЕ должен отправляться повторно!");
  assert.equal(voiceSends, 2, "Голос был повторен успешно");
  assert.equal(store.pendingNotifications().length, 0, "После успешной отправки голоса уведомление снято");

  TtsService.setMockSynthesizer(null);
  store.close();
  outbox.getDb().close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("8. idempotent migration CLI (Point 8)", () => {
  const tmpDir = createTempDir("devbot-test-migrate-");
  const dbPath = path.join(tmpDir, "queue.db");
  const queuePath = path.join(tmpDir, "queue.json");
  const projectsPath = path.join(tmpDir, "projects.json");

  fs.writeFileSync(
    projectsPath,
    JSON.stringify({
      projects: [{ id: "crm", name: "CRM", path: tmpDir, aliases: ["crm"] }],
    })
  );

  fs.writeFileSync(
    queuePath,
    JSON.stringify({
      commands: [
        {
          id: "CMD-001",
          projectId: "crm",
          text: "Миграционная задача",
          status: "COMPLETED",
          result: "Готово",
          createdAt: new Date().toISOString(),
        },
      ],
    })
  );

  // Run migration script
  const migrateScript = path.resolve(__dirname, "../runner/migrate.ts");
  const out = execSync(
    `npx tsx "${migrateScript}" --queue="${queuePath}" --projects="${projectsPath}" --db="${dbPath}"`,
    { encoding: "utf-8" }
  );

  const parsed = JSON.parse(out);
  assert.equal(parsed.imported, 1);
  assert.equal(parsed.projects, 1);

  // Second run: idempotent
  const out2 = execSync(
    `npx tsx "${migrateScript}" --queue="${queuePath}" --projects="${projectsPath}" --db="${dbPath}"`,
    { encoding: "utf-8" }
  );
  const parsed2 = JSON.parse(out2);
  assert.equal(parsed2.imported, 0, "Повторный запуск не дублирует импортированные команды");
  assert.equal(parsed2.skipped, 1);

  // Verify source files remain unchanged
  assert.ok(fs.existsSync(queuePath));
  assert.ok(fs.existsSync(projectsPath));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
