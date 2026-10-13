import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = dirname(fileURLToPath(import.meta.url));
const uiNodeModules = resolve(rootDir, 'ui/node_modules');

/** Test files that import node:test — Vite cannot bundle that builtin. */
export function vitestExcludeNodeTestFiles(fromDir) {
  const found = [];
  const skipDir = new Set(['node_modules', 'dist', 'e2e', '.git', 'coverage']);
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
        if (!skipDir.has(entry.name)) walk(full);
        continue;
      }
      if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const src = readFileSync(full, 'utf8');
      if (/(?:from|import)\s+['"]node:test['"]/.test(src)) {
        found.push(relative(fromDir, full).replaceAll('\\', '/'));
      }
    }
  };
  walk(fromDir);
  return found;
}

export default defineConfig({
  resolve: {
    alias: {
      react: resolve(uiNodeModules, 'react'),
      'react-dom': resolve(uiNodeModules, 'react-dom'),
      'react/jsx-dev-runtime': resolve(uiNodeModules, 'react/jsx-dev-runtime.js'),
      'react/jsx-runtime': resolve(uiNodeModules, 'react/jsx-runtime.js'),
    },
  },
  test: {
    setupFiles: [resolve(rootDir, 'vitest.setup.ts')],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', ...vitestExcludeNodeTestFiles(rootDir)],
  },
});
