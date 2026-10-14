#!/usr/bin/env node
/**
 * S3 oracle: JSON.parse + validateModuleMessage (+ optional ajv strict).
 * Usage: node serde-ts-oracle.mjs --raw '<json text>'
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
const repoRoot = resolve(here, "..", "..", "..");
const { compileSchema, schemaAccepts, SCHEMA_PATH, PROTOCOL_PATH } = await import(
  pathToFileURL(resolve(repoRoot, "scripts/lib/module-protocol-schema.mjs")).href
);
const { validateModuleMessage } = await import(pathToFileURL(PROTOCOL_PATH).href);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const schemaValidate = compileSchema(schema);

const rawArg = process.argv.find((arg, index, all) => all[index - 1] === "--raw");
if (!rawArg) {
  console.error("usage: serde-ts-oracle.mjs --raw '<json text>'");
  process.exit(2);
}

let parsed;
let parseOk = true;
let parseError = null;
try {
  parsed = JSON.parse(rawArg);
} catch (error) {
  parseOk = false;
  parseError = String(error?.message ?? error);
}

const numberMeta = describeNumber(rawArg, parsed);
const ts = parseOk ? validateModuleMessage(parsed) : { ok: false, code: "INVALID_JSON", message: parseError };
const schemaOk = parseOk ? schemaAccepts(schemaValidate, parsed) : false;

const report = {
  raw: rawArg,
  parseOk,
  parseError,
  jsAfterJSONParse: parseOk ? summarizeJs(parsed) : null,
  ...numberMeta,
  tsOk: ts.ok === true,
  tsCode: ts.ok === true ? null : (ts.code ?? null),
  schemaOk,
  ajvStrict: true,
  schema: SCHEMA_PATH,
  typescriptFunction: "validateModuleMessage",
};

console.log(JSON.stringify(report, null, 2));
process.exit(0);

function summarizeJs(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (item === Infinity) return { $special: "Infinity" };
    if (item === -Infinity) return { $special: "-Infinity" };
    if (typeof item === "number" && Number.isNaN(item)) return { $special: "NaN" };
    return item;
  }));
}

function describeNumber(raw, parsed) {
  const match = raw.match(/"sequence"\s*:\s*([^,}\s]+)/)
    || raw.match(/"lastAppliedSequence"\s*:\s*([^,}\s]+)/);
  if (!match) {
    return { rawNumberToken: null };
  }
  const token = match[1];
  let jsNumber = null;
  let objectIsNegativeZero = false;
  let isInteger = false;
  if (parsed && typeof parsed === "object") {
    const number = parsed.sequence ?? parsed.lastAppliedSequence;
    if (typeof number === "number") {
      jsNumber = Number.isFinite(number) ? number : String(number);
      objectIsNegativeZero = Object.is(number, -0);
      isInteger = Number.isInteger(number);
    }
  }
  return { rawNumberToken: token, jsAfterNumberParse: jsNumber, objectIsNegativeZero, isInteger };
}
