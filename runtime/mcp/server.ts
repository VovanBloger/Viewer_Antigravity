/**
 * Viewer 2 — MCP-сервер "viewer-agents" для координаторов (Codex / Claude), транспорт stdio.
 *
 * В stdout идёт только протокол MCP; любые сообщения для человека — в stderr.
 */

import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { redactDeep } from "../queue/redact.ts";
import { openStore } from "../queue/store.ts";
import type { NotifyOptions, TaskSpec, TaskStore } from "../queue/types.ts";
import {
  DEFAULT_LIST_LIMIT,
  cancelTask,
  getTask,
  listTasks,
  recentEvents,
  submitTask,
  submitVerdict,
  toListItem,
  toPublicTask,
  toServiceError,
  waitTask,
} from "../service.ts";

const TASK_KINDS = ["develop", "test", "browser-check", "review", "diagnostic"] as const;
const TASK_STATUSES = ["QUEUED", "IN_PROGRESS", "REPORTED", "APPROVED", "RETURNED", "FAILED", "CANCELLED"] as const;
const DEFAULT_WAIT_SECONDS = 120;
const MAX_WAIT_SECONDS = 600;

interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(redactDeep(payload), null, 2) }] };
}

/** Выполняет обработчик инструмента; любая ошибка превращается в isError с { code, message }. */
async function guard(run: () => unknown | Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await run());
  } catch (error) {
    return { content: [{ type: "text", text: JSON.stringify(toServiceError(error), null, 2) }], isError: true };
  }
}

const taskId = z.string().describe('Task id, e.g. "T-000123".');

