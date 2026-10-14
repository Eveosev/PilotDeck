#!/usr/bin/env node
/**
 * T-P1-02 connect-only TS host.
 *
 * Does not spawn a sidecar and does not read SIDECAR_COMMAND / SIDECAR_PATH.
 * Resolves the same TCP profile as `src/cli/AgentLoopDeploymentProfile.ts`
 * (TRANSPORT / TCP_HOST / TCP_PORT) and TCP-connects by *mirroring*
 * `createTcpAgentLoopSidecarConnectionFactory` (AgentLoopDeploymentProfile.ts:84-93
 * / tcpAgentLoopSidecarConnection.ts:56-57): `createConnection({ host, port })`
 * + `setNoDelay`. This file does not import or call the factory. No spawn.
 *
 * Dialogue: hello → execute → status. No capabilities/cancel/resume/ack,
 * no real model. Wraps the #18 `b4-tcp-host.mjs` listen/connect pattern
 * into a hello→execute→status-only host.
 */
import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.execArgv.some((flag) => flag.includes("strip-types"))) {
  const replayed = spawnSync(
    process.execPath,
    ["--experimental-strip-types", ...process.argv.slice(1)],
    { stdio: "inherit", env: process.env },
  );
  process.exit(replayed.status ?? 1);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

assertConnectOnly();
if (process.env.T_P1_02_FORCE_HOST_FAIL === "1") {
  throw new Error("T-P1-02 forced host failure (T_P1_02_FORCE_HOST_FAIL=1).");
}
const profile = resolveTcpProfile(process.env);

const { validateModuleMessage } = await import(
  pathToFileURL(resolve(repoRoot, "src/agent/modules/protocol.ts")).href
);

const socket = await connect(profile);
const incoming = [];
const waiters = [];
const lines = createInterface({ input: socket, crlfDelay: Infinity });

lines.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    for (const waiter of waiters.splice(0)) {
      if (typeof waiter.reject === "function") waiter.reject(error);
    }
    return;
  }
  incoming.push(message);
  for (let i = waiters.length - 1; i >= 0; i -= 1) {
    if (waiters[i].pred(incoming)) {
      waiters[i].resolve(incoming.slice());
      waiters.splice(i, 1);
    }
  }
});
socket.on("error", (error) => {
  for (const waiter of waiters.splice(0)) {
    if (typeof waiter.reject === "function") waiter.reject(error);
  }
});

function send(message) {
  socket.write(`${JSON.stringify(message)}\n`);
}

