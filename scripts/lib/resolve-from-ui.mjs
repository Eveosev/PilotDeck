/**
 * Resolve vite/vitest from ui/ so repo-root tooling can import
 * vitest.config.js after a Web-only pnpm install.
 */
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requireUi = createRequire(resolvePath(dirname(fileURLToPath(import.meta.url)), "../../ui/package.json"));

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "vite" || specifier.startsWith("vite/") || specifier === "vitest" || specifier.startsWith("vitest/")) {
    let resolved;
    try {
      resolved = requireUi.resolve(specifier);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `check-web-node-test-scan: cannot resolve '${specifier}' from ui/. Install Web UI dependencies (pnpm install --filter pilotdeck --filter pilotdeck-ui). ${reason}`,
      );
    }
    return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
