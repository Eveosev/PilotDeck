#!/usr/bin/env node
// Test double for a loopback TCP sidecar. Speaks just enough Module Protocol
// for supervisor probes: listening line, hello token gate, execute response.
import { createInterface } from "node:readline";
import { createServer } from "node:net";

const token = (process.env.PILOTDECK_AGENT_LOOP_TCP_TOKEN ?? "").trim();

const spec = readListenSpec(process.argv.slice(2));
const { host, port } = splitHostPort(spec);
const server = createServer((socket) => {
  socket.setNoDelay(true);
  const lines = createInterface({ input: socket, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      socket.write(`${JSON.stringify({
        kind: "error",
        messageId: "malformed",
        code: "INVALID_MESSAGE",
        message: "malformed json",
        retryability: "unsafe",
      })}\n`);
      return;
    }
    if (message.method === "hello") {
      const provided = typeof message.payload?.token === "string" ? message.payload.token : "";
      if (token && provided !== token) {
        socket.write(`${JSON.stringify({
          kind: "response",
          messageId: "hello-reject",
          inReplyTo: message.messageId,
          ok: false,
          code: "UNAUTHENTICATED",
        })}\n`);
        return;
      }
      socket.write(`${JSON.stringify({
        kind: "response",
        messageId: "hello-ok",
        inReplyTo: message.messageId,
        ok: true,
        protocolVersion: "2.0",
        moduleId: "pilotdeck-agent-loop",
        payload: {},
      })}\n`);
      return;
    }
    if (message.method === "execute") {
      socket.write(`${JSON.stringify({
        kind: "error",
        messageId: "execute-probe",
        code: "PROBE_EXECUTE",
        message: "execute probe accepted",
        retryability: "unsafe",
      })}\n`);
    }
  });
});

server.listen({ host, port }, () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    console.error("fake sidecar failed to bind");
    process.exit(1);
  }
  console.error(`supervisor-proof token-present=${token ? "yes" : "no"}`);
  console.error(`listening ${address.address}:${address.port}`);
});

function readListenSpec(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--listen") return required(args[index + 1], "--listen requires HOST:PORT");
    if (arg.startsWith("--listen=")) return arg.slice("--listen=".length);
  }
  const envPort = (process.env.PILOTDECK_AGENT_LOOP_TCP_PORT ?? "").trim();
  if (envPort) {
    const envHost = (process.env.PILOTDECK_AGENT_LOOP_TCP_HOST ?? "127.0.0.1").trim();
    return `${envHost}:${envPort}`;
  }
  console.error("fake sidecar: missing --listen or PILOTDECK_AGENT_LOOP_TCP_PORT");
  process.exit(2);
}

function splitHostPort(spec) {
  if (spec.startsWith("[")) {
    const end = spec.indexOf("]");
    return { host: spec.slice(1, end), port: Number(spec.slice(end + 2)) };
  }
  const index = spec.lastIndexOf(":");
  return { host: spec.slice(0, index), port: Number(spec.slice(index + 1)) };
}

function required(value, message) {
  if (!value) {
    console.error(message);
    process.exit(2);
  }
  return value;
}
