/**
 * Дочерний процесс для теста гонки: ждёт IPC-сигнал и забирает задания.
 * Аргументы: <dbPath> <projectId> <owner>. Печатает JSON-массив полученных id.
 */

import { openStore } from "../store.ts";
import { DEFAULT_EXECUTOR_ID } from "../types.ts";

const [dbPath, projectId, owner] = process.argv.slice(2);

async function main(): Promise<void> {
  const store = openStore({ dbPath });
  const signal = new Promise<number>((resolve, reject) => {
    process.once("message", (message: unknown) => {
      const at = (message as { startAt?: number })?.startAt;
      if (typeof at !== "number" || !Number.isFinite(at)) reject(new Error("Invalid start signal"));
      else resolve(at);
    });
    process.once("disconnect", () => reject(new Error("Parent disconnected before start")));
  });
  process.stdout.write("READY\n");
  const startAt = await signal;
  if (process.connected) process.disconnect();
  await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, startAt - Date.now())));
  const claimed: string[] = [];
  for (;;) {
    const task = store.claimNext({ projectId, executorId: DEFAULT_EXECUTOR_ID, owner });
    if (!task) break;
    claimed.push(task.id);
    // Уступаем цикл событий: иначе удерживавший блокировку процесс почти всегда берёт её снова, и гонки нет.
    await new Promise<void>((resolve) => setTimeout(resolve, Math.floor(Math.random() * 3)));
  }
  store.close();
  process.stdout.write(`CLAIMED ${JSON.stringify(claimed)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
