import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from './devbot.ts';

test('legacy handover uses exact project, deduplicates and completes locally', () => {
  const commands: { id: string; projectId: string; author: string; text: string; status: string; result?: string }[] = [];
  const adapter = createAdapter({
    getState: () => ({ commands }),
    enqueueCommand(input) { const command = { ...input, id: 'CMD-1', status: 'QUEUED' }; commands.push(command); return { command, requiresConfirmation: false }; },
    completeCommand(id, result) { const command = commands.find(c => c.id === id)!; command.status = 'COMPLETED'; command.result = result; return command; },
  }, ['crm']);
  assert.throws(() => adapter.enqueue('cr', 'a', 1, 'hello'), /UNKNOWN_PROJECT/);
  assert.equal(commands.length, 0);
  assert.equal(adapter.enqueue('crm', 'a', 1, 'hello').id, 'CMD-1');
  adapter.enqueue('crm', 'a', 1, 'hello');
  assert.equal(commands.length, 1);
  assert.equal(adapter.completeLocal('CMD-1', 'ready').notificationsSent, false);
  assert.equal(adapter.get('CMD-1').status, 'COMPLETED');
  adapter.completeLocal('CMD-1', 'again');
  assert.match(commands[0].result!, /ready/);
});
