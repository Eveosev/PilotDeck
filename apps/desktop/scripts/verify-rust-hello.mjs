#!/usr/bin/env node
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  MODULE_PROTOCOL_VERSION,
  buildRustHello,
  rustHelloDest,
} from "./rust-hello.mjs";

function fail(message) {
  console.error(`[verify-rust-hello] ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function nonEmpty(value, name) {
  assert(typeof value === "string" && value.length > 0, `handshake is missing ${name}`);
  return value;
}

const desktopPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const extraResources = desktopPackage.build?.extraResources ?? [];
assert(
  extraResources.some((entry) => entry.from === "resources/rust" && entry.to === "rust"),
  'package.json build.extraResources must include { "from": "resources/rust", "to": "rust" }',
);
const signIgnore = desktopPackage.build?.mac?.signIgnore ?? [];
assert(
  !signIgnore.some((entry) => String(entry).toLowerCase().includes("rust")),
  "mac.signIgnore must not include a rust path",
);
assert(
  signIgnore.length === 1
    && String(signIgnore[0]).includes("playwright-core")
    && String(signIgnore[0]).includes(".local-browsers"),
  "mac.signIgnore must remain only the playwright browsers path",
);

if (!existsSync(rustHelloDest)) {
  console.log("[verify-rust-hello] binary missing; running build-runtime rust substep (cargo build --release + copy)");
  buildRustHello({ requireCargo: true });
}
assert(existsSync(rustHelloDest), `rust hello binary missing: ${rustHelloDest}`);

const child = spawn(rustHelloDest, [], {
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr?.on("data", (chunk) => {
  stderr += chunk.toString();
});
child.on("error", (error) => fail(`failed to spawn ${rustHelloDest}: ${error.message}`));

const pending = [];
const waiters = [];
let closed = false;
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  if (waiters.length > 0) waiters.shift()(line);
  else pending.push(line);
});
lines.on("close", () => {
  closed = true;
});

function nextLine(timeoutMs = 8_000) {
  if (pending.length > 0) return Promise.resolve(pending.shift());
  if (closed) return Promise.reject(new Error(`sidecar closed stdout before handshake finished.\n${stderr}`));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for sidecar JSONL.\n${stderr}`));
    }, timeoutMs);
    waiters.push((line) => {
      clearTimeout(timer);
      resolve(line);
    });
  });
}

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function parseMessage(line) {
  try {
    return JSON.parse(line);
  } catch {
    fail(`sidecar emitted non-JSON: ${line}`);
  }
}

function acceptHandshake(message, expectedId, phase, expectedBinding) {
  assert(message.kind === "response", `${phase} response kind must be "response"`);
  assert(message.inReplyTo === expectedId, `${phase} response inReplyTo must match the request messageId`);
  assert(message.ok === true, `${phase} was rejected: ${message.code ?? message.error?.message ?? "unknown error"}`);
  assert(
    message.protocolVersion === MODULE_PROTOCOL_VERSION,
    `${phase} protocolVersion is unsupported: ${message.protocolVersion ?? "missing"}`,
  );
  const binding = {
    moduleId: nonEmpty(message.moduleId, "moduleId"),
    moduleInstanceId: nonEmpty(message.moduleInstanceId, "moduleInstanceId"),
    connectionGeneration: nonEmpty(message.connectionGeneration, "connectionGeneration"),
    capabilitiesVersion: nonEmpty(message.capabilitiesVersion, "capabilitiesVersion"),
  };
  if (expectedBinding) {
    assert(
      binding.moduleId === expectedBinding.moduleId
        && binding.moduleInstanceId === expectedBinding.moduleInstanceId
        && binding.connectionGeneration === expectedBinding.connectionGeneration
        && binding.capabilitiesVersion === expectedBinding.capabilitiesVersion,
      "sidecar changed its binding during handshake",
    );
  }
  return binding;
}

const helloMessageId = `hello-${randomUUID()}`;
const capabilitiesMessageId = `capabilities-${randomUUID()}`;

try {
  send({
    kind: "request",
    messageId: helloMessageId,
    method: "hello",
    payload: {},
  });
  const hello = acceptHandshake(parseMessage(await nextLine()), helloMessageId, "hello");

  send({
    kind: "request",
    messageId: capabilitiesMessageId,
    method: "capabilities",
    payload: {},
  });
  const capabilities = parseMessage(await nextLine());
  acceptHandshake(capabilities, capabilitiesMessageId, "capabilities", hello);
  const payload = capabilities.payload;
  assert(payload && typeof payload === "object" && !Array.isArray(payload), "capabilities payload must be an object");
  assert(
    payload.capabilitiesVersion === hello.capabilitiesVersion,
    "capabilities payload does not match the hello binding",
  );
  assert(Array.isArray(payload.methods), "capabilities payload must include a methods array");
  assert(payload.transport === "stdio", `expected transport=stdio, got ${String(payload.transport)}`);

  console.log("[verify-rust-hello] PASS existence + hello→capabilities transport=stdio");
  console.log(`[verify-rust-hello] binary=${rustHelloDest}`);
  console.log(`[verify-rust-hello] moduleId=${hello.moduleId}`);
  console.log(`[verify-rust-hello] moduleInstanceId=${hello.moduleInstanceId}`);
  console.log(`[verify-rust-hello] connectionGeneration=${hello.connectionGeneration}`);
  console.log(`[verify-rust-hello] capabilitiesVersion=${hello.capabilitiesVersion}`);
  process.exitCode = 0;
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  try {
    child.stdin.end();
  } catch {
    // Process may already have closed stdin.
  }
  const deadline = Date.now() + 3_000;
  while (child.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (child.exitCode === null) {
    child.kill("SIGTERM");
  }
}
