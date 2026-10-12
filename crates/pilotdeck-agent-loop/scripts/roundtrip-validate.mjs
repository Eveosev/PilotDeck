#!/usr/bin/env node
/**
 * Cross-check Module Protocol messages with:
 *   1. T-P0a-01 schema (ajv 8, draft 2020-12, strict:true)
 *   2. TS validateModuleMessage
 *   3. Optional Rust validate_module_message decisions (--rust-decisions)
 *
 * Usage:
 *   node scripts/roundtrip-validate.mjs --messages path.json [--expect reject] [--rust-decisions rust.json]
 * Input file: { "messages": [...] } | { "samples": [{ id, raw|message }] } | raw array
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.execArgv.some((flag) => flag.includes("strip-types"))) {
  const replayed = spawnSync(
    process.execPath,
    ["--experimental-strip-types", ...process.argv.slice(1)],
    { stdio: "inherit" },
  );
  process.exit(replayed.status ?? 1);
}

const here = dirname(fileURLToPath(import.meta.url));
const crateRoot = resolve(here, "..");
const repoRoot = resolve(crateRoot, "..", "..");

const { compileSchema, schemaAccepts, decisionOf, SCHEMA_PATH, PROTOCOL_PATH } = await import(
  pathToFileURL(resolve(repoRoot, "scripts/lib/module-protocol-schema.mjs")).href
);

const { validateModuleMessage } = await import(pathToFileURL(PROTOCOL_PATH).href);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const schemaValidate = compileSchema(schema);

function loadMessages(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(parsed)) {
    return parsed.map((message, index) => ({ id: `msg-${index}`, message }));
  }
  const rows = parsed.samples ?? parsed.messages;
  if (Array.isArray(rows)) {
    return rows.map((entry, index) => {
      if (entry && typeof entry === "object" && "raw" in entry && !("message" in entry)) {
        return {
          id: entry.id ?? `msg-${index}`,
          message: JSON.parse(entry.raw),
          source: entry.source,
          messageType: entry.messageType,
        };
      }
      if (entry && typeof entry === "object" && "message" in entry) {
        return { id: entry.id ?? `msg-${index}`, message: entry.message, source: entry.source };
      }
      return { id: `msg-${index}`, message: entry };
    });
  }
  throw new Error("messages file must be an array or { messages|samples: [...] }");
}

function loadRustDecisions(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const rows = parsed.decisions ?? parsed.results ?? parsed;
  if (!Array.isArray(rows)) {
    throw new Error("rust decisions must be { decisions: [{ id, ok }] }");
  }
  const map = new Map();
  for (const row of rows) {
    map.set(row.id, { ok: row.ok === true, code: row.code ?? null });
  }
  return map;
}

function messageType(message) {
  if (!message || typeof message !== "object") return "invalid";
  if (message.kind === "request") return `request/${message.method ?? "unknown"}`;
  return String(message.kind ?? "unknown");
}

const messagesArg = process.argv.find((arg, index, all) => all[index - 1] === "--messages");
const rustArg = process.argv.find((arg, index, all) => all[index - 1] === "--rust-decisions");
const expectReject = process.argv.includes("--expect")
  ? process.argv[process.argv.indexOf("--expect") + 1] === "reject"
  : process.argv.includes("--expect-reject");
if (!messagesArg) {
  console.error("usage: roundtrip-validate.mjs --messages <file.json> [--expect reject] [--rust-decisions rust.json]");
  process.exit(2);
}

const entries = loadMessages(resolve(messagesArg));
const rustDecisions = rustArg ? loadRustDecisions(resolve(rustArg)) : null;
const results = [];
const byType = new Map();
let mismatch = 0;
let tsAccept = 0;
let schemaAccept = 0;
let rustAccept = 0;
let expectViolations = 0;

for (const entry of entries) {
  const tsOk = validateModuleMessage(entry.message).ok === true;
  const schemaOk = schemaAccepts(schemaValidate, entry.message);
  const rust = rustDecisions?.get(entry.id);
  if (rustDecisions && rust === undefined) {
    throw new Error(`rust decisions missing id ${entry.id}`);
  }
  const rustOk = rust ? rust.ok : undefined;
  const pairMatch = tsOk === schemaOk;
  const tripleMatch = rustOk === undefined ? pairMatch : pairMatch && rustOk === tsOk;
  if (!tripleMatch) mismatch += 1;
  if (tsOk) tsAccept += 1;
  if (schemaOk) schemaAccept += 1;
  if (rustOk === true) rustAccept += 1;
  if (expectReject && (tsOk || schemaOk || rustOk === true)) expectViolations += 1;
  const type = entry.messageType ?? messageType(entry.message);
  const list = byType.get(type) ?? [];
  list.push(entry.id);
  byType.set(type, list);
  results.push({
    id: entry.id,
    type,
    ts: decisionOf(tsOk),
    schema: decisionOf(schemaOk),
    ...(rustOk === undefined ? {} : { rust: decisionOf(rustOk), rustCode: rust.code }),
    match: tripleMatch,
    tsOk,
    schemaOk,
    ...(rustOk === undefined ? {} : { rustOk }),
    source: entry.source,
  });
}

const report = {
  schema: SCHEMA_PATH,
  typescriptFunction: "validateModuleMessage",
  rustFunction: rustDecisions ? "validate_module_message" : null,
  ajvStrict: true,
  expect: expectReject ? "reject" : "agree",
  total: entries.length,
  mismatch,
  expectViolations,
  tsAccept,
  schemaAccept,
  ...(rustDecisions ? { rustAccept, tsReject: entries.length - tsAccept, schemaReject: entries.length - schemaAccept, rustReject: entries.length - rustAccept } : {}),
  byType: Object.fromEntries([...byType.entries()].map(([type, ids]) => [type, ids.length])),
  results,
};

console.log(JSON.stringify(report, null, 2));
const ok = mismatch === 0 && expectViolations === 0 && entries.length > 0;
process.exit(ok ? 0 : 1);
