#!/usr/bin/env node
/**
 * S4 / B4 TS host: spawn Rust `--listen 127.0.0.1:0`, then speak the sidecar
 * protocol over TCP (hello → capabilities → execute → status → cancel),
 * validating every emitted frame with validateModuleMessage (ajv strict too).
 *
 * This is not a hello→execute→status-only smoke.
 */
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.execArgv.some((flag) => flag.includes("strip-types"))) {
  const replayed = spawnSync(
    process.execPath,
    ["--experimental-strip-types", ...process.argv.slice(1)],
    { stdio: "inherit" },
  );
  process.exit(replayed.status ?? 1);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const { compileSchema, schemaAccepts, SCHEMA_PATH, PROTOCOL_PATH } = await import(
  pathToFileURL(resolve(repoRoot, "scripts/lib/module-protocol-schema.mjs")).href
);
const { validateModuleMessage } = await import(pathToFileURL(PROTOCOL_PATH).href);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const schemaValidate = compileSchema(schema);

const bin = process.argv.find((arg, index, all) => all[index - 1] === "--bin")
  ?? resolve(repoRoot, "target/debug/pilotdeck-agent-loop");

const child = spawn(bin, ["--listen", "127.0.0.1:0"], {
  stdio: ["ignore", "ignore", "pipe"],
});

const address = await waitForListen(child);
const socket = await connect(address);
const incoming = [];
const lines = createInterface({ input: socket, crlfDelay: Infinity });
const waiters = [];

lines.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  incoming.push(message);
  for (let i = waiters.length - 1; i >= 0; i -= 1) {
    if (waiters[i].pred(incoming)) {
      waiters[i].resolve(incoming.slice());
      waiters.splice(i, 1);
    }
  }
});

function send(message) {
  socket.write(`${JSON.stringify(message)}\n`);
}

function waitFor(pred, timeoutMs = 3_000) {
  if (pred(incoming)) return Promise.resolve(incoming.slice());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for sidecar TCP, have: ${JSON.stringify(incoming)}`));
    }, timeoutMs);
    waiters.push({
      pred,
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
    });
  });
}

function reply(id) {
  return incoming.find((message) => message.inReplyTo === id);
}

send({ kind: "request", messageId: "hello-1", method: "hello", payload: {} });
send({ kind: "request", messageId: "caps-1", method: "capabilities", payload: {} });
await waitFor((msgs) => msgs.some((m) => m.inReplyTo === "caps-1"));

send({
  kind: "request",
  messageId: "ex-slow",
  method: "execute",
  runId: "run-c",
  operationId: "op-c",
  requestId: "req-c",
  sessionId: "sess-c",
  turnId: "turn-c",
  payload: { scenario: "pure_text", delayMs: 10_000, q: "What is the status?" },
});
await waitFor((msgs) => msgs.some((m) => m.inReplyTo === "ex-slow"));

send({ kind: "request", messageId: "st-run", method: "status", requestId: "req-c" });
await waitFor((msgs) => msgs.some((m) => m.inReplyTo === "st-run"));

send({
  kind: "request",
  messageId: "cancel-1",
  method: "cancel",
  runId: "run-c",
  operationId: "op-c",
  requestId: "req-c",
  reason: "user_cancelled",
});
send({
  kind: "request",
  messageId: "resume-1",
  method: "resume",
  streamId: "stream-1",
  previousBinding: { moduleInstanceId: "i", connectionGeneration: "c" },
  lastAppliedSequence: -1,
});
send({
  kind: "request",
  messageId: "ack-1",
  method: "ack",
  streamId: "stream-1",
  lastAppliedSequence: 0,
});

await waitFor((msgs) =>
  msgs.some((m) => m.kind === "event" && m.final === true)
  && msgs.some((m) => m.inReplyTo === "cancel-1")
  && msgs.some((m) => m.inReplyTo === "resume-1")
  && msgs.some((m) => m.inReplyTo === "ack-1"));

send({ kind: "request", messageId: "st-done", method: "status", requestId: "req-c" });
await waitFor((msgs) => msgs.some((m) => m.inReplyTo === "st-done"));

send({ kind: "request", messageId: "hello-bad", method: "hello" });
await waitFor((msgs) => msgs.some((m) => m.code === "INVALID_HANDSHAKE_REQUEST"));

const terminal = incoming.find((m) => m.kind === "event" && m.final === true);
let mismatch = 0;
let tsAccept = 0;
let schemaAccept = 0;
for (const message of incoming) {
  const tsOk = validateModuleMessage(message).ok === true;
  const schemaOk = schemaAccepts(schemaValidate, message);
  if (tsOk) tsAccept += 1;
  if (schemaOk) schemaAccept += 1;
  if (tsOk !== schemaOk) mismatch += 1;
}

const report = {
  ok: true,
  listen: `${address.address}:${address.port}`,
  transport: reply("caps-1")?.payload?.transport ?? null,
  helloOk: reply("hello-1")?.ok === true,
  capabilitiesOk: reply("caps-1")?.ok === true,
  executeAccepted: reply("ex-slow")?.ok === true,
  statusRunning: reply("st-run")?.ok === true,
  cancelOk: reply("cancel-1")?.ok === true,
  resumeCode: reply("resume-1")?.code ?? null,
  ackCode: reply("ack-1")?.code ?? null,
  statusAfterCancel: reply("st-done")?.payload?.outcome ?? null,
  terminalOutcome: terminal?.outcome ?? null,
  abortedType: terminal?.payload?.result?.type ?? null,
  sessionId: terminal?.payload?.result?.sessionId ?? null,
  turnId: terminal?.payload?.result?.turnId ?? null,
  mismatch,
  tsAccept,
  schemaAccept,
  total: incoming.length,
  ajvStrict: true,
};

const failed = !(
  report.helloOk
  && report.capabilitiesOk
  && report.executeAccepted
  && report.statusRunning
  && report.cancelOk
  && report.resumeCode === "RESUME_UNSUPPORTED"
  && report.ackCode === "ACK_UNSUPPORTED"
  && report.statusAfterCancel === "cancelled"
  && report.terminalOutcome === "cancelled"
  && report.abortedType === "aborted"
  && report.sessionId === "sess-c"
  && report.turnId === "turn-c"
  && report.transport === "tcp"
  && mismatch === 0
  && incoming.length > 0
);
if (failed) report.ok = false;

console.log(JSON.stringify(report, null, 2));
socket.destroy();
child.kill();
await new Promise((resolve) => child.once("exit", resolve));
process.exit(failed ? 1 : 0);

function waitForListen(proc) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sidecar did not print listening address")), 10_000);
    let buf = "";
    proc.stderr.on("data", (chunk) => {
      buf += chunk.toString();
      const match = buf.match(/listening\s+(\S+)/);
      if (match) {
        clearTimeout(timer);
        const [host, port] = match[1].split(":");
        resolve({ address: host, port: Number(port) });
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`sidecar exited before listen (${code}): ${buf}`));
    });
  });
}

function connect(addr) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: addr.address, port: addr.port });
    socket.setNoDelay(true);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}
