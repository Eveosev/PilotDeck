#!/usr/bin/env node
/**
 * T-P1-02 harness: start Rust `--listen 127.0.0.1:0`, discover the ephemeral
 * port, then run the connect-only TS host (hello → execute → status).
 *
 * The host process never receives SIDECAR_COMMAND / SIDECAR_PATH and never
 * spawns the sidecar. It only connects with:
 *   PILOTDECK_AGENT_LOOP_TRANSPORT=tcp
 *   PILOTDECK_AGENT_LOOP_TCP_HOST
 *   PILOTDECK_AGENT_LOOP_TCP_PORT
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const hostScript = resolve(here, "host.mjs");

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();

if (args.hostOnly) {
  const host = runHost(process.env);
  const report = {
    ok: host.ok,
    task: "T-P1-02",
    mode: "host-only",
    hostPid: host.pid,
    elapsedMs: Date.now() - startedAt,
    host: host.report,
    hostStderr: host.stderr || undefined,
  };
  emit(report, args.out);
  process.exit(host.ok ? 0 : 1);
}

const bin = resolveBin(args.bin);
const rust = spawn(bin, ["--listen", "127.0.0.1:0"], {
  cwd: repoRoot,
  stdio: ["ignore", "ignore", "pipe"],
});

let listen;
let rustStderr = "";
try {
  listen = await waitForListen(rust);
  const hostEnv = {
    ...process.env,
    PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp",
    PILOTDECK_AGENT_LOOP_TCP_HOST: listen.address,
    PILOTDECK_AGENT_LOOP_TCP_PORT: String(listen.port),
  };
  delete hostEnv.PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND;
  delete hostEnv.PILOTDECK_AGENT_LOOP_SIDECAR_PATH;

  const host = runHost(hostEnv);
  rustStderr = listen.stderr;
  const report = {
    ok: host.ok,
    task: "T-P1-02",
    mode: "harness",
    listen: `${listen.address}:${listen.port}`,
    rustBin: bin,
    rustPid: rust.pid,
    hostPid: host.pid,
    hostEnv: {
      PILOTDECK_AGENT_LOOP_TRANSPORT: hostEnv.PILOTDECK_AGENT_LOOP_TRANSPORT,
      PILOTDECK_AGENT_LOOP_TCP_HOST: hostEnv.PILOTDECK_AGENT_LOOP_TCP_HOST,
      PILOTDECK_AGENT_LOOP_TCP_PORT: hostEnv.PILOTDECK_AGENT_LOOP_TCP_PORT,
      PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND: null,
      PILOTDECK_AGENT_LOOP_SIDECAR_PATH: null,
    },
    elapsedMs: Date.now() - startedAt,
    host: host.report,
    hostStderr: host.stderr || undefined,
    rustStderr: rustStderr.trim() || undefined,
  };
  emit(report, args.out);
  process.exit(host.ok ? 0 : 1);
} catch (error) {
  const report = {
    ok: false,
    task: "T-P1-02",
    mode: "harness",
    error: String(error?.message ?? error),
    rustPid: rust.pid,
    elapsedMs: Date.now() - startedAt,
    rustStderr: (listen?.stderr ?? rustStderr).trim() || undefined,
  };
  emit(report, args.out);
  process.exit(1);
} finally {
  if (!rust.killed) rust.kill("SIGTERM");
  await new Promise((resolveWait) => {
    const timer = setTimeout(() => {
      rust.kill("SIGKILL");
      resolveWait();
    }, 2_000);
    rust.once("exit", () => {
      clearTimeout(timer);
      resolveWait();
    });
  });
}

function parseArgs(argv) {
  const parsed = { bin: undefined, out: undefined, hostOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--bin") {
      parsed.bin = argv[++i];
    } else if (arg === "--out") {
      parsed.out = argv[++i];
    } else if (arg === "--host-only") {
      parsed.hostOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node tools/t-p1-02-harness/run.mjs [--bin PATH] [--out FILE] [--host-only]
  --bin PATH     Rust pilotdeck-agent-loop binary (default: cargo build debug)
  --out FILE     Write the combined JSON report
  --host-only    Skip Rust listen; require TCP env already set`);
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function resolveBin(explicit) {
  if (explicit) return resolve(explicit);
  const built = resolve(repoRoot, "target/debug/pilotdeck-agent-loop");
  const build = spawnSync(
    "cargo",
    ["build", "-p", "pilotdeck-agent-loop", "--bin", "pilotdeck-agent-loop"],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if (build.status !== 0) {
    throw new Error(`cargo build failed with status ${build.status}`);
  }
  return built;
}

function runHost(env) {
  const replayed = spawnSync(process.execPath, [hostScript], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
  let report = null;
  const stdout = (replayed.stdout ?? "").trim();
  if (stdout) {
    try {
      report = JSON.parse(stdout);
    } catch {
      report = { ok: false, parseError: "host stdout is not JSON", stdout };
    }
  }
  return {
    ok: replayed.status === 0 && report?.ok === true,
    pid: replayed.pid ?? null,
    report,
    stderr: (replayed.stderr ?? "").trim(),
    status: replayed.status,
  };
}

function waitForListen(proc) {
  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => reject(new Error("sidecar did not print listening address")), 15_000);
    let buf = "";
    proc.stderr.on("data", (chunk) => {
      buf += chunk.toString();
      const match = buf.match(/listening\s+(\S+)/);
      if (match) {
        clearTimeout(timer);
        const [host, port] = match[1].split(":");
        resolveWait({ address: host, port: Number(port), stderr: buf });
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`sidecar exited before listen (${code}): ${buf}`));
    });
  });
}

function emit(report, out) {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(text);
  if (out) {
    const path = resolve(out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}