export function createServer(store: TaskStore): McpServer {
  const server = new McpServer({ name: "viewer-agents", version: "0.1.0" });

  server.registerTool(
    "submit_agent_task",
    {
      description:
        "Queue a task for an executor agent (an Antigravity conversation waiting on the project). " +
        "projectId must be an exact registered project id or alias (see list_projects); unknown projects are rejected, never guessed. " +
        "Returns the created task; keep its id and version, then call wait_agent_task. " +
        "Never put secrets (tokens, cookies, API keys) into the task text.",
      inputSchema: {
        projectId: z.string().describe("Exact id or alias of a registered project."),
        kind: z.enum(TASK_KINDS),
        title: z.string().describe("Short task title."),
        goal: z.string().describe("What must be achieved, in free form."),
        acceptance: z.array(z.string()).describe("Verifiable completion criteria."),
        constraints: z.array(z.string()).optional().describe("Hard constraints the executor must respect."),
        allowedPaths: z.array(z.string()).optional().describe("Globs (relative to the project) the executor may change. Empty = unrestricted."),
        checks: z.array(z.string()).optional().describe("Commands the executor must actually run and report (build, tests)."),
        expectedArtifacts: z.array(z.string()).optional(),
        coordinatorId: z.string().describe('Who submits the task and will give the verdict, e.g. "codex" or "claude".'),
        executorId: z.string().optional().describe('Target executor; defaults to "antigravity".'),
        baseRevision: z.string().optional(),
        branch: z.string().optional().describe("Branch / worktree to work in."),
        workdir: z.string().optional().describe("Working directory override; defaults to the project path."),
        idempotencyKey: z.string().optional().describe("Resubmitting with the same key returns the already created task."),
        leaseMinutes: z.number().min(1).max(1440).optional().describe("Ownership lease in minutes (default 30)."),
        notifyTelegram: z.boolean().optional().describe("Queue a Telegram notification for the result (default false). Requires chatId."),
        chatId: z.number().optional().describe("Telegram chat id for notifications."),
      },
    },
    (args) =>
      guard(() => {
        const { leaseMinutes, notifyTelegram, chatId, ...rest } = args;
        const spec: TaskSpec = { ...rest };
        if (leaseMinutes !== undefined) spec.leaseMs = Math.round(leaseMinutes * 60_000);
        if (notifyTelegram !== undefined || chatId !== undefined) {
          const notify: NotifyOptions = { telegram: notifyTelegram === true };
          if (chatId !== undefined) notify.chatId = chatId;
          spec.notify = notify;
        }
        return { task: toPublicTask(submitTask(store, spec), { compact: true }) };
      }),
  );

  server.registerTool(
    "get_agent_task",
    {
      description:
        "Get the current state of a task: status, a short progress line, the latest report and verdicts, plus the last 10 events. " +
        "Long texts are trimmed unless full is true. To wait for a result use wait_agent_task instead of calling this repeatedly.",
      inputSchema: {
        taskId,
        full: z.boolean().optional().describe("Return untrimmed texts and all task fields (still secret-redacted)."),
      },
    },
    (args) =>
      guard(() => ({
        task: toPublicTask(getTask(store, args.taskId), { compact: args.full !== true }),
        events: recentEvents(store, args.taskId, 10),
      })),
  );

  server.registerTool(
    "wait_agent_task",
    {
      description:
        "Block until the task changes meaningfully (claimed, reported, failed, cancelled, requeued) or the timeout elapses; executor heartbeats do not wake it. " +
        'Returns the task and "changed". Pass the last seen task.version as sinceVersion. ' +
        "Without sinceVersion it returns immediately when the task already awaits a verdict or is finished. " +
        "If changed is false the timeout elapsed: call again rather than polling get_agent_task. " +
        "When status is REPORTED, review the report and call submit_verdict.",
      inputSchema: {
        taskId,
        sinceVersion: z.number().int().min(0).optional().describe("Last task.version you have seen."),
        timeoutSeconds: z
          .number()
          .min(0)
          .max(MAX_WAIT_SECONDS)
          .optional()
          .describe(`How long to block, seconds (default ${DEFAULT_WAIT_SECONDS}, max ${MAX_WAIT_SECONDS}).`),
      },
    },
    (args) =>
      guard(async () => {
        const result = await waitTask(store, args.taskId, {
          sinceVersion: args.sinceVersion,
          timeoutMs: (args.timeoutSeconds ?? DEFAULT_WAIT_SECONDS) * 1000,
        });
        return { changed: result.changed, task: toPublicTask(result.task, { compact: true }) };
      }),
  );

  server.registerTool(
    "cancel_agent_task",
    {
      description:
        "Cancel a task. QUEUED or REPORTED tasks become CANCELLED at once. For an IN_PROGRESS task this only sets cancelRequested: " +
        "the executor sees it on its next heartbeat and stops, so the status changes later (use wait_agent_task). Finished tasks cannot be cancelled.",
      inputSchema: {
        taskId,
        by: z.string().describe('Who cancels, e.g. "codex".'),
      },
    },
    (args) => guard(() => ({ task: toPublicTask(cancelTask(store, args.taskId, args.by), { compact: true }) })),
  );

  server.registerTool(
    "submit_verdict",
    {
      description:
        "Give the coordinator's verdict on a REPORTED task. " +
        '"approve" only marks the task APPROVED: it does NOT merge, push or deploy anything — do that yourself if it is wanted. ' +
        '"request_changes" sends the task back to the executor with your notes as the next fix round; ' +
        "after 2 fix rounds the task becomes RETURNED (FIX_ROUNDS_EXHAUSTED) and comes back to you instead. " +
        "Notes should say precisely what to fix.",
      inputSchema: {
        taskId,
        decision: z.enum(["approve", "request_changes"]),
        notes: z.string().optional().describe("Review notes; expected with request_changes."),
        by: z.string().describe('Who gives the verdict, e.g. "codex".'),
      },
    },
    (args) =>
      guard(() => {
        const verdict = { decision: args.decision, by: args.by, ...(args.notes !== undefined ? { notes: args.notes } : {}) };
        return { task: toPublicTask(submitVerdict(store, args.taskId, verdict), { compact: true }) };
      }),
  );

  server.registerTool(
    "list_agent_tasks",
    {
      description:
        "List recent tasks, newest first, as compact rows (id, projectId, title, status, round, updatedAt, progress). Use get_agent_task for details.",
      inputSchema: {
        projectId: z.string().optional(),
        status: z.enum(TASK_STATUSES).optional(),
        coordinatorId: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional().describe(`Maximum rows (default ${DEFAULT_LIST_LIMIT}).`),
      },
    },
    (args) =>
      guard(() => ({
        tasks: listTasks(store, {
          projectId: args.projectId,
          status: args.status,
          coordinatorId: args.coordinatorId,
          limit: args.limit,
        }).map((task) => toListItem(task)),
      })),
  );

  server.registerTool(
    "list_projects",
    {
      description: "List registered projects (id, name, path, aliases). Tasks can only be submitted to these.",
      inputSchema: {},
    },
    () => guard(() => ({ projects: store.listProjects() })),
  );

  return server;
}

async function main(): Promise<void> {
  const store = openStore();
  const server = createServer(store);
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void server
      .close()
      .catch(() => undefined)
      .finally(() => {
        store.close();
        process.exit(0);
      });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // Клиент закрыл канал — сервер больше не нужен.
  process.stdin.on("close", stop);
  await server.connect(new StdioServerTransport());
  console.error("[viewer-agents] MCP-сервер запущен (stdio)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error("[viewer-agents] Ошибка запуска:", toServiceError(error).message);
    process.exit(1);
  });
}
