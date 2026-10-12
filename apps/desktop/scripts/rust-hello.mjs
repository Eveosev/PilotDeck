import { chmodSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Same Module Protocol version as `MODULE_PROTOCOL_VERSION` in `src/agent/modules/protocol.ts`. */
export const MODULE_PROTOCOL_VERSION = "2.0";
export const RUST_HELLO_BIN = "pilotdeck-agent-loop-hello";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const desktopRoot = resolve(__dirname, "..");
export const repoRoot = resolve(desktopRoot, "..", "..");
export const rustHelloDestName = process.platform === "win32" ? `${RUST_HELLO_BIN}.exe` : RUST_HELLO_BIN;
export const rustResourcesDir = resolve(desktopRoot, "resources", "rust");
export const rustHelloDest = resolve(rustResourcesDir, rustHelloDestName);
export const rustHelloManifest = resolve(repoRoot, "crates", "pilotdeck-agent-loop-hello", "Cargo.toml");
export const rustHelloCargoOutput = resolve(repoRoot, "target", "release", rustHelloDestName);

/** Explicit opt-in only. Full `dev` / `pack` / `dist:*` must not run cargo. */
export function rustHelloOptedIn({ argv = process.argv, env = process.env } = {}) {
  return argv.includes("--rust-only")
    || env.PILOTDECK_DESKTOP_RUST === "1"
    || env.PILOTDECK_DESKTOP_REQUIRE_RUST === "1";
}

function commandExists(command) {
  const lookup = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
    encoding: "utf8",
  });
  return lookup.status === 0;
}

/**
 * Workspace `cargo build --release` for the hello crate, then copy the binary
 * to `apps/desktop/resources/rust/pilotdeck-agent-loop-hello` (`.exe` on Windows).
 *
 * Callers that need the binary (`--rust-only`, verify, or an opt-in env) pass
 * `requireCargo: true`. Full desktop pack/dev/dist must not call this unless
 * `rustHelloOptedIn()` is true.
 */
export function buildRustHello({ requireCargo = true } = {}) {
  if (!commandExists("cargo")) {
    if (requireCargo) {
      throw new Error("cargo is required to build pilotdeck-agent-loop-hello");
    }
    console.log("[desktop] cargo not found; skipping rust hello build");
    return { skipped: true };
  }
  if (!existsSync(rustHelloManifest)) {
    throw new Error(`Rust hello crate missing: ${rustHelloManifest}`);
  }

  mkdirSync(rustResourcesDir, { recursive: true });
  console.log(`[desktop] cargo build --release (${repoRoot})`);
  const result = spawnSync("cargo", ["build", "--release", "--manifest-path", rustHelloManifest], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("cargo build --release failed for crates/pilotdeck-agent-loop-hello");
  }
  if (!existsSync(rustHelloCargoOutput)) {
    throw new Error(`cargo did not produce ${rustHelloCargoOutput}`);
  }
  cpSync(rustHelloCargoOutput, rustHelloDest);
  if (process.platform !== "win32") {
    chmodSync(rustHelloDest, 0o755);
  }
  console.log(`[desktop] staged rust hello: ${rustHelloDest}`);
  return { skipped: false, dest: rustHelloDest };
}

/**
 * No-op unless `--rust-only` or `PILOTDECK_DESKTOP_RUST=1` /
 * `PILOTDECK_DESKTOP_REQUIRE_RUST=1`. Does not look at whether cargo is on PATH.
 */
export function maybeBuildRustHello(options = {}) {
  if (!rustHelloOptedIn(options)) {
    return { skipped: true, reason: "not-opted-in" };
  }
  return { ...buildRustHello({ requireCargo: true }), reason: "opt-in" };
}
