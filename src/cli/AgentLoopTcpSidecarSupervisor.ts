import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createTcpAgentLoopSidecarConnectionFactory,
  type TcpAgentLoopSidecarConnectionFactoryOptions,
} from "../agent/modules/transport/tcpAgentLoopSidecarConnection.js";
import type { AgentLoopSidecarConnectionFactory } from "../agent/modules/transport/agentLoopSidecarClient.js";

/** First restart waits this long. Later attempts double up to the cap. */
export const AGENT_LOOP_TCP_SUPERVISOR_RESTART_BACKOFF_MS = 50;
export const AGENT_LOOP_TCP_SUPERVISOR_RESTART_BACKOFF_CAP_MS = 1_000;
/**
 * Acceptance bound for "kill child → connect again". The first restart uses
 * the 50ms backoff, so a healthy respawn finishes inside this window.
 * The supervisor keeps restarting after that; it does not give up at 5s.
 */
export const AGENT_LOOP_TCP_SUPERVISOR_RESTART_LIMIT_MS = 5_000;
export const AGENT_LOOP_TCP_SUPERVISOR_READY_TIMEOUT_MS = 5_000;
export const AGENT_LOOP_TCP_SUPERVISOR_KILL_GRACE_MS = 500;

const OUTPUT_TAIL_CHARS = 8_000;

export type AgentLoopTcpListenAddress = Readonly<{
  host: string;
  port: number;
}>;

export type AgentLoopTcpSidecarLaunch =
  | Readonly<{
      mode: "rust-listen";
      command: string;
      /** Arguments placed before the supervisor-owned `--listen HOST:PORT`. */
      args: readonly string[];
    }>
  | Readonly<{
      mode: "ts-env-listen";
      command: string;
      args: readonly string[];
    }>;

export type AgentLoopTcpSuperviseConfig = Readonly<{
  launch: AgentLoopTcpSidecarLaunch;
  cwd: string;
  env: NodeJS.ProcessEnv;
}>;

export type AgentLoopTcpSidecarSupervisorOptions = {
  host: string;
  /** `0` asks the child to bind an ephemeral port. */
  port: number;
  launch: AgentLoopTcpSidecarLaunch;
  cwd: string;
  env: NodeJS.ProcessEnv;
  authToken?: string;
  readyTimeoutMs?: number;
  killGraceMs?: number;
  logger?: (message: string) => void;
};

type AddressWaiter = {
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  resolve: (address: AgentLoopTcpListenAddress) => void;
  reject: (error: Error) => void;
};

/**
 * Owns one long-lived AgentLoop TCP sidecar process.
 *
 * The supervisor spawns the listener and restarts it after an unexpected
 * exit. It does not speak Module Protocol and does not replay in-flight
 * execute. Callers connect with the existing TCP client to whatever
 * `host:port` the latest `listening` line reported.
 */
export class AgentLoopTcpSidecarSupervisor {
  private readonly readyTimeoutMs: number;
  private readonly killGraceMs: number;
  private readonly log: (message: string) => void;
  private child: ChildProcess | undefined;
  private generation = 0;
  private stopped = false;
  private listening = false;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private startPromise: Promise<AgentLoopTcpListenAddress> | undefined;
  private addressValue: AgentLoopTcpListenAddress | undefined;
  private pidValue: number | undefined;
  private restartCountValue = 0;
  private output = "";
  private terminalError: Error | undefined;
  private readonly waiters: AddressWaiter[] = [];

