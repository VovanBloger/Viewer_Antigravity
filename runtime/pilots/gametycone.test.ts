import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAdapter, bindAdapter } from './adapters.ts';
import type { Environment } from '../environments/manager.ts';

test('GameTycone fixture adapter loads and binds correctly, while template stays protected', () => {
  const fakeLookup = (id: string) => (id === 'game' || id === 'counter' ? { id } : undefined);

  // 1. Verify loadAdapter on adapters/gametycone.fixture.json
  const fixturePath = path.resolve('adapters/gametycone.fixture.json');
  const fixtureAdapter = loadAdapter(fixturePath, fakeLookup);

  assert.equal(fixtureAdapter.version, 1);
  assert.equal(fixtureAdapter.id, 'gametycone-fixture');
  assert.equal(fixtureAdapter.projectId, 'game');
  assert.equal(fixtureAdapter.network, 'test');
  assert.equal(fixtureAdapter.botId, 'game-test-bot');
  assert.equal(fixtureAdapter.mode, 'fixture');
  assert.ok(fixtureAdapter.command);
  assert.equal(fixtureAdapter.command.executable, '$NODE');
  assert.equal(fixtureAdapter.readinessPath, '/health');
  assert.equal(fixtureAdapter.blockedReasons, undefined);

  // 2. Verify bindAdapter with mock Environment
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer2-gametycone-test-'));
  try {
    const worktree = path.join(workspaceRoot, 'worktree');
    const dataDir = path.join(workspaceRoot, 'data');
    const databasePath = path.join(dataDir, 'game.db');
    fs.mkdirSync(worktree, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(databasePath, '');

    const mockEnv: Environment = {
      id: 'env-game-1',
      projectId: 'game',
      branch: 'pilot/game',
      worktree,
      network: 'test',
      botId: 'game-test-bot',
      port: 4200,
      dataDir,
      databasePath,
      status: 'created',
      actors: ['game-tester']
    };

    const bound = bindAdapter(fixtureAdapter, mockEnv, {
      workspaceRoot,
      nodeExecutable: process.execPath
    });

    assert.equal(bound.executable, process.execPath);
    assert.equal(bound.readinessUrl, 'http://127.0.0.1:4200/health');
    assert.deepEqual(bound.args, fixtureAdapter.command.args);

    // Verify PORT and environment placeholder substitution in command args
    const templatedCommandAdapter = {
      ...fixtureAdapter,
      command: {
        executable: '$NODE',
        args: [
          'server.js',
          '--port=${PORT}',
          '--worktree=${WORKTREE}',
          '--data=${DATA_DIR}',
          '--db=${DATABASE_PATH}',
          '--bot=${BOT_ID}',
          '--network=${NETWORK}'
        ]
      }
    };
    const boundTemplated = bindAdapter(templatedCommandAdapter, mockEnv, {
      workspaceRoot,
      nodeExecutable: process.execPath
    });
    assert.deepEqual(boundTemplated.args, [
      'server.js',
      '--port=4200',
      `--worktree=${worktree}`,
      `--data=${dataDir}`,
      `--db=${databasePath}`,
      '--bot=game-test-bot',
      '--network=test'
    ]);
    assert.equal(boundTemplated.readinessUrl, 'http://127.0.0.1:4200/health');

    // 3. Verify that adapters/gametycone.template.json throws ADAPTER_NOT_ISOLATED
    const templatePath = path.resolve('adapters/gametycone.template.json');
    const templateAdapter = loadAdapter(templatePath, fakeLookup);

    assert.equal(templateAdapter.id, 'gametycone');
    assert.equal(templateAdapter.mode, 'template');
    assert.ok(templateAdapter.blockedReasons && templateAdapter.blockedReasons.length > 0);

    assert.throws(() => {
      bindAdapter(templateAdapter, mockEnv, {
        workspaceRoot,
        nodeExecutable: process.execPath
      });
    }, /ADAPTER_NOT_ISOLATED/);

    // Environment mismatch protection
    const mismatchedEnv: Environment = {
      ...mockEnv,
      botId: 'other-bot'
    };
    assert.throws(() => {
      bindAdapter(fixtureAdapter, mismatchedEnv, {
        workspaceRoot,
        nodeExecutable: process.execPath
      });
    }, /ENVIRONMENT_ADAPTER_MISMATCH/);

  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
