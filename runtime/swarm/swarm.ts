/**
 * Viewer 2 — рой: до трёх параллельных исполнителей, каждый в своём git worktree.
 * Чистые функции планирования/проверки + создание worktree; очередь не изменяется напрямую,
 * кроме submitSwarm (идемпотентная постановка).
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { AgentTask, TaskSpec, TaskStore } from "../queue/types.ts";

const run = promisify(execFile);
export const MAX_SWARM = 3;

export interface SwarmMember { index: number; spec: TaskSpec; branch: string; worktree: string }
export interface SwarmPlan { runId: string; members: SwarmMember[] }

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").replace(/\/\*\*?$/, "");
/** Области пересекаются, если одна — префикс другой (по границе каталога). */
export function pathsOverlap(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  return x === y || x === "" || y === "" || x.startsWith(y + "/") || y.startsWith(x + "/");
}

export function planSwarm(runId: string, specs: TaskSpec[], worktreesRoot: string): SwarmPlan {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(runId)) throw new Error("INVALID_RUN_ID");
  if (specs.length === 0 || specs.length > MAX_SWARM) throw new Error("SWARM_SIZE_INVALID");
  for (const s of specs) if (!s.allowedPaths?.length) throw new Error("ALLOWED_PATHS_REQUIRED");
  for (let i = 0; i < specs.length; i++)
    for (let j = i + 1; j < specs.length; j++)
      for (const a of specs[i].allowedPaths!)
        for (const b of specs[j].allowedPaths!)
          if (pathsOverlap(a, b)) throw new Error(`ALLOWED_PATHS_OVERLAP:${i + 1}:${j + 1}`);
  const members = specs.map((spec, i) => {
    const branch = `swarm/${runId}/${i + 1}`;
    const worktree = path.join(worktreesRoot, `${runId}-${i + 1}`);
    return { index: i + 1, branch, worktree, spec: { ...spec, branch, workdir: worktree, idempotencyKey: `swarm:${runId}:${i + 1}` } };
  });
  return { runId, members };
}

export async function createWorktrees(plan: SwarmPlan, repoPath: string, base = "HEAD"): Promise<void> {
  const done: SwarmMember[] = [];
  try {
    for (const m of plan.members) {
      await run("git", ["worktree", "add", "-b", m.branch, m.worktree, base], { cwd: repoPath });
      done.push(m);
    }
  } catch (e) {
    await removeWorktrees({ runId: plan.runId, members: done }, repoPath); // откат частичного создания
    throw e;
  }
}

export async function removeWorktrees(plan: SwarmPlan, repoPath: string): Promise<void> {
  for (const m of plan.members) {
    await run("git", ["worktree", "remove", "--force", m.worktree], { cwd: repoPath }).catch(() => {});
    await run("git", ["branch", "-D", m.branch], { cwd: repoPath }).catch(() => {});
  }
}

export function submitSwarm(store: Pick<TaskStore, "submit">, plan: SwarmPlan): AgentTask[] {
  return plan.members.map((m) => store.submit(m.spec));
}

export type ModelCheck = { ok: true; model: string } | { ok: false; reason: "MODEL_MISSING" | "MODEL_MISMATCH"; model?: string };
/** Заявленная модель должна содержать ожидаемую подстроку (без учёта регистра). Мост её сам не проверяет. */
export function verifyModel(task: Pick<AgentTask, "report">, expected: string): ModelCheck {
  const m = task.report?.model?.trim();
  if (!m) return { ok: false, reason: "MODEL_MISSING" };
  return m.toLowerCase().includes(expected.toLowerCase()) ? { ok: true, model: m } : { ok: false, reason: "MODEL_MISMATCH", model: m };
}

export type Disposition =
  | { taskId: string; action: "review" }
  | { taskId: string; action: "request_changes"; notes: string }
  | { taskId: string; action: "retry_later"; reason: string }
  | { taskId: string; action: "wait" }
  | { taskId: string; action: "failed"; reason: string };

/** Рекомендации по каждому заданию роя; вердикт всё равно выносит координатор. */
export function assessSwarm(tasks: AgentTask[], expectedModel: string): { dispositions: Disposition[]; conflicts: string[] } {
  const dispositions = tasks.map((t): Disposition => {
    if (t.status === "FAILED") {
      return t.failure?.code === "QUOTA_EXHAUSTED"
        ? { taskId: t.id, action: "retry_later", reason: "Квота исполнителя исчерпана; поставить заново после сброса" }
        : { taskId: t.id, action: "failed", reason: t.failure?.code ?? "UNKNOWN" };
    }
    if (t.status !== "REPORTED") return { taskId: t.id, action: "wait" };
    const mc = verifyModel(t, expectedModel);
    if (!mc.ok) return { taskId: t.id, action: "request_changes", notes: `Модель не подтверждена (${mc.reason}, заявлено: ${mc.model ?? "—"}, ожидалось: ${expectedModel})` };
    return { taskId: t.id, action: "review" };
  });
  const seen = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const t of tasks) for (const f of t.report?.changedFiles ?? []) {
    const k = norm(f), owner = seen.get(k);
    if (owner && owner !== t.id) conflicts.add(k); else seen.set(k, t.id);
  }
  return { dispositions, conflicts: [...conflicts] };
}
