#!/usr/bin/env node
/**
 * Fail if the effective vitest/vite test.exclude sets (Web UI node:test
 * files) and the Web Regression node --test set are not identical.
 *
 * Loads ui/vite.config.js and vitest.config.js and reads config.test.exclude.
 * A direct edit to either exclude list (add or remove) must fail this check.
 *
 *   node scripts/check-web-node-test-scan.mjs
 *   node scripts/check-web-node-test-scan.mjs --print
 */
import { register } from "node:module";
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  REPO_ROOT,
  SKIP_DIRS,
  TEST_FILE_RE,
  UI_DIR,
  listWebUiNodeTestFiles,
  normalizeScanPath,
} from "./lib/web-node-test-files.mjs";

const BASELINE_SKIP = new Set([
  "**/node_modules/**",
  "node_modules/**",
  "**/dist/**",
  "dist/**",
  "**/e2e/**",
  "e2e/**",
]);

function parseArgs(argv) {
  let printOnly = false;
  for (const arg of argv) {
    if (arg === "--print") {
      printOnly = true;
      continue;
    }
    console.error(`check-web-node-test-scan: unknown argument ${arg}`);
    process.exit(2);
  }
  return { printOnly };
}

function sortedUnique(files) {
  return [...new Set(files.map(normalizeScanPath))].sort();
}

function toUiRelative(file, configRoot) {
  const abs = resolve(configRoot, file);
  const rel = relative(UI_DIR, abs).replaceAll("\\", "/");
  if (rel.startsWith("..")) return null;
  return rel;
}

function listUiTestFiles() {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!TEST_FILE_RE.test(entry.name)) continue;
      found.push(relative(UI_DIR, full).replaceAll("\\", "/"));
    }
  };
  walk(UI_DIR);
  return found;
}

function resolveExcludeToUiTestFiles(exclude, configRoot, picomatch) {
  if (!Array.isArray(exclude)) {
    throw new Error("config.test.exclude is missing or not an array");
  }
  const out = new Set();
  const uiTests = listUiTestFiles();
  for (const raw of exclude) {
    const pattern = normalizeScanPath(raw);
    if (BASELINE_SKIP.has(pattern)) continue;
    const relToConfig = (file) => normalizeScanPath(relative(configRoot, resolve(UI_DIR, file)));
    if (picomatch.scan(pattern).isGlob) {
      const isMatch = picomatch(pattern, { dot: true });
      for (const file of uiTests) {
        if (isMatch(relToConfig(file))) out.add(file);
      }
      continue;
    }
    const uiRel = toUiRelative(pattern, configRoot);
    if (uiRel && TEST_FILE_RE.test(uiRel.split("/").pop() ?? "")) out.add(uiRel);
  }
  return sortedUnique([...out]);
}

async function loadPicomatch() {
  const { formatResolveError } = await import("./lib/resolve-from-ui.mjs");
  try {
    const mod = await import("picomatch");
    const picomatch = mod.default ?? mod;
    if (typeof picomatch !== "function" || typeof picomatch.scan !== "function") {
      throw new Error("picomatch export is missing scan()");
    }
    return picomatch;
  } catch (err) {
    console.error(
      `check-web-node-test-scan: cannot import 'picomatch'. Install with: pnpm install --frozen-lockfile (root devDependency picomatch). ${formatResolveError(err)}`,
    );
    process.exit(1);
  }
}

async function loadEffectiveConfig(configFile) {
  const mod = await import(pathToFileURL(configFile).href);
  const raw = mod.default;
  if (typeof raw === "function") {
    return raw({ command: "serve", mode: "test" });
  }
  return raw;
}

async function loadUiViteConfig(resolveUiPackage) {
  const vite = await import(pathToFileURL(resolveUiPackage("vite")).href);
  const loaded = await vite.loadConfigFromFile(
    { command: "serve", mode: "test" },
    resolve(UI_DIR, "vite.config.js"),
    UI_DIR,
  );
  if (!loaded?.config) {
    throw new Error("failed to load ui/vite.config.js");
  }
  return loaded.config;
}

function printSet(title, files) {
  console.log(`${title} (${files.length}):`);
  for (const file of files) console.log(`  ${file}`);
}

function reportMismatch(label, left, right) {
  const onlyLeft = left.filter((file) => !right.includes(file));
  const onlyRight = right.filter((file) => !left.includes(file));
  if (!onlyLeft.length && !onlyRight.length) return false;
  if (onlyLeft.length) {
    console.error(`${label}: extra vs node --test:`);
    for (const file of onlyLeft) console.error(`  ${file}`);
  }
  if (onlyRight.length) {
    console.error(`${label}: missing vs node --test:`);
    for (const file of onlyRight) console.error(`  ${file}`);
  }
  return true;
}

const { printOnly } = parseArgs(process.argv.slice(2));
const nodeTestSet = sortedUnique(listWebUiNodeTestFiles());

if (printOnly) {
  process.stdout.write(`${nodeTestSet.join("\n")}\n`);
  process.exit(0);
}

register(new URL("./lib/resolve-from-ui.mjs", import.meta.url));
const { resolveUiPackage } = await import("./lib/resolve-from-ui.mjs");
const picomatch = await loadPicomatch();
resolveUiPackage("vitest");
const uiConfig = await loadUiViteConfig(resolveUiPackage);
const rootConfig = await loadEffectiveConfig(resolve(REPO_ROOT, "vitest.config.js"));
if (!uiConfig.test?.exclude || !rootConfig.test?.exclude) {
  console.error("check-web-node-test-scan: config.test.exclude missing after load");
  process.exit(1);
}

const uiExclude = resolveExcludeToUiTestFiles(uiConfig.test.exclude, UI_DIR, picomatch);
const rootExclude = resolveExcludeToUiTestFiles(rootConfig.test.exclude, REPO_ROOT, picomatch);

printSet("ui/vite.config.js test.exclude (ui test files)", uiExclude);
printSet("vitest.config.js test.exclude (ui test files)", rootExclude);
printSet("node --test set", nodeTestSet);

let failed = false;
failed = reportMismatch("ui/vite.config.js", uiExclude, nodeTestSet) || failed;
failed = reportMismatch("vitest.config.js", rootExclude, nodeTestSet) || failed;

if (failed) process.exit(1);

console.log(`ok: ${nodeTestSet.length} files; both effective excludes == node --test set`);
