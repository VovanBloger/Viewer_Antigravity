/**
 * Viewer 2 — CLI инструмент для идемпотентного импорта очереди старого Dev Bot в SQLite.
 *
 *   tsx integrations/devbot/runner/migrate.ts --queue=<путь> [--projects=<путь>] [--db=<путь>]
 *
 * Исходные JSON-файлы не изменяются (read-only). Исторические задачи и отчёты сохраняются.
 */

import { openStore, defaultDbPath } from "../../../runtime/queue/index.ts";
import { importLegacyQueue } from "../../../runtime/queue/legacy-import.ts";
import { parseArgs, optString, requireString } from "../../../runtime/cli/args.ts";

function main() {
  const parsed = parseArgs(process.argv.slice(2));

  let queueFile = optString(parsed, "queue") || optString(parsed, "file");
  if (!queueFile) {
    try {
      queueFile = requireString(parsed, "queue");
    } catch {
      console.error("Ошибка: параметр --queue=<путь к queue.json> обязателен");
      process.exit(2);
    }
  }

  const projectsFile = optString(parsed, "projects");
  const dbPath = optString(parsed, "db") || process.env.VIEWER_QUEUE_DB || defaultDbPath();

  const store = openStore({ dbPath });

  try {
    const result = importLegacyQueue(store, {
      queueFile,
      ...(projectsFile ? { projectsFile } : {}),
    });

    console.log(JSON.stringify(result, null, 2));
    store.close();
    process.exit(0);
  } catch (err: any) {
    console.error("Ошибка миграции:", err.message || err);
    store.close();
    process.exit(1);
  }
}

main();
