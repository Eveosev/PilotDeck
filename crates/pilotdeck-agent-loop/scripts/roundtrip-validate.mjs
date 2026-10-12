#!/usr/bin/env node
/**
 * Validate Rust-emitted Module Protocol messages with:
 *   1. T-P0a-01 schema (ajv 8, draft 2020-12, strict:true)
 *   2. TS validateModuleMessage
 *
 * Usage:
 *   node --experimental-strip-types scripts/roundtrip-validate.mjs --messages path.json
 * Input file: { "messages": [ { "id"?: string, "message": object }, ... ] }
 *            or a raw JSON array of messages.
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
  if (Array.isArray(parsed.messages)) {
    return parsed.messages.map((entry, index) => {
      if (entry && typeof entry === "object" && "message" in entry) {
        return { id: entry.id ?? `msg-${index}`, message: entry.message, source: entry.source };
      }
      return { id: `msg-${index}`, message: entry };
    });
  }
  throw new Error("messages file must be an array or { messages: [...] }");
}

function messageType(message) {
  if (!message || typeof message !== "object") return "invalid";
  if (message.kind === "request") return `request/${message.method ?? "unknown"}`;
  return String(message.kind ?? "unknown");
}

const messagesArg = process.argv.find((arg, index, all) => all[index - 1] === "--messages");
if (!messagesArg) {
  console.error("usage: roundtrip-validate.mjs --messages <file.json>");
  process.exit(2);
}

const entries = loadMessages(resolve(messagesArg));
const results = [];
const byType = new Map();
let mismatch = 0;
let tsAccept = 0;
let schemaAccept = 0;

for (const entry of entries) {
  const tsOk = validateModuleMessage(entry.message).ok === true;
  const schemaOk = schemaAccepts(schemaValidate, entry.message);
  const match = tsOk === schemaOk;
  if (!match) mismatch += 1;
  if (tsOk) tsAccept += 1;
  if (schemaOk) schemaAccept += 1;
  const type = messageType(entry.message);
  const list = byType.get(type) ?? [];
  list.push(entry.id);
  byType.set(type, list);
  results.push({
    id: entry.id,
    type,
    ts: decisionOf(tsOk),
    schema: decisionOf(schemaOk),
    match,
    tsOk,
    schemaOk,
    source: entry.source,
  });
}

const report = {
  schema: SCHEMA_PATH,
  typescriptFunction: "validateModuleMessage",
  ajvStrict: true,
  total: entries.length,
  mismatch,
  tsAccept,
  schemaAccept,
  byType: Object.fromEntries([...byType.entries()].map(([type, ids]) => [type, ids.length])),
  results,
};

console.log(JSON.stringify(report, null, 2));
process.exit(mismatch === 0 && entries.length > 0 ? 0 : 1);
