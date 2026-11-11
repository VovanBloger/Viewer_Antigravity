/**
 * CLI роя (D2): npm run agents:swarm -- start|status --run=<id>
 * start  — три worktree + три независимых безопасных задания (каждое пишет свой файл в docs/swarm-probe/).
 * status — оценка отчётов: модель, конфликты файлов, квота.
 * Запускать с VIEWER_QUEUE_DB (по умолчанию .viewer-live/agent-queue.db).
 */
import path from "node:path";

import { openStore } from "../queue/index.ts";
import type { TaskSpec } from "../queue/types.ts";
import { assessSwarm, createWorktrees, planSwarm, submitSwarm } from "../swarm/swarm.ts";

const arg = (n: string, d?: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const cmd = process.argv[2];
const runId = arg("run", "probe1")!;
const project = arg("project", "viewer")!;
const model = arg("model", "flash")!;
const dbPath = process.env.VIEWER_QUEUE_DB ?? path.resolve(".viewer-live", "agent-queue.db");
const store = openStore({ dbPath });

const probe = (n: number): TaskSpec => ({
  projectId: project, kind: "develop", coordinatorId: "claude",
  title: `Swarm probe ${n}`,
  goal: `В своём worktree создай файл docs/swarm-probe/probe-${n}.md с одной строкой "probe ${n}" и закоммить его в ветку worktree. Больше ничего не меняй.`,
  acceptance: [`Файл docs/swarm-probe/probe-${n}.md существует и закоммичен`, "В отчёте указана фактическая модель (поле model)"],
  allowedPaths: [`docs/swarm-probe/probe-${n}.md`],
  checks: ["git status --short"],
});

async function main() {
if (cmd === "start") {
  const root = path.resolve(arg("root", path.join(".viewer-live", "worktrees"))!);
  const plan = planSwarm(runId, [1, 2, 3].map(probe), root);
  await createWorktrees(plan, path.resolve("."));
  console.log(JSON.stringify({ tasks: submitSwarm(store, plan).map((t) => ({ id: t.id, branch: t.branch, workdir: t.workdir })) }, null, 2));
} else if (cmd === "status") {
  const tasks = store.listTasks({ projectId: project }).filter((t) => t.idempotencyKey?.startsWith(`swarm:${runId}:`));
  console.log(JSON.stringify({ statuses: tasks.map((t) => [t.id, t.status]), ...assessSwarm(tasks, model) }, null, 2));
} else {
  console.error("Usage: agents:swarm start|status --run=<id> [--project=viewer] [--model=flash]");
  process.exit(2);
}
store.close();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : "SWARM_FAILED"); process.exit(1); });
