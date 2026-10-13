/**
 * Resolve vite/vitest from ui/ so repo-root tooling can import
 * vitest.config.js after a Web-only pnpm install.
 */
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requireUi = createRequire(resolvePath(dirname(fileURLToPath(import.meta.url)), "../../ui/package.json"));

export function formatResolveError(err) {
  return err instanceof Error ? err.message : String(err);
}

export function resolveUiPackage(specifier) {
  try {
    return requireUi.resolve(specifier);
  } catch (err) {
    throw new Error(
      `check-web-node-test-scan: cannot resolve '${specifier}' from ui/. Install Web UI dependencies (pnpm install --filter pilotdeck --filter pilotdeck-ui). ${formatResolveError(err)}`,
    );
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "vite" || specifier.startsWith("vite/") || specifier === "vitest" || specifier.startsWith("vitest/")) {
    return { url: pathToFileURL(resolveUiPackage(specifier)).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
