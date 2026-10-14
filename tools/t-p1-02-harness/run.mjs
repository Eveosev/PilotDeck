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
 *
 * Cleanup: never process.exit() before the Rust child is reaped. SIGINT /
 * SIGTERM / process 'exit' all kill the child (SIGTERM then SIGKILL).
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

let rust = null;
let hostChild = null;
let shuttingDown = false;

installProcessGuards();

if (args.hostOnly) {
  const host = await runHost(process.env);
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
  process.exitCode = host.ok ? 0 : 1;
} else {
  try {
    const bin = resolveBin(args.bin);
    rust = await spawnRust(bin);
    const listen = await waitForListen(rust);
    const hostEnv = {
      ...process.env,
      PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp",
      PILOTDECK_AGENT_LOOP_TCP_HOST: listen.address,
      PILOTDECK_AGENT_LOOP_TCP_PORT: String(listen.port),
    };
    delete hostEnv.PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND;
    delete hostEnv.PILOTDECK_AGENT_LOOP_SIDECAR_PATH;
    if (args.failHost) hostEnv.T_P1_02_FORCE_HOST_FAIL = "1";

    const host = await runHost(hostEnv);
    const report = {
      ok: host.ok,
      task: "T-P1-02",
      mode: "harness",
      listen: formatListen(listen.address, listen.port),
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
      rustStderr: listen.stderr.trim() || undefined,
    };
    emit(report, args.out);
    process.exitCode = host.ok ? 0 : 1;
  } catch (error) {
    const report = {
      ok: false,
      task: "T-P1-02",
      mode: "harness",
      error: String(error?.message ?? error),
      rustPid: rust?.pid ?? null,
      elapsedMs: Date.now() - startedAt,
    };
    emit(report, args.out);
    process.exitCode = 1;
  } finally {
    await stopChildren();
  }
}

function parseArgs(argv) {
  const parsed = { bin: undefined, out: undefined, hostOnly: false, failHost: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--bin") {
      parsed.bin = argv[++i];
      if (!parsed.bin) throw new Error("--bin requires a path");
    } else if (arg === "--out") {
      parsed.out = argv[++i];
      if (!parsed.out) throw new Error("--out requires a path");
    } else if (arg === "--host-only") {
      parsed.hostOnly = true;
    } else if (arg === "--fail-host") {
      parsed.failHost = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node tools/t-p1-02-harness/run.mjs [--bin PATH] [--out FILE] [--host-only] [--fail-host]
  --bin PATH     Rust pilotdeck-agent-loop binary (default: cargo build debug)
  --out FILE     Write the combined JSON report
  --host-only    Skip Rust listen; require TCP env already set
  --fail-host    After listen, force the host to fail (cleanup evidence)`);
      process.exitCode = 0;
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

function spawnRust(bin) {
  return new Promise((resolveWait, reject) => {
    let settled = false;
    let child;
    try {
      child = spawn(bin, ["--listen", "127.0.0.1:0"], {
        cwd: repoRoot,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      reject(spawnFailure(bin, error));
      return;
    }
    rust = child;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(spawnFailure(bin, error));
    };
    child.once("error", fail);
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.removeListener("error", fail);
      child.on("error", (error) => {
        console.error(`rust sidecar spawn error: ${error.message}`);
      });
      resolveWait(child);
    });
  });
}

function spawnFailure(bin, error) {
  const code = error?.code ? ` (${error.code})` : "";
  return new Error(`failed to spawn Rust sidecar ${bin}: ${error?.message ?? error}${code}`);
}

async function runHost(env) {
  return new Promise((resolveWait) => {
    const child = spawn(process.execPath, [hostScript], {
      cwd: repoRoot,
      env: { ...env, NODE_NO_WARNINGS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    hostChild = child;
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const finish = (status, errorMessage) => {
      if (hostChild === child) hostChild = null;
      let report = null;
      const text = stdout.trim();
      if (text) {
        try {
          report = JSON.parse(text);
        } catch {
          report = { ok: false, parseError: "host stdout is not JSON", stdout: text };
        }
      }
      resolveWait({
        ok: status === 0 && report?.ok === true,
        pid: child.pid ?? null,
        report,
        stderr: (errorMessage ? `${stderr}\n${errorMessage}` : stderr).trim(),
        status,
      });
    };
    child.once("error", (error) => finish(1, error.message));
    child.once("exit", (code, signal) => {
      finish(signal ? 1 : (code ?? 1));
    });
  });
}

function waitForListen(proc) {
  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => reject(new Error("sidecar did not print listening address")), 15_000);
    let buf = "";
    let settled = false;
    const finishOk = (parsed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveWait({ ...parsed, stderr: buf });
    };
    const finishErr = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    proc.stderr.on("data", (chunk) => {
      buf += chunk.toString();
      try {
        const parsed = parseListenLine(buf);
        if (parsed) finishOk(parsed);
      } catch (error) {
        finishErr(error);
      }
    });
    proc.once("error", (error) => finishErr(spawnFailure("rust sidecar", error)));
    proc.once("exit", (code, signal) => {
      finishErr(new Error(`sidecar exited before listen (${signal ?? code}): ${buf}`));
    });
  });
}

/**
 * Full-line listen parse. Accepts `listening 127.0.0.1:PORT` or
 * `listening [::1]:PORT`. Host must be loopback; port 1-65535.
 */
function parseListenLine(buf) {
  const match = buf.match(/(?:^|\n)listening[ \t]+(\S+)[ \t]*\n/);
  if (!match) return null;
  const addr = match[1];
  let host;
  let portText;
  const ipv6 = addr.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6) {
    host = ipv6[1];
    portText = ipv6[2];
  } else {
    const ipv4 = addr.match(/^([^[\]]+):(\d+)$/);
    if (!ipv4) throw new Error(`invalid listen address '${addr}' (expected HOST:PORT or [::1]:PORT)`);
    host = ipv4[1];
    portText = ipv4[2];
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`listen port must be an integer between 1 and 65535, got '${portText}'`);
  }
  if (!isLoopbackHost(host)) {
    throw new Error(`listen host must be loopback (127.0.0.1 / ::1 / localhost), got '${host}'`);
  }
  return { address: host, port };
}

function isLoopbackHost(host) {
  const normalized = String(host).trim().toLowerCase();
  return normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "localhost"
    || normalized === "0:0:0:0:0:0:0:1";
}

function formatListen(host, port) {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

function childAlive(child) {
  return Boolean(child && child.pid != null && child.exitCode === null && child.signalCode === null);
}

function killChild(child, signal) {
  if (!childAlive(child)) return;
  try {
    child.kill(signal);
  } catch {
    // already gone
  }
}

async function stopChild(child, label) {
  if (!childAlive(child)) return;
  killChild(child, "SIGTERM");
  await new Promise((resolveWait) => {
    const timer = setTimeout(() => {
      killChild(child, "SIGKILL");
      resolveWait();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveWait();
    });
  });
  if (label === "rust") rust = childAlive(child) ? child : null;
  if (label === "host") hostChild = childAlive(child) ? child : null;
}

async function stopChildren() {
  await stopChild(hostChild, "host");
  await stopChild(rust, "rust");
}

function installProcessGuards() {
  const onSignal = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    stopChildren().finally(() => {
      process.exit(process.exitCode ?? 1);
    });
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("exit", () => {
    killChild(hostChild, "SIGKILL");
    killChild(rust, "SIGKILL");
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