function waitFor(pred, timeoutMs = 5_000) {
  if (pred(incoming)) return Promise.resolve(incoming.slice());
  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for sidecar TCP, have: ${JSON.stringify(incoming)}`));
    }, timeoutMs);
    waiters.push({
      pred,
      resolve: (value) => {
        clearTimeout(timer);
        resolveWait(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
}

function reply(id) {
  return incoming.find((message) => message.inReplyTo === id);
}

const executeIds = {
  messageId: "ex-t-p1-02",
  runId: "run-t-p1-02",
  operationId: "op-t-p1-02",
  requestId: "req-t-p1-02",
  sessionId: "sess-t-p1-02",
  turnId: "turn-t-p1-02",
};

send({ kind: "request", messageId: "hello-t-p1-02", method: "hello", payload: {} });
await waitFor((msgs) => msgs.some((m) => m.inReplyTo === "hello-t-p1-02"));

send({
  kind: "request",
  messageId: executeIds.messageId,
  method: "execute",
  runId: executeIds.runId,
  operationId: executeIds.operationId,
  requestId: executeIds.requestId,
  sessionId: executeIds.sessionId,
  turnId: executeIds.turnId,
  payload: { scenario: "pure_text", delayMs: 80, q: "What is the status?" },
});
await waitFor((msgs) => msgs.some((m) => m.inReplyTo === executeIds.messageId));

send({
  kind: "request",
  messageId: "st-t-p1-02",
  method: "status",
  requestId: executeIds.requestId,
});
await waitFor((msgs) =>
  msgs.some((m) => m.inReplyTo === "st-t-p1-02")
  && msgs.some((m) => m.kind === "event" && m.final === true));

const terminal = incoming.find((m) => m.kind === "event" && m.final === true);
let mismatch = 0;
let tsAccept = 0;
for (const message of incoming) {
  const tsOk = validateModuleMessage(message).ok === true;
  if (tsOk) tsAccept += 1;
  else mismatch += 1;
}

const hello = reply("hello-t-p1-02");
const executed = reply(executeIds.messageId);
const status = reply("st-t-p1-02");

const report = {
  ok: true,
  task: "T-P1-02",
  role: "host",
  connectOnly: true,
  spawn: false,
  sidecarCommand: process.env.PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND ?? null,
  sidecarPath: process.env.PILOTDECK_AGENT_LOOP_SIDECAR_PATH ?? null,
  transport: profile.transport,
  host: profile.host,
  port: profile.port,
  connect: "createConnection({ host, port }) + setNoDelay",
  mirrorsFactory: "AgentLoopDeploymentProfile.ts:84-93 (createTcpAgentLoopSidecarConnectionFactory)",
  connectFactoryUsed: false,
  profileSource: "src/cli/AgentLoopDeploymentProfile.ts",
  helloOk: hello?.ok === true,
  protocolVersion: hello?.protocolVersion ?? null,
  moduleId: hello?.moduleId ?? null,
  executeAccepted: executed?.ok === true && executed?.final !== true && typeof executed?.streamId === "string" && executed.streamId.length > 0,
  streamId: executed?.streamId ?? null,
  statusOk: statusMatches(status, executeIds),
  statusState: status?.payload?.state ?? null,
  statusOutcome: status?.payload?.outcome ?? null,
  statusRunId: status?.payload?.runId ?? null,
  statusOperationId: status?.payload?.operationId ?? null,
  terminalOk: terminalMatches(terminal, executeIds),
  terminalOutcome: terminal?.outcome ?? null,
  terminalEventType: terminal?.eventType ?? null,
  resultType: terminal?.payload?.result?.type ?? null,
  resultStopReason: terminal?.payload?.result?.stopReason ?? null,
  resultTurns: terminal?.payload?.result?.turns ?? null,
  sessionId: terminal?.payload?.result?.sessionId ?? null,
  turnId: terminal?.payload?.result?.turnId ?? null,
  tsAccept,
  mismatch,
  total: incoming.length,
  pid: process.pid,
};

const failed = !(
  report.connectOnly
  && report.spawn === false
  && report.sidecarCommand === null
  && report.helloOk
  && report.protocolVersion === "2.0"
  && report.moduleId === "pilotdeck-agent-loop"
  && report.executeAccepted
  && report.statusOk
  && report.terminalOk
  && report.terminalOutcome === "completed"
  && report.terminalEventType === "agent.execute.completed"
  && report.resultType === "success"
  && report.resultStopReason === "completed"
  && report.resultTurns === 1
  && report.sessionId === executeIds.sessionId
  && report.turnId === executeIds.turnId
  && mismatch === 0
  && incoming.length > 0
);
if (failed) report.ok = false;

console.log(JSON.stringify(report, null, 2));
socket.destroy();
process.exit(report.ok ? 0 : 1);

function assertConnectOnly() {
  const command = process.env.PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND?.trim();
  const sidecarPath = process.env.PILOTDECK_AGENT_LOOP_SIDECAR_PATH?.trim();
  if (command) {
    throw new Error(
      "T-P1-02 host is TCP connect-only; unset PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND.",
    );
  }
  if (sidecarPath) {
    throw new Error(
      "T-P1-02 host is TCP connect-only; unset PILOTDECK_AGENT_LOOP_SIDECAR_PATH.",
    );
  }
}

/**
 * Same TCP env contract as resolveAgentLoopDeploymentProfile
 * (AgentLoopDeploymentProfile.ts:50-58, :129-159).
 */
function resolveTcpProfile(env) {
  const transport = (env.PILOTDECK_AGENT_LOOP_TRANSPORT ?? "").trim().toLowerCase();
  if (transport !== "tcp") {
    throw new Error("PILOTDECK_AGENT_LOOP_TRANSPORT must be tcp for the T-P1-02 host.");
  }
  const host = requiredText(env.PILOTDECK_AGENT_LOOP_TCP_HOST ?? "127.0.0.1", "PILOTDECK_AGENT_LOOP_TCP_HOST");
  const port = requiredPort(env.PILOTDECK_AGENT_LOOP_TCP_PORT);
  return {
    transport,
    host,
    port,
    connectTimeoutMs: optionalPositiveInteger(env.PILOTDECK_AGENT_LOOP_CONNECT_TIMEOUT_MS),
  };
}

function requiredText(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  return normalized;
}

function requiredPort(value) {
  if (value === undefined || String(value).trim() === "") {
    throw new Error("PILOTDECK_AGENT_LOOP_TCP_PORT is required when transport is tcp.");
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PILOTDECK_AGENT_LOOP_TCP_PORT must be an integer between 1 and 65535.");
  }
  return parsed;
}

function optionalPositiveInteger(value) {
  if (value === undefined || String(value).trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("PILOTDECK_AGENT_LOOP_CONNECT_TIMEOUT_MS must be a positive integer.");
  }
  return parsed;
}

function statusMatches(status, ids) {
  if (!status || status.ok !== true || status.kind !== "response") return false;
  const payload = status.payload;
  if (!payload || typeof payload !== "object") return false;
  if (payload.runId !== ids.runId || payload.operationId !== ids.operationId) return false;
  if (!Array.isArray(payload.requestIds) || !payload.requestIds.includes(ids.requestId)) return false;
  if (payload.cancelRequested !== false) return false;
  if (payload.state === "running") return payload.outcome === undefined;
  if (payload.state === "completed") return payload.outcome === "completed";
  return false;
}

function terminalMatches(terminal, ids) {
  if (!terminal || terminal.kind !== "event" || terminal.final !== true) return false;
  if (terminal.outcome !== "completed" || terminal.eventType !== "agent.execute.completed") return false;
  if (terminal.runId !== ids.runId || terminal.operationId !== ids.operationId || terminal.requestId !== ids.requestId) {
    return false;
  }
  const result = terminal.payload?.result;
  if (!result || typeof result !== "object") return false;
  return result.type === "success"
    && result.sessionId === ids.sessionId
    && result.turnId === ids.turnId
    && result.stopReason === "completed"
    && result.turns === 1
    && typeof result.startedAt === "string"
    && typeof result.completedAt === "string";
}

function connect(addr) {
  return new Promise((resolveWait, reject) => {
    const timeoutMs = addr.connectTimeoutMs ?? 5_000;
    const sock = createConnection({ host: addr.host, port: addr.port });
    sock.setNoDelay(true);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`Timed out connecting to sidecar TCP server after ${timeoutMs}ms.`));
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      resolveWait(sock);
    });
    sock.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
