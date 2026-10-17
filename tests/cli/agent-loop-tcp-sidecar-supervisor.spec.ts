import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createAgentLoopDeploymentFactory,
  resolveAgentLoopDeploymentProfile,
} from "../../src/cli/AgentLoopDeploymentProfile.js";
import {
  AGENT_LOOP_TCP_SUPERVISOR_RESTART_LIMIT_MS,
  AgentLoopTcpSidecarSupervisor,
  buildTcpSidecarChildEnv,
  createSupervisedTcpConnectionFactory,
  devRustSidecarPath,
  formatAgentLoopListenAddr,
  parseListeningAddress,
  resolveAgentLoopTcpSidecarLaunch,
} from "../../src/cli/AgentLoopTcpSidecarSupervisor.js";
import { createLocalGateway } from "../../src/cli/createLocalGateway.js";
import { LocalGatewayLifecycleBundle } from "../../src/cli/LocalGatewayLifecycleBundle.js";

const FAKE_SIDECAR = fileURLToPath(new URL("./fixtures/fake-agent-loop-tcp-sidecar.mjs", import.meta.url));
const TOKEN = "production-token";

test("deployment profile stays native unless transport is selected", () => {
  assert.deepEqual(resolveAgentLoopDeploymentProfile({ env: {} }), { transport: "native" });
  assert.deepEqual(
    resolveAgentLoopDeploymentProfile({ env: { PILOTDECK_AGENT_LOOP_TCP_SUPERVISE: "1" } }),
    { transport: "native" },
  );
  assert.equal(createAgentLoopDeploymentFactory(resolveAgentLoopDeploymentProfile({ env: {} })), undefined);
});

test("tcp reuse keeps the external listener profile when supervise is off", () => {
  const profile = resolveAgentLoopDeploymentProfile({
    env: {
      PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp",
      PILOTDECK_AGENT_LOOP_TCP_HOST: "127.0.0.8",
      PILOTDECK_AGENT_LOOP_TCP_PORT: "32123",
      PILOTDECK_AGENT_LOOP_TCP_SUPERVISE: "0",
      PILOTDECK_RUST_SIDECAR_BIN: "",
    },
  });
  assert.equal(profile.transport, "tcp");
  if (profile.transport !== "tcp") return;
  assert.equal(profile.port, 32123);
  assert.equal(profile.supervise, undefined);
  assert.equal(typeof createAgentLoopDeploymentFactory(profile), "function");
});

test("stdio deployment still strips TCP listener env and does not arm the supervisor", () => {
  const profile = resolveAgentLoopDeploymentProfile({
    cwd: "/workspace",
    env: {
      PILOTDECK_AGENT_LOOP_TRANSPORT: "stdio",
      PILOTDECK_AGENT_LOOP_TCP_SUPERVISE: "1",
      PILOTDECK_AGENT_LOOP_TCP_HOST: "127.0.0.1",
      PILOTDECK_AGENT_LOOP_TCP_PORT: "32123",
      PILOTDECK_AGENT_LOOP_TCP_TOKEN: TOKEN,
      PILOTDECK_RUST_SIDECAR_BIN: "/opt/pilotdeck-agent-loop-sidecar",
    },
  });
  assert.equal(profile.transport, "stdio");
  if (profile.transport !== "stdio") return;
  assert.equal(profile.env.PILOTDECK_AGENT_LOOP_TCP_HOST, undefined);
  assert.equal(profile.env.PILOTDECK_AGENT_LOOP_TCP_PORT, undefined);
  assert.equal(profile.env.PILOTDECK_AGENT_LOOP_TCP_TOKEN, undefined);
  assert.equal("supervise" in profile, false);
});

