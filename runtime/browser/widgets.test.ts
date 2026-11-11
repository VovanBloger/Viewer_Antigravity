import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetPayload, buildWidgetSandboxHtml, MAX_RAW_WIDGET_BYTES, MAX_DEFLATED_WIDGET_BYTES } from './widgets.ts';
import { COUNTER_WIDGET_HTML } from '../pilots/counter.ts';

test('validateWidgetPayload validates sizes, limits and remote scripts', () => {
  // Valid Counter Widget from pilot
  const counterVal = validateWidgetPayload(COUNTER_WIDGET_HTML);
  assert.equal(counterVal.ok, true);
  assert.ok(counterVal.rawBytes > 0 && counterVal.rawBytes < 1000);
  assert.ok(counterVal.deflatedBytes > 0 && counterVal.deflatedBytes < 500);

  // Empty widget rejected
  const emptyVal = validateWidgetPayload('');
  assert.equal(emptyVal.ok, false);
  assert.ok(emptyVal.errors.includes('WIDGET_EMPTY'));

  // Remote script rejected
  const remoteVal = validateWidgetPayload('<html><body><script src="https://evil.com/leak.js"></script></body></html>');
  assert.equal(remoteVal.ok, false);
  assert.ok(remoteVal.errors.includes('REMOTE_SCRIPTS_FORBIDDEN_IN_WIDGET'));

  // Exceeds raw limit
  const hugeHtml = `<html><body>${'a'.repeat(MAX_RAW_WIDGET_BYTES + 10)}</body></html>`;
  const hugeVal = validateWidgetPayload(hugeHtml);
  assert.equal(hugeVal.ok, false);
  assert.ok(hugeVal.errors.some(e => e.startsWith('WIDGET_EXCEEDS_RAW_LIMIT')));
});

test('buildWidgetSandboxHtml injects TelegramWidget bridge and theme', () => {
  const sandbox = buildWidgetSandboxHtml(COUNTER_WIDGET_HTML, {
    chatData: '{"count":42}',
    theme: 'dark'
  });

  assert.ok(sandbox.includes('<!doctype html>'));
  assert.ok(sandbox.includes('window.TelegramWidget ='));
  assert.ok(sandbox.includes('color-scheme: dark'));
  assert.ok(sandbox.includes('chatDataChanged'));
  assert.ok(sandbox.includes('themeChanged'));
  assert.ok(sandbox.includes('id="count"'));

  // Throws if widget payload is invalid
  assert.throws(() => {
    buildWidgetSandboxHtml('<script src="https://bad.com"></script>');
  }, /INVALID_WIDGET_PAYLOAD/);
});
