import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { listNodeTestFiles } from './scripts/lib/web-node-test-files.mjs';

const rootDir = dirname(fileURLToPath(import.meta.url));
const uiNodeModules = resolve(rootDir, 'ui/node_modules');

/** Test files that import node:test — Vite cannot bundle that builtin. */
export function vitestExcludeNodeTestFiles(fromDir) {
  return listNodeTestFiles(fromDir);
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
