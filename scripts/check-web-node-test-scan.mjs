#!/usr/bin/env node
/**
 * Fail if the vitest node:test exclude set and the Web Regression
 * node --test set are not identical. Also refuse vitest files in the
 * node --test set (no node:test import).
 *
 *   node scripts/check-web-node-test-scan.mjs
 *   node scripts/check-web-node-test-scan.mjs --print
 *   node scripts/check-web-node-test-scan.mjs --extra-exclude server/extra.test.js
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  NODE_TEST_IMPORT_RE,
  UI_DIR,
  listWebUiNodeTestFiles,
  normalizeScanPath,
} from "./lib/web-node-test-files.mjs";

function parseArgs(argv) {
  const extraExclude = [];
  let printOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--print") {
      printOnly = true;
      continue;
    }
    if (arg === "--extra-exclude") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        console.error("check-web-node-test-scan: --extra-exclude needs a path");
        process.exit(2);
      }
      extraExclude.push(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--extra-exclude=")) {
      extraExclude.push(arg.slice("--extra-exclude=".length));
      continue;
    }
    console.error(`check-web-node-test-scan: unknown argument ${arg}`);
    process.exit(2);
  }
  return { extraExclude, printOnly };
}

function sortedUnique(files) {
  return [...new Set(files.map(normalizeScanPath))].sort();
}

function fileHasNodeTestImport(relPath) {
  try {
    const src = readFileSync(resolve(UI_DIR, relPath), "utf8");
    return NODE_TEST_IMPORT_RE.test(src);
  } catch {
    return false;
  }
}

const { extraExclude, printOnly } = parseArgs(process.argv.slice(2));
const nodeTestSet = sortedUnique(listWebUiNodeTestFiles());
const vitestExclude = sortedUnique([...nodeTestSet, ...extraExclude]);

if (printOnly) {
  if (extraExclude.length > 0) {
    console.error("check-web-node-test-scan: --print cannot be combined with --extra-exclude");
    process.exit(2);
  }
  process.stdout.write(`${nodeTestSet.join("\n")}\n`);
  process.exit(0);
}

const vitestOnly = vitestExclude.filter((file) => !nodeTestSet.includes(file));
const nodeTestOnly = nodeTestSet.filter((file) => !vitestExclude.includes(file));
const vitestFilesInNodeTest = nodeTestSet.filter((file) => !fileHasNodeTestImport(file));

console.log("vitest exclude (node:test):");
for (const file of vitestExclude) console.log(`  ${file}`);
console.log("node --test set:");
for (const file of nodeTestSet) console.log(`  ${file}`);

if (vitestOnly.length || nodeTestOnly.length || vitestFilesInNodeTest.length) {
  if (vitestOnly.length) {
    console.error("in vitest exclude but not in node --test:");
    for (const file of vitestOnly) console.error(`  ${file}`);
  }
  if (nodeTestOnly.length) {
    console.error("in node --test but not in vitest exclude:");
    for (const file of nodeTestOnly) console.error(`  ${file}`);
  }
  if (vitestFilesInNodeTest.length) {
    console.error("node --test picked up vitest files (no node:test import):");
    for (const file of vitestFilesInNodeTest) console.error(`  ${file}`);
  }
  process.exit(1);
}

console.log(`ok: ${nodeTestSet.length} files; vitest exclude == node --test set`);
