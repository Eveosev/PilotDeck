/**
 * Resolve vite/vitest from ui/ so repo-root tooling can import
 * vitest.config.js after a Web-only pnpm install.
 */
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requireUi = createRequire(resolvePath(dirname(fileURLToPath(import.meta.url)), "../../ui/package.json"));

const INSTALL_HINT = "Install with: pnpm install --frozen-lockfile.";

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/** Format a missing-package import/resolve failure (name + install command). */
export function formatMissingDepError(specifier, err) {
  return `check-web-node-test-scan: cannot import '${specifier}'. ${INSTALL_HINT} ${errorMessage(err)}`;
}

export function resolveUiPackage(specifier) {
  try {
    return requireUi.resolve(specifier);
  } catch (err) {
    throw new Error(
      `check-web-node-test-scan: cannot resolve '${specifier}' from ui/. ${INSTALL_HINT} ${errorMessage(err)}`,
    );
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "vite" || specifier.startsWith("vite/") || specifier === "vitest" || specifier.startsWith("vitest/")) {
    return { url: pathToFileURL(resolveUiPackage(specifier)).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
