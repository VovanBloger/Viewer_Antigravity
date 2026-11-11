import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { AgentTask, TaskSpec } from "../queue/types.ts";
import { assessSwarm, createWorktrees, planSwarm, removeWorktrees, verifyModel } from "./swarm.ts";

const spec = (p: string[]): TaskSpec => ({ projectId: "viewer", kind: "develop", title: "t", goal: "g", acceptance: ["a"], coordinatorId: "claude", allowedPaths: p });
const task = (id: string, o: Partial<AgentTask>): AgentTask => ({ id, status: "REPORTED", verdicts: [], ...o } as AgentTask);
const rep = (r: object) => r as AgentTask["report"];

test("план отклоняет пересечения, пустые области и более трёх задач", () => {
  assert.throws(() => planSwarm("r1", [spec(["src"]), spec(["src/a"])], "/w"), /ALLOWED_PATHS_OVERLAP:1:2/);
  assert.throws(() => planSwarm("r1", [spec([])], "/w"), /ALLOWED_PATHS_REQUIRED/);
  assert.throws(() => planSwarm("r1", [1, 2, 3, 4].map((i) => spec([`d${i}`])), "/w"), /SWARM_SIZE_INVALID/);
  assert.throws(() => planSwarm("../x", [spec(["a"])], "/w"), /INVALID_RUN_ID/);
  assert.doesNotThrow(() => planSwarm("r1", [spec(["a/**"]), spec(["ab"]), spec(["c"])], "/w"));
});

test("план даёт уникальные ветки, worktree и ключи идемпотентности", () => {
  const p = planSwarm("r2", [spec(["a"]), spec(["b"]), spec(["c"])], "/w");
  assert.equal(new Set(p.members.map((m) => m.branch)).size, 3);
  assert.equal(p.members[1].spec.idempotencyKey, "swarm:r2:2");
  assert.equal(p.members[2].spec.branch, "swarm/r2/3");
});

test("три реальных git worktree создаются и удаляются", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo });
  git("init", "-q");
  fs.writeFileSync(path.join(repo, "f.txt"), "x");
  git("add", ".");
  git("commit", "-qm", "i");
  const plan = planSwarm("r3", [spec(["a"]), spec(["b"]), spec(["c"])], path.join(root, "wt"));
  await createWorktrees(plan, repo);
  for (const m of plan.members) assert.ok(fs.existsSync(path.join(m.worktree, "f.txt")));
  await assert.rejects(createWorktrees(plan, repo));
  assert.ok(fs.existsSync(plan.members[0].worktree), "повтор не должен сносить чужие worktree");
  await removeWorktrees(plan, repo);
  assert.ok(!fs.existsSync(plan.members[0].worktree));
  assert.equal(git("branch", "--list", "swarm/*").toString().trim(), "");
  fs.rmSync(root, { recursive: true, force: true });
});

test("проверка модели и оценка роя", () => {
  const ok = task("T-1", { report: rep({ model: "Gemini 3.8 Flash", changedFiles: ["a.ts"] }) });
  const bad = task("T-2", { report: rep({ model: "gpt-x", changedFiles: ["a.ts"] }) });
  const none = task("T-3", { report: rep({ changedFiles: [] }) });
  const quota = task("T-4", { status: "FAILED", failure: { code: "QUOTA_EXHAUSTED", reason: "q" } });
  assert.equal(verifyModel(ok, "flash").ok, true);
  assert.deepEqual(verifyModel(none, "flash"), { ok: false, reason: "MODEL_MISSING" });
  const r = assessSwarm([ok, bad, none, quota, task("T-5", { status: "IN_PROGRESS" })], "flash");
  assert.deepEqual(r.dispositions.map((d) => d.action), ["review", "request_changes", "request_changes", "retry_later", "wait"]);
  assert.deepEqual(r.conflicts, ["a.ts"]);
});
