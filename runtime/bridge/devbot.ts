/** One-time handover from an ALREADY ARMED Dev Bot conversation. No model/API calls. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { redactDeep } from '../queue/redact.ts';

interface Command {
  id: string; projectId: string; author: string; text: string; status: string;
  result?: string; error?: string;
}
interface LegacyQueue {
  getState(): { commands: Command[] };
  enqueueCommand(input: { chatId: number; author: string; text: string; projectId: string }):
    { command: Command; requiresConfirmation: boolean };
  completeCommand(id: string, result: string): Command | null;
}

export function createAdapter(queue: LegacyQueue, projectIds: string[]) {
  return {
    enqueue(projectId: string, key: string, chatId: number, text: string) {
      if (!projectIds.includes(projectId)) throw new Error(`UNKNOWN_PROJECT: ${projectId}`);
      if (!key || !Number.isSafeInteger(chatId)) throw new Error('Invalid connection key or chat ID');
      const marker = `[Viewer2:${key}]`;
      const existing = queue.getState().commands.find(c =>
        c.projectId === projectId && c.author === 'Codex' && c.text.startsWith(`${marker}\n`));
      const result = existing ? { command: existing, requiresConfirmation: existing.status === 'PENDING_CONFIRMATION' }
        : queue.enqueueCommand({ projectId, author: 'Codex', chatId, text: `${marker}\n${text}` });
      return { id: result.command.id, projectId: result.command.projectId,
        status: result.command.status, requiresConfirmation: result.requiresConfirmation };
    },
    get(id: string) {
      const command = queue.getState().commands.find(c => c.id === id);
      if (!command) throw new Error('NOT_FOUND');
      return redactDeep({ id, projectId: command.projectId, status: command.status,
        result: command.result, error: command.error });
    },
    completeLocal(id: string, result: string) {
      const command = queue.getState().commands.find(c => c.id === id);
      if (!command || command.author !== 'Codex' || !command.text.startsWith('[Viewer2:'))
        throw new Error('Not a Viewer2 handover command');
      if (!['QUEUED', 'IN_PROGRESS', 'COMPLETED'].includes(command.status))
        throw new Error(`INVALID_STATE: ${command.status}`);
      if (command.status !== 'COMPLETED') queue.completeCommand(id, JSON.stringify(redactDeep({ summary: result })));
      return { id, status: 'COMPLETED', notificationsSent: false };
    },
  };
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    source: { type: 'string' }, project: { type: 'string' }, key: { type: 'string' },
    'chat-id': { type: 'string' }, file: { type: 'string' }, id: { type: 'string' },
  } });
  if (!values.source) throw new Error('--source must name the existing Antigravity Dev Bot root');
  const root = fs.realpathSync(values.source);
  // Read only canonical IDs. Never rely on the legacy fuzzy project lookup/fallback.
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config/projects.config.json'), 'utf8'));
  const legacy = await import(pathToFileURL(path.join(root, 'src/core/queue.ts')).href);
  const queue = legacy.QueueService ?? legacy.default?.QueueService;
  if (!queue) throw new Error('Legacy QueueService is unavailable');
  const adapter = createAdapter(queue, config.projects.map((p: { id: string }) => p.id));
  let result;
  switch (positionals[0]) {
    case 'enqueue':
      if (!values.project || !values.key || !values.file || !values['chat-id']) throw new Error('Missing enqueue arguments');
      result = adapter.enqueue(values.project, values.key, Number(values['chat-id']), fs.readFileSync(values.file, 'utf8'));
      break;
    case 'get':
      if (!values.id) throw new Error('Missing --id');
      result = adapter.get(values.id); break;
    case 'complete-local':
      if (!values.id || !values.file) throw new Error('Missing --id or --file');
      result = adapter.completeLocal(values.id, fs.readFileSync(values.file, 'utf8')); break;
    default: throw new Error('Use enqueue|get|complete-local');
  }
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(redactDeep(String(error))); process.exitCode = 1; });