  constructor(private readonly options: AgentLoopTcpSidecarSupervisorOptions) {
    this.readyTimeoutMs = positiveInteger(
      options.readyTimeoutMs ?? AGENT_LOOP_TCP_SUPERVISOR_READY_TIMEOUT_MS,
      "readyTimeoutMs",
    );
    this.killGraceMs = positiveInteger(
      options.killGraceMs ?? AGENT_LOOP_TCP_SUPERVISOR_KILL_GRACE_MS,
      "killGraceMs",
    );
    this.log = options.logger ?? ((message) => {
      console.error(`[pilotdeck] agent-loop tcp supervisor: ${message}`);
    });
    if (!isLoopbackHost(options.host)) {
      throw new Error("AgentLoop TCP supervisor refuses to bind a non-loopback host.");
    }
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
      throw new Error("AgentLoop TCP supervisor port must be an integer between 0 and 65535.");
    }
  }

  get pid(): number | undefined {
    return this.pidValue;
  }

  get restartCount(): number {
    return this.restartCountValue;
  }

  get address(): AgentLoopTcpListenAddress | undefined {
    return this.addressValue;
  }

  /** Bounded child stdout/stderr with the hello token removed. */
  outputTail(): string {
    return scrubToken(this.output, this.options.authToken);
  }

  /**
   * Spawn the sidecar and resolve once stderr/stdout prints `listening HOST:PORT`.
   * A second call while the supervisor is running returns the same promise.
   */
  start(): Promise<AgentLoopTcpListenAddress> {
    if (this.startPromise && !this.stopped) return this.startPromise;
    this.stopped = false;
    this.terminalError = undefined;
    this.startPromise = this.initialStart();
    return this.startPromise;
  }

  /**
   * Current listen address, waiting through a restart gap when necessary.
   * The wait is bounded by `timeoutMs` (default: the ready timeout) and is
   * rejected immediately by `stop()`, which gateway dispose calls. A restart
   * loop that never listens again therefore cannot hang a turn.
   */
  waitForAddress(timeoutMs?: number): Promise<AgentLoopTcpListenAddress> {
    if (this.addressValue) return Promise.resolve(this.addressValue);
    if (this.stopped) return Promise.reject(stoppedError());
    if (this.terminalError) return Promise.reject(this.terminalError);
    const bounded = positiveInteger(timeoutMs ?? this.readyTimeoutMs, "timeoutMs");
    return new Promise((resolve, reject) => {
      const waiter: AddressWaiter = { settled: false, resolve, reject };
      this.waiters.push(waiter);
      if (this.addressValue) {
        this.settleWaiter(waiter, undefined, this.addressValue);
        return;
      }
      if (this.stopped) {
        this.settleWaiter(waiter, stoppedError());
        return;
      }
      if (this.terminalError) {
        this.settleWaiter(waiter, this.terminalError);
        return;
      }
      waiter.timer = setTimeout(() => {
        this.settleWaiter(waiter, new Error(
          `Timed out waiting for the AgentLoop TCP sidecar to listen after ${bounded}ms.`,
        ));
      }, bounded);
    });
  }

  /** Kill the child process group and refuse further restarts. */
  async stop(): Promise<void> {
    if (this.stopped && !this.child && !this.restartTimer) return;
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    this.listening = false;
    this.addressValue = undefined;
    this.rejectWaiters(stoppedError());
    const child = this.child;
    if (child) await this.killAndWait(child);
    this.child = undefined;
    this.pidValue = undefined;
    this.startPromise = undefined;
    this.log("stopped");
  }

  private async initialStart(): Promise<AgentLoopTcpListenAddress> {
    const deadline = Date.now() + this.readyTimeoutMs;
    let attempt = 0;
    let lastError: Error | undefined;
    while (!this.stopped) {
      attempt += 1;
      try {
        return await this.spawnOnce();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (this.stopped) break;
        const remaining = deadline - Date.now();
        const delay = Math.min(restartBackoffMs(attempt), remaining);
        if (delay <= 0) break;
        this.log(`sidecar failed to listen (${lastError.message}); retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
    const failure = this.stopped
      ? stoppedError()
      : lastError ?? new Error("AgentLoop TCP sidecar did not become ready.");
    this.terminalError = failure;
    this.rejectWaiters(failure);
    throw failure;
  }

  private spawnOnce(): Promise<AgentLoopTcpListenAddress> {
    const generation = ++this.generation;
    const launch = this.options.launch;
    const listenAddr = formatAgentLoopListenAddr(this.options.host, this.options.port);
    const args = launch.mode === "rust-listen"
      ? [...launch.args, "--listen", listenAddr]
      : [...launch.args];
    const env = buildTcpSidecarChildEnv({
      env: this.options.env,
      mode: launch.mode,
      host: normalizeLoopbackHost(this.options.host),
      port: this.options.port,
      authToken: this.options.authToken,
    });
    const child = spawn(launch.command, args, {
      cwd: this.options.cwd,
      env,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    this.pidValue = child.pid;
    this.listening = false;
    this.log(`spawned pid=${child.pid ?? "unknown"} ${launch.mode} ${launch.command} ${args.join(" ")}`);

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, address?: AgentLoopTcpListenAddress) => {
        if (settled || generation !== this.generation) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          this.signalChild(child, "SIGKILL");
          reject(error);
          return;
        }
        this.terminalError = undefined;
        resolve(address!);
      };
      const timer = setTimeout(() => {
        this.signalChild(child, "SIGKILL");
        finish(new Error(
          `Timed out waiting for the sidecar listening line after ${this.readyTimeoutMs}ms. ${this.outputTail()}`,
        ));
      }, this.readyTimeoutMs);
      timer.unref?.();

      const acceptLine = (line: string) => {
        this.appendOutput(line);
        const parsed = parseListeningAddress(line);
        if (!parsed || settled || generation !== this.generation) return;
        this.listening = true;
        this.addressValue = parsed;
        this.log(`listening ${parsed.host}:${parsed.port} pid=${child.pid ?? "unknown"}`);
        this.flushWaiters(parsed);
        finish(undefined, parsed);
      };
      watchLines(child.stdout, acceptLine);
      watchLines(child.stderr, acceptLine);
      child.once("error", (error) => {
        finish(new Error(`Failed to spawn AgentLoop TCP sidecar: ${error.message}`));
      });
      child.once("exit", (code, signal) => {
        if (generation !== this.generation) return;
        if (this.child === child) {
          this.child = undefined;
          this.pidValue = undefined;
        }
        if (!settled) {
          finish(new Error(
            `AgentLoop TCP sidecar exited before listening (code=${code ?? "null"} signal=${signal ?? "null"}). ${this.outputTail()}`,
          ));
          return;
        }
        if (this.stopped) return;
        if (!this.listening) return;
        this.listening = false;
        this.addressValue = undefined;
        this.scheduleRestart(code, signal);
      });
    });
  }

  private scheduleRestart(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.stopped || this.restartTimer) return;
    this.restartCountValue += 1;
    const delay = restartBackoffMs(this.restartCountValue);
    this.log(
      `sidecar exited code=${code ?? "null"} signal=${signal ?? "null"}; restarting in ${delay}ms (restart ${this.restartCountValue})`,
    );
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.stopped) return;
      void this.spawnOnce().catch((error: unknown) => {
        if (this.stopped) return;
        const message = error instanceof Error ? error.message : String(error);
        this.log(`restart attempt failed: ${message}`);
        this.scheduleRestart(null, null);
      });
    }, delay);
  }

  private async killAndWait(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    this.signalChild(child, "SIGTERM");
    const finished = await Promise.race([
      exited.then(() => true),
      sleep(this.killGraceMs).then(() => false),
    ]);
    if (finished) return;
    this.signalChild(child, "SIGKILL");
    await Promise.race([exited, sleep(this.killGraceMs)]);
  }

  private signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
    const pid = child.pid;
    if (pid === undefined || pid <= 0 || pid === process.pid) {
      try { child.kill(signal); } catch { /* already gone */ }
      return;
    }
    try {
      process.kill(-pid, signal);
    } catch {
      try { child.kill(signal); } catch { /* already gone */ }
    }
  }

  private flushWaiters(address: AgentLoopTcpListenAddress): void {
    for (const waiter of [...this.waiters]) this.settleWaiter(waiter, undefined, address);
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of [...this.waiters]) this.settleWaiter(waiter, error);
  }

  private settleWaiter(waiter: AddressWaiter, error?: Error, address?: AgentLoopTcpListenAddress): void {
    if (waiter.settled) return;
    waiter.settled = true;
    if (waiter.timer) clearTimeout(waiter.timer);
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
    if (error) waiter.reject(error);
    else waiter.resolve(address!);
  }

  private appendOutput(line: string): void {
    this.output = `${this.output}${line}\n`.slice(-OUTPUT_TAIL_CHARS);
  }
}

export function createSupervisedTcpConnectionFactory(
  supervisor: AgentLoopTcpSidecarSupervisor,
  connectTimeoutMs: number | undefined,
): AgentLoopSidecarConnectionFactory {
  return async (input) => {
    const address = await supervisor.waitForAddress(connectTimeoutMs);
    const options: TcpAgentLoopSidecarConnectionFactoryOptions = {
      host: address.host,
      port: address.port,
      ...(connectTimeoutMs === undefined ? {} : { connectTimeoutMs }),
    };
    return createTcpAgentLoopSidecarConnectionFactory(options)(input);
  };
}

/**
 * Opt-in A. Supervise when the flag is set or an explicit sidecar command/bin
 * is set. A bare HOST+PORT deployment keeps reusing an external listener.
 * Returns undefined when this TCP deployment should not spawn anything.
 */
export function resolveAgentLoopTcpSuperviseConfig(input: {
  env: Record<string, string | undefined>;
  cwd: string;
}): AgentLoopTcpSuperviseConfig | undefined {
  const flag = readSuperviseFlag(input.env.PILOTDECK_AGENT_LOOP_TCP_SUPERVISE);
  const command = input.env.PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND?.trim() ?? "";
  const rustBin = input.env.PILOTDECK_RUST_SIDECAR_BIN?.trim() ?? "";
  if (!flag && !command && !rustBin) return undefined;
  const launch = resolveAgentLoopTcpSidecarLaunch(input);
  return Object.freeze({
    launch,
    cwd: input.cwd,
    env: { ...input.env },
  });
}

/**
 * Binary resolution, highest priority first:
 * 1. `PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND`
 * 2. `PILOTDECK_RUST_SIDECAR_BIN`
 * 3. `rust-core/target/release/pilotdeck-agent-loop-sidecar` under cwd, if it exists
 * Missing all three throws. There is no native fallback.
 */
export function resolveAgentLoopTcpSidecarLaunch(input: {
  env: Record<string, string | undefined>;
  cwd: string;
}): AgentLoopTcpSidecarLaunch {
  const extraArgs = readExtraArgs(input.env.PILOTDECK_AGENT_LOOP_SIDECAR_ARGS);
  const command = input.env.PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND?.trim() ?? "";
  const rustBin = input.env.PILOTDECK_RUST_SIDECAR_BIN?.trim() ?? "";
  if (command) {
    const executable = resolveExecutable(command, input.cwd);
    if (isTypeScriptSidecarCommand(executable, input.env.PILOTDECK_AGENT_LOOP_SIDECAR_PATH)) {
      const script = input.env.PILOTDECK_AGENT_LOOP_SIDECAR_PATH?.trim()
        ? resolve(input.cwd, input.env.PILOTDECK_AGENT_LOOP_SIDECAR_PATH)
        : defaultTypeScriptSidecarPath();
      const nodeCommand = isNodeCommand(executable) || isJavaScriptPath(executable)
        ? (isJavaScriptPath(executable) ? process.execPath : executable)
        : executable;
      const scriptArg = isJavaScriptPath(executable) ? executable : script;
      return Object.freeze({
        mode: "ts-env-listen",
        command: nodeCommand,
        args: Object.freeze([scriptArg, ...extraArgs]),
      });
    }
    return Object.freeze({
      mode: "rust-listen",
      command: executable,
      args: Object.freeze(extraArgs),
    });
  }
  if (rustBin) {
    return Object.freeze({
      mode: "rust-listen",
      command: resolveExecutable(rustBin, input.cwd),
      args: Object.freeze(extraArgs),
    });
  }
  const devBinary = devRustSidecarPath(input.cwd);
  if (existsSync(devBinary)) {
    return Object.freeze({
      mode: "rust-listen",
      command: devBinary,
      args: Object.freeze(extraArgs),
    });
  }
  throw new Error(
    "AgentLoop TCP supervise requires a sidecar binary. Set PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND "
    + "or PILOTDECK_RUST_SIDECAR_BIN, or build rust-core/target/release/pilotdeck-agent-loop-sidecar. "
    + "Refusing to fall back to native.",
  );
}

/** Child environment for a supervised TCP sidecar. Keeps the hello token. */
export function buildTcpSidecarChildEnv(input: {
  env: NodeJS.ProcessEnv;
  mode: AgentLoopTcpSidecarLaunch["mode"];
  host: string;
  port: number;
  authToken?: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...input.env };
  delete env.PILOTDECK_AGENT_LOOP_TRANSPORT;
  delete env.PILOTDECK_AGENT_LOOP_TCP_SUPERVISE;
  if (input.authToken) env.PILOTDECK_AGENT_LOOP_TCP_TOKEN = input.authToken;
  else delete env.PILOTDECK_AGENT_LOOP_TCP_TOKEN;
  if (input.mode === "ts-env-listen") {
    env.PILOTDECK_AGENT_LOOP_TCP_HOST = input.host;
    env.PILOTDECK_AGENT_LOOP_TCP_PORT = String(input.port);
  }
  return env;
}

export function parseListeningAddress(line: string): AgentLoopTcpListenAddress | undefined {
  const match = /^listening\s+(\[[^\]]+\]|[^:\s]+):(\d+)\s*$/.exec(line.trim());
  if (!match) return undefined;
  const host = match[1]!.replace(/^\[|\]$/g, "");
  const port = Number(match[2]);
  if (!isLoopbackHost(host)) return undefined;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  return { host, port };
}

export function formatAgentLoopListenAddr(host: string, port: number): string {
  const normalized = normalizeLoopbackHost(host);
  if (normalized.includes(":")) return `[${normalized}]:${port}`;
  return `${normalized}:${port}`;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  if (!match) return false;
  return match.slice(1).every((part) => {
    const value = Number(part);
    return value <= 255;
  });
}

export function devRustSidecarPath(cwd: string): string {
  const name = process.platform === "win32"
    ? "pilotdeck-agent-loop-sidecar.exe"
    : "pilotdeck-agent-loop-sidecar";
  return resolve(cwd, "rust-core", "target", "release", name);
}

function normalizeLoopbackHost(host: string): string {
  const value = host.trim().replace(/^\[|\]$/g, "");
  if (value.toLowerCase() === "localhost") return "127.0.0.1";
  return value;
}

function readSuperviseFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "" || normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no") {
    return false;
  }
  if (normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes") return true;
  throw new Error("PILOTDECK_AGENT_LOOP_TCP_SUPERVISE must be 1 or 0.");
}

function readExtraArgs(value: string | undefined): string[] {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("PILOTDECK_AGENT_LOOP_SIDECAR_ARGS must be a JSON string array or whitespace-separated tokens.");
    }
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("PILOTDECK_AGENT_LOOP_SIDECAR_ARGS must be a JSON string array or whitespace-separated tokens.");
    }
    return parsed;
  }
  return trimmed.split(/\s+/);
}

function resolveExecutable(command: string, cwd: string): string {
  if (command.includes("/") || command.includes("\\")) return resolve(cwd, command);
  return command;
}

function isTypeScriptSidecarCommand(command: string, sidecarPath: string | undefined): boolean {
  if (isNodeCommand(command) || isJavaScriptPath(command)) return true;
  return Boolean(sidecarPath?.trim() && isJavaScriptPath(sidecarPath));
}

function isNodeCommand(command: string): boolean {
  const name = basename(command).toLowerCase();
  return name === "node" || name === "node.exe" || name === "nodejs";
}

function isJavaScriptPath(value: string): boolean {
  return /\.(?:mjs|cjs|js)$/i.test(value.trim());
}

function defaultTypeScriptSidecarPath(): string {
  return fileURLToPath(new URL("./pilotdeck-agent-loop-sidecar.js", import.meta.url));
}

function restartBackoffMs(attempt: number): number {
  const shift = Math.max(0, Math.min(attempt, 6) - 1);
  return Math.min(
    AGENT_LOOP_TCP_SUPERVISOR_RESTART_BACKOFF_MS * (2 ** shift),
    AGENT_LOOP_TCP_SUPERVISOR_RESTART_BACKOFF_CAP_MS,
  );
}

function watchLines(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
  if (!stream) return;
  let pending = "";
  stream.setEncoding?.("utf8");
  stream.on("data", (chunk: string | Buffer) => {
    pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      onLine(pending.slice(0, newline).replace(/\r$/, ""));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  });
}

function scrubToken(text: string, token: string | undefined): string {
  const secret = token?.trim();
  if (!secret) return text.trim();
  return text.split(secret).join("[redacted]").trim();
}

function stoppedError(): Error {
  return new Error("AgentLoop TCP supervisor is stopped.");
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
