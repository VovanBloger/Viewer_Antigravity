import assert from "node:assert/strict";
import test from "node:test";

import { redactDeep, redactSecrets } from "./redact.ts";

const R = "[REDACTED]";
// Значения собраны из частей, чтобы сканеры секретов не срабатывали на фикстуры.
const BOT_TOKEN = `1234567890:${"AAH"}${"k9_xZ-abcdefghijklmnopqrstuvwxyz012"}`;
const HEX64 = "a1b2c3d4".repeat(8);

test("токен бота Telegram", () => {
  const out = redactSecrets(`запусти с ${BOT_TOKEN} и проверь`);
  assert.equal(out, `запусти с ${R} и проверь`);
});

test("initData Telegram WebApp: строка запроса целиком и отдельный hash", () => {
  const initData = `query_id=AAF1&user=%7B%22id%22%3A42%7D&auth_date=1700000000&hash=${HEX64}`;
  const out = redactSecrets(`initData: ${initData} конец`);
  assert.equal(out, `initData: ${R} конец`);
  assert.equal(redactSecrets(`auth_date=1700000000&signature=${"Zm9v".repeat(12)}`), R);
  assert.equal(redactSecrets(`передан hash=${HEX64}`), `передан hash=${R}`);
  // auth_date без подписи секретом не является
  assert.equal(redactSecrets("auth_date=1700000000"), "auth_date=1700000000");
});

test("Bearer, ключи API и токены GitHub", () => {
  assert.equal(redactSecrets(`Authorization: Bearer ${"abc.DEF-123_".repeat(3)}`), `Authorization: Bearer ${R}`);
  assert.equal(redactSecrets(`ключ ${"sk-"}${"proj-" + "A1b2C3d4".repeat(5)}.`), `ключ ${R}.`);
  assert.equal(redactSecrets(`${"sk-ant-"}${"api03-" + "x".repeat(40)}`), R);
  assert.equal(redactSecrets(`${"AIza"}${"SyD-".padEnd(35, "q")}`), R);
  assert.equal(redactSecrets(`${"ghp_"}${"A1b2C3d4E5".repeat(4)}`), R);
  assert.equal(redactSecrets(`${"gho_"}${"A1b2C3d4E5".repeat(4)}`), R);
  assert.equal(redactSecrets(`${"github_pat_"}${"11ABCDEFG0_".repeat(4)}`), R);
});

test("присваивания: имя ключа сохраняется, значение скрывается", () => {
  assert.equal(redactSecrets("BOT_TOKEN=qwerty123"), `BOT_TOKEN=${R}`);
  assert.equal(redactSecrets('OPENAI_API_KEY = "abc def"'), `OPENAI_API_KEY = ${R}`);
  assert.equal(redactSecrets("export SECRET='x y'; echo ok"), `export SECRET=${R}; echo ok`);
  assert.equal(redactSecrets("DB_PASSWORD=p@ss\nNEXT=1"), `DB_PASSWORD=${R}\nNEXT=1`);
  assert.equal(redactSecrets("https://x.test/a?token=abc123&page=2"), `https://x.test/a?token=${R}&page=2`);
  assert.equal(redactSecrets("api_key=zzz"), `api_key=${R}`);
  // повторное применение ничего не меняет
  assert.equal(redactSecrets(`BOT_TOKEN=${R}`), `BOT_TOKEN=${R}`);
});

test("заголовки Cookie и Set-Cookie", () => {
  assert.equal(redactSecrets("Cookie: sid=abc; theme=dark\nHost: x"), `Cookie: ${R}\nHost: x`);
  assert.equal(redactSecrets("set-cookie: sid=abc; HttpOnly"), `set-cookie: ${R}`);
});

test("обычный текст, SHA, пути и id заданий не портятся", () => {
  const samples = [
    "Исправь вёрстку шапки и запусти npm run build",
    "commit f417417a0c3b9d2e5f6a7b8c9d0e1f2a3b4c5d6e",
    "ревизия 44fa865",
    "C:\\Users\\vovan\\Desktop\\Viewer Antigravity\\runtime\\queue\\store.ts",
    "runtime/queue/types.ts:42",
    "T-000123 и CMD-071",
    "http://localhost:3000/api/tasks?projectId=viewer&limit=10",
    "max_tokens=4096, MAX_TOKENS=100",
    "const token = getToken();",
    "if (password === expected) return;",
    "время 12:30:45, порт 127.0.0.1:8080",
    "Bearer-токен нужно передать в заголовке",
    "2026-11-11T10:00:00.000Z",
    "sha256 a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4",
  ];
  for (const sample of samples) assert.equal(redactSecrets(sample), sample);
});

test("redactDeep обходит объекты и массивы и не меняет исходник", () => {
  const source = {
    title: "ok",
    n: 5,
    flag: true,
    nothing: null,
    list: ["BOT_TOKEN=abc", { deep: `Bearer ${"z".repeat(24)}` }],
  };
  const out = redactDeep(source);
  assert.deepEqual(out, {
    title: "ok",
    n: 5,
    flag: true,
    nothing: null,
    list: [`BOT_TOKEN=${R}`, { deep: `Bearer ${R}` }],
  });
  assert.equal(source.list[0], "BOT_TOKEN=abc");
  assert.notEqual(out.list, source.list);
});
