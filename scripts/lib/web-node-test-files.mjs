/**
 * Shared scanner for Web UI files that import node:test.
 * Used by vitest exclude lists and by the Web Regression node --test step
 * so those two sets cannot drift independently.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const UI_DIR = resolve(REPO_ROOT, "ui");
export const NODE_TEST_IMPORT_RE = /(?:from|import)\s+['"]node:test['"]/;
export const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
export const SKIP_DIRS = new Set(["node_modules", "dist", "e2e", ".git", "coverage"]);

/** Test files that import node:test — Vite cannot bundle that builtin. */
export function listNodeTestFiles(fromDir) {
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
      const src = readFileSync(full, "utf8");
      if (NODE_TEST_IMPORT_RE.test(src)) {
        found.push(relative(fromDir, full).replaceAll("\\", "/"));
      }
    }
  };
  walk(fromDir);
  return found;
}

export function listWebUiNodeTestFiles() {
  return listNodeTestFiles(UI_DIR);
}

export function normalizeScanPath(file) {
  return String(file).replaceAll("\\", "/");
}
