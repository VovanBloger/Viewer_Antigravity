import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { importLegacyQueue } from "./legacy-import.ts";
import { openStore } from "./store.ts";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-queue-legacy-"));
  const projectsFile = path.join(dir, "projects.config.json");
  const queueFile = path.join(dir, "queue.json");
  fs.writeFileSync(
    projectsFile,
    JSON.stringify({
      activeProjectId: "crm",
      projects: [
        { id: "crm", name: "Журнал CRM", icon: "x", path: "c:\\work\\crm", aliases: ["crm", "срм", "журнал"] },
        { id: "vpn", name: "VPN", icon: "y", path: "c:\\work\\vpn", aliases: ["журнал", "впн"] },
      ],
    }),
  );
  const base = { projectName: "n", projectPath: "p", chatId: 777, author: "Vova", isDangerous: false };
  const longLine = "Д".repeat(120);
  fs.writeFileSync(
    queueFile,
    JSON.stringify({
      isActive: true,
      activeProjectId: "crm",
      pendingConfirmationId: "CMD-007",
      // как в Dev Bot: новые команды первыми
      commands: [
        { ...base, id: "CMD-007", projectId: "crm", text: "rm -rf", status: "PENDING_CONFIRMATION", createdAt: "2026-01-07T10:00:00.000Z" },
        { ...base, id: "CMD-006", projectId: "ghost", text: "куда-то", status: "QUEUED", createdAt: "2026-01-06T10:00:00.000Z" },
        { ...base, id: "CMD-005", projectId: "crm", text: "отменено", status: "CANCELLED", createdAt: "2026-01-05T10:00:00.000Z" },
        {
          ...base,
          id: "CMD-004",
          projectId: "vpn",
          text: "упало",
          status: "FAILED",
          error: "boom BOT_TOKEN=abc",
          createdAt: "2026-01-04T10:00:00.000Z",
          completedAt: "2026-01-04T11:00:00.000Z",
        },
        {
          ...base,
          id: "CMD-003",
          projectId: "crm",
          text: "готово",
          status: "COMPLETED",
          result: "Сделано",
          createdAt: "2026-01-03T10:00:00.000Z",
          completedAt: "2026-01-03T12:00:00.000Z",
        },
        {
          ...base,
          id: "CMD-002",
          projectId: "crm",
          text: "в работе",
          status: "IN_PROGRESS",
          createdAt: "2026-01-02T10:00:00.000Z",
          startedAt: "2026-01-02T10:05:00.000Z",
        },
        {
          ...base,
          id: "CMD-001",
          projectId: "crm",
          text: `${longLine}\nвторая строка`,
          status: "QUEUED",
          createdAt: "2026-01-01T10:00:00.000Z",
          attachments: [{ type: "photo", filePath: "c:\\tmp\\a.jpg" }],
        },
      ],
    }),
  );
  return { dir, projectsFile, queueFile, longLine };
}

test("импорт старой очереди: статусы, поля, идемпотентность, исходники не меняются", () => {
  const { dir, projectsFile, queueFile, longLine } = fixture();
  const before = { q: fs.readFileSync(queueFile, "utf-8"), p: fs.readFileSync(projectsFile, "utf-8") };
  const store = openStore({ dbPath: path.join(dir, "queue.db") });
  try {
    const first = importLegacyQueue(store, { queueFile, projectsFile });
    assert.deepEqual(first, { projects: 2, imported: 6, skipped: 0, unknownProject: ["CMD-006 (ghost)"] });

    // проекты: конфликтующий алиас не ломает импорт
    assert.equal(store.getProject("срм")?.id, "crm");
    assert.equal(store.getProject("журнал")?.id, "crm");
    assert.equal(store.getProject("VPN")?.path, "c:\\work\\vpn");

    const queued = store.getByLegacyId("CMD-001");
    assert.ok(queued);
    assert.equal(queued.status, "QUEUED");
    assert.equal(queued.kind, "develop");
    assert.equal(queued.title, longLine.slice(0, 80));
    assert.equal(queued.goal, `${longLine}\nвторая строка`);
    assert.equal(queued.coordinatorId, "telegram");
    assert.deepEqual(queued.notify, { telegram: true, chatId: 777 });
    assert.deepEqual(queued.meta, {
      author: "Vova",
      attachments: [{ type: "photo", filePath: "c:\\tmp\\a.jpg" }],
      legacy: true,
    });
    assert.equal(queued.createdAt, "2026-01-01T10:00:00.000Z");
    assert.equal(queued.legacyId, "CMD-001");
    assert.equal(queued.version, 1);

    const wasRunning = store.getByLegacyId("CMD-002");
    assert.ok(wasRunning);
    assert.equal(wasRunning.status, "FAILED");
    assert.equal(wasRunning.failure?.code, "LEGACY_EXECUTOR_UNKNOWN");
    assert.equal(wasRunning.owner, undefined);
    const imported = store.events(wasRunning.id);
    assert.equal(imported.length, 1);
    assert.equal(imported[0].type, "imported");
    assert.equal(imported[0].data?.legacyStatus, "IN_PROGRESS");
    assert.equal(typeof imported[0].data?.note, "string");

    const done = store.getByLegacyId("CMD-003");
    assert.equal(done?.status, "APPROVED");
    assert.equal(done?.report?.summary, "Сделано");
    assert.equal(done?.updatedAt, "2026-01-03T12:00:00.000Z");

    const failed = store.getByLegacyId("CMD-004");
    assert.equal(failed?.status, "FAILED");
    assert.equal(failed?.projectId, "vpn");
    assert.deepEqual(failed?.failure, { code: "EXECUTOR_ERROR", reason: "boom BOT_TOKEN=[REDACTED]" });

    assert.equal(store.getByLegacyId("CMD-005")?.status, "CANCELLED");
    assert.equal(store.getByLegacyId("CMD-006"), undefined);
    assert.equal(store.getByLegacyId("CMD-007")?.status, "CANCELLED");
    assert.equal(store.getByLegacyId("CMD-007")?.goal, "rm -rf");
    assert.equal(store.getByLegacyId("CMD-007")?.meta?.legacyConfirmationRequired, true);

    // исторические задания не порождают уведомлений
    assert.deepEqual(store.pendingNotifications(), []);

    // старые задания выдаются в порядке возраста
    const claimed = store.claimNext({ projectId: "crm", executorId: "antigravity", owner: "s1" });
    assert.equal(claimed?.legacyId, "CMD-001");
    assert.equal(store.claimNext({ projectId: "crm", executorId: "antigravity", owner: "s1" }), null);

    const second = importLegacyQueue(store, { queueFile, projectsFile });
    assert.equal(second.imported, 0);
    assert.equal(second.skipped, 6);
    assert.deepEqual(second.unknownProject, ["CMD-006 (ghost)"]);
    assert.equal(store.list().length, 6);

    assert.equal(fs.readFileSync(queueFile, "utf-8"), before.q);
    assert.equal(fs.readFileSync(projectsFile, "utf-8"), before.p);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("без projectsFile проекты не регистрируются и ничего не импортируется наугад", () => {
  const { dir, queueFile } = fixture();
  const store = openStore({ dbPath: ":memory:" });
  try {
    const result = importLegacyQueue(store, { queueFile });
    assert.equal(result.projects, 0);
    assert.equal(result.imported, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.unknownProject.length, 7);
    assert.equal(store.list().length, 0);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