test("tcp supervise resolves rust-listen argv and keeps the hello token for the child", async () => {
  const root = await mkdtemp(join(tmpdir(), "pilotdeck-supervise-resolve-"));
  try {
    const devBinary = devRustSidecarPath(root);
    await mkdir(join(root, "rust-core", "target", "release"), { recursive: true });
    await writeFile(devBinary, "");
    const byFlag = resolveAgentLoopDeploymentProfile({
      cwd: root,
      env: {
        PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp",
        PILOTDECK_AGENT_LOOP_TCP_SUPERVISE: "1",
        PILOTDECK_AGENT_LOOP_TCP_TOKEN: `  ${TOKEN}  `,
      },
    });
    assert.equal(byFlag.transport, "tcp");
    if (byFlag.transport !== "tcp") return;
    assert.equal(byFlag.port, 0);
    assert.equal(byFlag.authToken, TOKEN);
    assert.equal(byFlag.supervise?.launch.mode, "rust-listen");
    assert.equal(byFlag.supervise?.launch.command, devBinary);

    const byBin = resolveAgentLoopTcpSidecarLaunch({
      cwd: root,
      env: { PILOTDECK_RUST_SIDECAR_BIN: "relative/pilotdeck-agent-loop-sidecar" },
    });
    assert.equal(byBin.mode, "rust-listen");
    assert.equal(byBin.command, join(root, "relative/pilotdeck-agent-loop-sidecar"));

    const commandWins = resolveAgentLoopTcpSidecarLaunch({
      cwd: root,
      env: {
        PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND: "/opt/custom-sidecar",
        PILOTDECK_RUST_SIDECAR_BIN: "/opt/ignored",
        PILOTDECK_AGENT_LOOP_SIDECAR_ARGS: JSON.stringify(["--flag"]),
      },
    });
    assert.deepEqual(commandWins, { mode: "rust-listen", command: "/opt/custom-sidecar", args: ["--flag"] });

    const tsLaunch = resolveAgentLoopTcpSidecarLaunch({
      cwd: root,
      env: {
        PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND: process.execPath,
        PILOTDECK_AGENT_LOOP_SIDECAR_PATH: FAKE_SIDECAR,
      },
    });
    assert.equal(tsLaunch.mode, "ts-env-listen");
    assert.deepEqual(tsLaunch.args[0], FAKE_SIDECAR);

    const childEnv = buildTcpSidecarChildEnv({
      env: {
        PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp",
        PILOTDECK_AGENT_LOOP_TCP_SUPERVISE: "1",
        PILOTDECK_AGENT_LOOP_TCP_TOKEN: TOKEN,
        PATH: "/usr/bin",
      },
      mode: "rust-listen",
      host: "127.0.0.1",
      port: 0,
      authToken: TOKEN,
    });
    assert.equal(childEnv.PILOTDECK_AGENT_LOOP_TCP_TOKEN, TOKEN);
    assert.equal(childEnv.PILOTDECK_AGENT_LOOP_TRANSPORT, undefined);
    assert.equal(childEnv.PILOTDECK_AGENT_LOOP_TCP_SUPERVISE, undefined);
    assert.equal(childEnv.PATH, "/usr/bin");

    assert.throws(
      () => resolveAgentLoopDeploymentProfile({
        cwd: root,
        env: { PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp", PILOTDECK_AGENT_LOOP_TCP_SUPERVISE: "1", PILOTDECK_AGENT_LOOP_TCP_HOST: "8.8.8.8" },
      }),
      /loopback/,
    );
    assert.throws(
      () => resolveAgentLoopDeploymentProfile({
        env: { PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp", PILOTDECK_AGENT_LOOP_TCP_SUPERVISE: "maybe" },
      }),
      /PILOTDECK_AGENT_LOOP_TCP_SUPERVISE must be 1 or 0/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tcp supervise without a binary fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "pilotdeck-supervise-missing-"));
  try {
    assert.throws(
      () => resolveAgentLoopDeploymentProfile({
        cwd: root,
        env: { PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp", PILOTDECK_AGENT_LOOP_TCP_SUPERVISE: "1" },
      }),
      /Refusing to fall back to native/,
    );
    assert.equal(resolveAgentLoopDeploymentProfile({ env: {} }).transport, "native");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listening line parser accepts loopback HOST:PORT only", () => {
  assert.deepEqual(parseListeningAddress("listening 127.0.0.1:4321"), { host: "127.0.0.1", port: 4321 });
  assert.deepEqual(parseListeningAddress("listening [::1]:9\r"), { host: "::1", port: 9 });
  assert.equal(parseListeningAddress("listening 0.0.0.0:9"), undefined);
  assert.equal(parseListeningAddress("ready 127.0.0.1:9"), undefined);
  assert.equal(formatAgentLoopListenAddr("localhost", 0), "127.0.0.1:0");
  assert.equal(formatAgentLoopListenAddr("::1", 9), "[::1]:9");
});

test("supervisor spawns a rust-listen sidecar, restarts it, and probes hello plus execute", async () => {
  await assertSuperviseRestart({
    mode: "rust-listen",
    env: {
      PATH: process.env.PATH,
      PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp",
      PILOTDECK_AGENT_LOOP_TCP_SUPERVISE: "1",
      PILOTDECK_RUST_SIDECAR_BIN: FAKE_SIDECAR,
      PILOTDECK_AGENT_LOOP_TCP_TOKEN: TOKEN,
    },
  });
});

test("supervisor spawns a TS env listener without --listen and restarts it", async () => {
  await assertSuperviseRestart({
    mode: "ts-env-listen",
    env: {
      PATH: process.env.PATH,
      PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp",
      PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND: process.execPath,
      PILOTDECK_AGENT_LOOP_SIDECAR_PATH: FAKE_SIDECAR,
    },
  });
});

test("fixed port supervise rebinds the same port after the child exits", async () => {
  const port = await reservePort();
  const supervisor = startFromEnv({
    PATH: process.env.PATH,
    PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp",
    PILOTDECK_AGENT_LOOP_TCP_SUPERVISE: "1",
    PILOTDECK_AGENT_LOOP_TCP_PORT: String(port),
    PILOTDECK_RUST_SIDECAR_BIN: FAKE_SIDECAR,
  });
  try {
    const first = await supervisor.start();
    assert.equal(first.port, port);
    const firstPid = requiredPid(supervisor);
    process.kill(firstPid, "SIGKILL");
    await waitFor(() => supervisor.pid !== undefined && supervisor.pid !== firstPid && supervisor.address?.port === port, AGENT_LOOP_TCP_SUPERVISOR_RESTART_LIMIT_MS);
    const probe = await helloExecute(port);
    assert.equal(probe.hello.ok, true);
    assert.equal(probe.execute.code, "PROBE_EXECUTE");
  } finally {
    await supervisor.stop();
  }
});

test("stop kills the sidecar and does not restart it", async () => {
  const supervisor = startFromEnv({
    PATH: process.env.PATH,
    PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp",
    PILOTDECK_AGENT_LOOP_TCP_SUPERVISE: "1",
    PILOTDECK_RUST_SIDECAR_BIN: FAKE_SIDECAR,
  });
  const address = await supervisor.start();
  const pid = requiredPid(supervisor);
  const restarts = supervisor.restartCount;
  await supervisor.stop();
  await delay(300);
  assert.equal(supervisor.restartCount, restarts);
  assert.equal(supervisor.pid, undefined);
  assert.equal(alive(pid), false);
  await assert.rejects(connect(address.port), /ECONNREFUSED|ECONNRESET|connect/);
});

test("reuse connects to an external listener and does not spawn when supervise is off", async () => {
  const external = spawn(process.execPath, [FAKE_SIDECAR, "--listen", "127.0.0.1:0"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    const address = await readListening(external.stderr);
    const profile = resolveAgentLoopDeploymentProfile({
      env: {
        PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp",
        PILOTDECK_AGENT_LOOP_TCP_HOST: address.host,
        PILOTDECK_AGENT_LOOP_TCP_PORT: String(address.port),
      },
    });
    assert.equal(profile.transport, "tcp");
    if (profile.transport !== "tcp") return;
    assert.equal(profile.supervise, undefined);
    const factory = createAgentLoopDeploymentFactory(profile);
    assert.ok(factory);
    const probe = await helloExecute(address.port);
    assert.equal(probe.hello.ok, true);
    assert.equal(external.exitCode, null);
  } finally {
    if (external.pid) {
      try { process.kill(external.pid, "SIGKILL"); } catch { /* already gone */ }
    }
  }
});

test("local gateway supervise starts the listener and dispose stops the restart loop", async () => {
  const root = await mkdtemp(join(tmpdir(), "pilotdeck-gateway-supervise-"));
  const port = await reservePort();
  await writeFile(join(root, "pilotdeck.yaml"), [
    "schemaVersion: 1",
    "agent:",
    "  model: test/test",
    "  maxContextTokens: 128000",
    "  maxOutputTokens: 8192",
    "router:",
    "  enabled: false",
    "model:",
    "  providers:",
    "    test:",
    "      protocol: openai",
    "      url: http://127.0.0.1:1",
    "      apiKey: test-only",
    "      models:",
    "        test:",
    "          capabilities:",
    "            supportsToolUse: true",
    "            maxContextTokens: 128000",
    "            maxOutputTokens: 8192",
    "",
  ].join("\n"));
  const local = createLocalGateway({
    projectRoot: root,
    pilotHome: root,
    permissionMode: "bypassPermissions",
    env: {
      PATH: process.env.PATH,
      PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp",
      PILOTDECK_AGENT_LOOP_TCP_SUPERVISE: "1",
      PILOTDECK_AGENT_LOOP_TCP_HOST: "127.0.0.1",
      PILOTDECK_AGENT_LOOP_TCP_PORT: String(port),
      PILOTDECK_RUST_SIDECAR_BIN: FAKE_SIDECAR,
    },
  });
  try {
    await waitFor(async () => {
      try {
        const probe = await helloExecute(port);
        return probe.hello.ok === true;
      } catch {
        return false;
      }
    }, AGENT_LOOP_TCP_SUPERVISOR_RESTART_LIMIT_MS);
  } finally {
    await local.dispose();
    await rm(root, { recursive: true, force: true });
  }
  await delay(300);
  await assert.rejects(connect(port), /ECONNREFUSED|ECONNRESET|connect/);
});

test("a failing restart cannot hang waitForAddress, and stop or dispose cancels it", { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pilotdeck-supervise-fail-"));
  const failFile = join(root, "suppress-restart");
  const supervisor = startFromEnv({
    PATH: process.env.PATH,
    PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp",
    PILOTDECK_AGENT_LOOP_TCP_SUPERVISE: "1",
    PILOTDECK_RUST_SIDECAR_BIN: FAKE_SIDECAR,
    PILOTDECK_FAKE_SIDECAR_FAIL_FILE: failFile,
  }, { readyTimeoutMs: 1_000 });
  try {
    await supervisor.start();
    await writeFile(failFile, "suppress\n");
    const firstPid = requiredPid(supervisor);
    process.kill(firstPid, "SIGKILL");
    await waitFor(() => supervisor.address === undefined, AGENT_LOOP_TCP_SUPERVISOR_RESTART_LIMIT_MS);

    const waitMs = 400;
    const waitedAt = Date.now();
    await assert.rejects(
      supervisor.waitForAddress(waitMs),
      /Timed out waiting for the AgentLoop TCP sidecar to listen after 400ms/,
    );
    const waitedMs = Date.now() - waitedAt;
    assert.ok(waitedMs < 1_200, `failed-restart wait hung for ${waitedMs}ms`);
    assert.ok(waitedMs >= waitMs - 50, `failed-restart wait returned early at ${waitedMs}ms`);

    const factoryMs = 350;
    const factoryAt = Date.now();
    const factory = createSupervisedTcpConnectionFactory(supervisor, factoryMs);
    await assert.rejects(
      Promise.resolve(factory({} as never)),
      /Timed out waiting for the AgentLoop TCP sidecar to listen after 350ms/,
    );
    const factoryElapsedMs = Date.now() - factoryAt;
    assert.ok(factoryElapsedMs < 1_200, `factory wait hung for ${factoryElapsedMs}ms`);

    const pending = supervisor.waitForAddress(5_000);
    const cancelAt = Date.now();
    let cancelledAt = 0;
    const observed = pending.then(
      () => {
        throw new Error("waitForAddress resolved while the restart loop was still failing");
      },
      (error: unknown) => {
        cancelledAt = Date.now();
        assert.match(error instanceof Error ? error.message : String(error), /stopped/);
      },
    );
    const bundle = new LocalGatewayLifecycleBundle({
      gateway: {},
      subagentManager: { async dispose() {} },
      subagentProviders: { async dispose() {} },
      registry: {
        async disposeSessionMcpRuntimes() {},
        async disposeProjectRuntimes() {},
      },
      telemetry: { async dispose() {} },
      stopConfigWatching() {},
      stopExtensionWatching() {},
      stopTcpSupervisor: () => supervisor.stop(),
      warn() {},
    });
    await bundle.dispose();
    await observed;
    const cancelMs = cancelledAt - cancelAt;
    assert.ok(cancelMs < 1_500, `dispose did not cancel the in-flight wait within 1500ms (${cancelMs}ms)`);
    assert.equal(supervisor.address, undefined);
    console.log([
      "m1 failing-restart",
      `waitMs=${waitMs}`,
      `waitedMs=${waitedMs}`,
      `factoryMs=${factoryMs}`,
      `factoryElapsedMs=${factoryElapsedMs}`,
      `disposeCancelMs=${cancelMs}`,
    ].join(" "));
  } finally {
    await supervisor.stop();
    await rm(root, { recursive: true, force: true });
  }
});

const rustBin = process.env.PILOTDECK_T_P2_06_RUST_BIN
  ?? join(process.cwd(), "rust-core/target/release/pilotdeck-agent-loop-sidecar");
const rustBinSkip = rustSidecarSkipReason(rustBin);

test("rust-core sidecar is supervised across a crash with the hello token", {
  skip: rustBinSkip ?? false,
  timeout: 30_000,
}, async () => {
  const supervisor = startFromEnv({
    PATH: process.env.PATH,
    PILOTDECK_AGENT_LOOP_TRANSPORT: "tcp",
    PILOTDECK_RUST_SIDECAR_BIN: rustBin,
    PILOTDECK_AGENT_LOOP_TCP_TOKEN: TOKEN,
  });
  try {
    const address = await supervisor.start();
    assert.match(supervisor.outputTail(), /listening /);
    assert.equal(supervisor.outputTail().includes(TOKEN), false);
    const wrong = await roundTrip(address.port, {
      kind: "request",
      messageId: "hello-wrong",
      method: "hello",
      payload: { token: "nope" },
    });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.code, "UNAUTHENTICATED");
    assert.equal(JSON.stringify(wrong).includes(TOKEN), false);
    const hello = await roundTrip(address.port, {
      kind: "request",
      messageId: "hello-ok",
      method: "hello",
      payload: { token: TOKEN },
    });
    assert.equal(hello.ok, true);
    assert.equal(JSON.stringify(hello).includes(TOKEN), false);
    const execute = await roundTrip(address.port, {
      kind: "request",
      messageId: "exec-1",
      method: "execute",
      payload: {},
    });
    assert.equal(typeof execute, "object");
    assert.equal(JSON.stringify(execute).includes(TOKEN), false);
    const firstPid = requiredPid(supervisor);
    process.kill(firstPid, "SIGKILL");
    const restartedAt = Date.now();
    await waitFor(
      () => supervisor.pid !== undefined && supervisor.pid !== firstPid && supervisor.address !== undefined,
      AGENT_LOOP_TCP_SUPERVISOR_RESTART_LIMIT_MS,
    );
    assert.ok(Date.now() - restartedAt <= AGENT_LOOP_TCP_SUPERVISOR_RESTART_LIMIT_MS);
    const again = await roundTrip(supervisor.address!.port, {
      kind: "request",
      messageId: "hello-again",
      method: "hello",
      payload: { token: "nope" },
    });
    assert.equal(again.code, "UNAUTHENTICATED");
    assert.equal(JSON.stringify(again).includes(TOKEN), false);
    console.log([
      "rust-core probe",
      `listen=${address.host}:${address.port}`,
      `wrong=${String(wrong.code)}`,
      `hello=${String(hello.ok)}`,
      `executeKind=${String(execute.kind)}`,
      `executeCode=${String(execute.code)}`,
      `restartedPid=${String(supervisor.pid)}`,
      `again=${String(again.code)}`,
    ].join(" "));
    const accepted = await roundTrip(supervisor.address!.port, {
      kind: "request",
      messageId: "hello-again-ok",
      method: "hello",
      payload: { token: TOKEN },
    });
    assert.equal(accepted.ok, true);
  } finally {
    await supervisor.stop();
  }
});

async function assertSuperviseRestart(input: {
  mode: "rust-listen" | "ts-env-listen";
  env: Record<string, string | undefined>;
}): Promise<void> {
  const supervisor = startFromEnv(input.env);
  try {
    const profile = resolveAgentLoopDeploymentProfile({ env: input.env, cwd: process.cwd() });
    assert.equal(profile.transport, "tcp");
    if (profile.transport !== "tcp") return;
    assert.equal(profile.supervise?.launch.mode, input.mode);
    assert.throws(
      () => createAgentLoopDeploymentFactory(profile),
      /Start AgentLoopTcpSidecarSupervisor/,
    );
    const address = await supervisor.start();
    const factory = createAgentLoopDeploymentFactory(profile, { tcpSupervisor: supervisor });
    assert.equal(typeof factory, "function");
    assert.match(supervisor.outputTail(), new RegExp(`listening ${address.host.replaceAll(".", "\\.")}:${address.port}`));
    if (input.env.PILOTDECK_AGENT_LOOP_TCP_TOKEN) {
      assert.match(supervisor.outputTail(), /token-present=yes/);
      assert.equal(supervisor.outputTail().includes(TOKEN), false);
    }
    const first = await helloExecute(address.port, input.env.PILOTDECK_AGENT_LOOP_TCP_TOKEN);
    assert.equal(first.hello.ok, true);
    assert.equal(first.execute.code, "PROBE_EXECUTE");
    if (input.env.PILOTDECK_AGENT_LOOP_TCP_TOKEN) {
      const wrong = await roundTrip(address.port, {
        kind: "request",
        messageId: "hello-wrong",
        method: "hello",
        payload: { token: "nope" },
      });
      assert.equal(wrong.code, "UNAUTHENTICATED");
      assert.equal(JSON.stringify(wrong).includes(TOKEN), false);
    }
    const firstPid = requiredPid(supervisor);
    const killedAt = Date.now();
    process.kill(firstPid, "SIGKILL");
    await waitFor(
      () => supervisor.pid !== undefined && supervisor.pid !== firstPid && supervisor.address !== undefined,
      AGENT_LOOP_TCP_SUPERVISOR_RESTART_LIMIT_MS,
    );
    assert.ok(Date.now() - killedAt <= AGENT_LOOP_TCP_SUPERVISOR_RESTART_LIMIT_MS);
    assert.notEqual(supervisor.pid, firstPid);
    const secondAddress = supervisor.address!;
    const second = await helloExecute(secondAddress.port, input.env.PILOTDECK_AGENT_LOOP_TCP_TOKEN);
    assert.equal(second.hello.ok, true);
    assert.equal(second.execute.kind === "error" || second.execute.kind === "response", true);
  } finally {
    await supervisor.stop();
  }
}

function startFromEnv(
  env: Record<string, string | undefined>,
  options?: { readyTimeoutMs?: number },
): AgentLoopTcpSidecarSupervisor {
  const profile = resolveAgentLoopDeploymentProfile({ env, cwd: process.cwd() });
  if (profile.transport !== "tcp" || !profile.supervise) {
    throw new Error("expected a supervised tcp profile");
  }
  return new AgentLoopTcpSidecarSupervisor({
    host: profile.host,
    port: profile.port,
    launch: profile.supervise.launch,
    cwd: profile.supervise.cwd,
    env: profile.supervise.env,
    authToken: profile.authToken,
    ...(options?.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: options.readyTimeoutMs }),
  });
}

function rustSidecarSkipReason(binary: string): string | undefined {
  try {
    accessSync(binary, constants.X_OK);
    return undefined;
  } catch {
    return `rust-core sidecar binary is not executable at ${binary}`;
  }
}

async function helloExecute(port: number, token?: string): Promise<{
  hello: Record<string, unknown>;
  execute: Record<string, unknown>;
}> {
  const hello = await roundTrip(port, {
    kind: "request",
    messageId: "hello-ok",
    method: "hello",
    payload: token ? { token } : {},
  });
  const execute = await roundTrip(port, {
    kind: "request",
    messageId: "exec-1",
    method: "execute",
    payload: {},
  });
  return { hello, execute };
}

async function roundTrip(port: number, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.setNoDelay(true);
  const lines = createInterface({ input: socket, crlfDelay: Infinity });
  try {
    await onceConnect(socket);
    socket.write(`${JSON.stringify(message)}\n`);
    const line = await onceLine(lines);
    return JSON.parse(line) as Record<string, unknown>;
  } finally {
    lines.close();
    socket.destroy();
  }
}

function onceConnect(socket: ReturnType<typeof createConnection>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("connect timeout"));
    }, 1_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function onceLine(lines: ReturnType<typeof createInterface>): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for a sidecar response")), 2_000);
    lines.once("line", (line) => {
      clearTimeout(timer);
      resolve(line);
    });
    lines.once("close", () => {
      clearTimeout(timer);
      reject(new Error("sidecar closed before a response"));
    });
  });
}

function connect(port: number): Promise<void> {
  return onceConnect(createConnection({ host: "127.0.0.1", port }));
}

async function readListening(stream: NodeJS.ReadableStream | null): Promise<{ host: string; port: number }> {
  if (!stream) throw new Error("missing stderr");
  let pending = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no listening line: ${pending}`)), 5_000);
    stream.setEncoding?.("utf8");
    stream.on("data", (chunk: string | Buffer) => {
      pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of pending.split(/\r?\n/)) {
        const parsed = parseListeningAddress(line);
        if (!parsed) continue;
        clearTimeout(timer);
        resolve(parsed);
        return;
      }
    });
  });
}

async function reservePort(): Promise<number> {
  const server = (await import("node:net")).createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to reserve a port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = false;
  while (Date.now() <= deadline) {
    last = await predicate();
    if (last) return;
    await delay(20);
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

function requiredPid(supervisor: AgentLoopTcpSidecarSupervisor): number {
  const pid = supervisor.pid;
  if (pid === undefined) throw new Error("supervisor has no child pid");
  return pid;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
