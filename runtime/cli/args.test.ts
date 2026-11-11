import assert from "node:assert/strict";
import test from "node:test";

import {
  ArgError,
  assertKnownOptions,
  fileRef,
  optFlag,
  optList,
  optNumber,
  optString,
  parseArgs,
  quoteArg,
  requireString,
  stripBom,
} from "./args.ts";

test("parseArgs: позиционные аргументы, опции со значением и флаги", () => {
  const args = parseArgs(["verdict", "T-000001", "approve", "--by=codex", "--notes=a=b c", "--full"]);
  assert.deepEqual(args.positionals, ["verdict", "T-000001", "approve"]);
  assert.deepEqual(args.options, { by: "codex", notes: "a=b c", full: true });
});

test("parseArgs: после -- всё позиционное; одиночный дефис — не опция", () => {
  const args = parseArgs(["fail", "T-1", "--owner=x", "--", "--не опция", "-v"]);
  assert.deepEqual(args.positionals, ["fail", "T-1", "--не опция", "-v"]);
  assert.deepEqual(args.options, { owner: "x" });
});

test("parseArgs: повтор опции и пустое имя — ошибка", () => {
  assert.throws(() => parseArgs(["--by=a", "--by=b"]), ArgError);
  assert.throws(() => parseArgs(["--=x"]), ArgError);
});

test("assertKnownOptions ловит опечатки", () => {
  const args = parseArgs(["list", "--projct=viewer"]);
  assert.throws(() => assertKnownOptions(args, ["project", "status"]), /--projct/);
  assert.doesNotThrow(() => assertKnownOptions(parseArgs(["list", "--project=viewer"]), ["project"]));
});

test("optString / requireString / optFlag", () => {
  const args = parseArgs(["--owner=me", "--empty=", "--full", "--off=false"]);
  assert.equal(optString(args, "owner"), "me");
  assert.equal(optString(args, "missing"), undefined);
  assert.throws(() => optString(args, "empty"), ArgError);
  assert.throws(() => optString(args, "full"), ArgError);
  assert.equal(requireString(args, "owner"), "me");
  assert.throws(() => requireString(args, "missing"), /--missing/);
  assert.equal(optFlag(args, "full"), true);
  assert.equal(optFlag(args, "off"), false);
  assert.equal(optFlag(args, "missing"), false);
  assert.throws(() => optFlag(args, "owner"), ArgError);
});

test("optNumber проверяет границы и целочисленность", () => {
  const args = parseArgs(["--limit=20", "--timeout-min=0.01", "--bad=abc", "--neg=-1"]);
  assert.equal(optNumber(args, "limit", { min: 1, integer: true }), 20);
  assert.equal(optNumber(args, "timeout-min", { min: 0 }), 0.01);
  assert.equal(optNumber(args, "missing"), undefined);
  assert.throws(() => optNumber(args, "timeout-min", { integer: true }), ArgError);
  assert.throws(() => optNumber(args, "bad"), ArgError);
  assert.throws(() => optNumber(args, "neg", { min: 0 }), ArgError);
  assert.throws(() => optNumber(args, "limit", { max: 10 }), ArgError);
});

test("optList, stripBom, fileRef, quoteArg", () => {
  assert.deepEqual(optList(parseArgs(["--alias=va, Вьювер,,x"]), "alias"), ["va", "Вьювер", "x"]);
  assert.equal(optList(parseArgs([]), "alias"), undefined);
  assert.equal(stripBom("\uFEFF{}"), "{}");
  assert.equal(stripBom("{}"), "{}");
  assert.equal(fileRef("@report.json"), "report.json");
  assert.equal(fileRef("просто текст"), undefined);
  assert.equal(fileRef("@"), undefined);
  assert.equal(quoteArg("antigravity-PC-ab12cd"), "antigravity-PC-ab12cd");
  assert.equal(quoteArg("C:/a b/q.db"), '"C:/a b/q.db"');
  assert.equal(quoteArg("@C:/tmp/report-T-000001.json"), '"@C:/tmp/report-T-000001.json"');
});
