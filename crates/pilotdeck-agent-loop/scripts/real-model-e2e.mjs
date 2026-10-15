#!/usr/bin/env node
/**
 * One Rust sidecar turn through the production host model runtime.
 *
 * This is not the parity harness `--model-ms` mock. The host answers
 * `module_call` prepare / stream_next / close_stream by calling
 * `createModelRuntime` → `streamModel`.
 *
 * Live provider (keys stay in the environment; this script never prints them):
 *
 *   PILOTDECK_REAL_MODEL_PROVIDER=openai|anthropic|google \
 *   PILOTDECK_REAL_MODEL=<model id> \
 *   OPENAI_API_KEY=...            # or ANTHROPIC_API_KEY / GEMINI_API_KEY / GOOGLE_API_KEY
 *   # optional: PILOTDECK_REAL_MODEL_BASE_URL=https://...
 *   node crates/pilotdeck-agent-loop/scripts/real-model-e2e.mjs \
 *     --bin target/debug/pilotdeck-agent-loop
 *
 * With no key, the same production `streamModel` path runs against an in-process
 * fetch that returns one OpenAI-compatible SSE completion. Provenance says
 * credential=absent. Do not treat that run as a billed provider call.
 */
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Production model sources use TypeScript parameter properties. Node's
// strip-only loader cannot load them. `tsx` is already a repo devDependency
// and rewrites `.js` specifiers onto the `.ts` sources.
if (process.env.PILOTDECK_REAL_MODEL_E2E_TSX !== "1") {
  let tsxCli;
  try {
    tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  } catch (error) {
    console.error(
      "real-model-e2e needs the repo devDependency tsx (and runtime deps jsonrepair, undici, @google/genai). Install them with the repo package manager before running this script.",
    );
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const replayed = spawnSync(process.execPath, [tsxCli, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, PILOTDECK_REAL_MODEL_E2E_TSX: "1" },
  });
  process.exit(replayed.status ?? 1);
}
const repoRoot = resolve(here, "..", "..", "..");
const { createModelRuntime } = await import(pathToFileURL(resolve(repoRoot, "src/model/ModelRuntime.ts")).href);
const { parseModelConfig } = await import(pathToFileURL(resolve(repoRoot, "src/model/config/parseModelConfig.ts")).href);
const { createNativeRetryPolicy } = await import(pathToFileURL(resolve(repoRoot, "src/model/policy/RetryPolicy.ts")).href);

const bin = argValue("--bin") ?? resolve(repoRoot, "target/debug/pilotdeck-agent-loop");
const live = resolveLiveProvider();
const providerId = live?.providerId ?? "openai";
const modelId = live?.modelId ?? "p2-fixture";
const config = parseModelConfig({
  providers: {
    [providerId]: {
      protocol: live?.protocol ?? "openai",
      url: live?.url ?? "http://127.0.0.1",
      apiKey: live?.apiKey ?? "fixture-not-a-secret",
      models: { [modelId]: {} },
      retry: { streamMaxRetries: 0, requestMaxRetries: 0, streamIdleTimeoutMs: 30_000 },
    },
  },
}, process.env);
const runtime = createModelRuntime(config, {
  ...(live ? {} : { fetch: fixtureFetch() }),
  retryPolicy: createNativeRetryPolicy({ defaultMaxRetries: 0 }),
});

const child = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
const incoming = [];
const waiters = [];
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    fail(`sidecar emitted non-JSON: ${line} (${error})`);
  }
  incoming.push(message);
  if (message.kind === "request" && message.method === "module_call") {
    void answerModuleCall(message).catch((error) => fail(error instanceof Error ? error.message : String(error)));
  }
  settleWaiters();
});

const streams = new Map();
send({ kind: "request", messageId: "hello-1", method: "hello", payload: {} });
send({ kind: "request", messageId: "caps-1", method: "capabilities", payload: {} });
await waitFor((messages) => messages.some((message) => message.inReplyTo === "caps-1"));
send({
  kind: "request",
  messageId: "ex-real",
  method: "execute",
  runId: "run-real",
  operationId: "op-real",
  requestId: "req-real",
  sessionId: "sess-real",
  turnId: "turn-real",
  payload: {
    agent: { provider: providerId, model: modelId },
    messages: [{ role: "user", content: [{ type: "text", text: "Reply with the single word pong." }] }],
    hostModules: { model: { methods: ["prepare", "stream_next", "close_stream"] } },
    moduleCallTimeoutMs: 60_000,
  },
});
await waitFor((messages) => messages.some((message) => message.kind === "event" && message.final === true), live ? 60_000 : 15_000);

const terminal = incoming.find((message) => message.kind === "event" && message.final === true);
const assistant = [...incoming].reverse().find((message) => message.eventType === "agent.assistant_message");
const text = assistant?.payload?.message?.content?.find((block) => block?.type === "text")?.text ?? "";
const prepares = incoming.filter((message) => message.kind === "request" && message.module === "model" && message.payload?.operation === "prepare");
const pulls = incoming.filter((message) => message.kind === "request" && message.module === "model" && message.payload?.operation === "stream_next");
const report = {
  ok: terminal?.outcome === "completed" && typeof text === "string" && text.length > 0 && prepares.length >= 1 && pulls.length >= 1,
  task: "T-P2-01",
  transport: "stdio",
  outcome: terminal?.outcome ?? null,
  code: terminal?.code ?? null,
  mockModelMs: false,
  providerPath: "host module_call prepare/stream_next -> createModelRuntime/streamModel",
  credential: live ? "environment" : "absent",
  provider: providerId,
  model: modelId,
  protocol: live?.protocol ?? "openai",
  assistantText: text,
  prepareCount: prepares.length,
  streamNextCount: pulls.length,
};
if (!report.ok) {
  console.error(JSON.stringify({ report, stderr, tail: incoming.slice(-8) }, null, 2));
}
console.log(JSON.stringify(report));
child.kill();
await new Promise((resolvePromise) => child.once("exit", resolvePromise));
process.exit(report.ok ? 0 : 1);

function resolveLiveProvider() {
  const requested = (process.env.PILOTDECK_REAL_MODEL_PROVIDER ?? "").trim().toLowerCase();
  const modelId = (process.env.PILOTDECK_REAL_MODEL ?? "").trim();
  const url = (process.env.PILOTDECK_REAL_MODEL_BASE_URL ?? "").trim();
  const candidates = [
    { providerId: "openai", protocol: "openai", env: "OPENAI_API_KEY", url: "https://api.openai.com/v1" },
    { providerId: "anthropic", protocol: "anthropic", env: "ANTHROPIC_API_KEY", url: "https://api.anthropic.com" },
    { providerId: "google", protocol: "google", env: "GEMINI_API_KEY", url: "https://generativelanguage.googleapis.com" },
    { providerId: "google", protocol: "google", env: "GOOGLE_API_KEY", url: "https://generativelanguage.googleapis.com" },
  ];
  const selected = requested
    ? candidates.find((candidate) => candidate.providerId === requested || candidate.protocol === requested)
    : candidates.find((candidate) => process.env[candidate.env]?.trim());
  const apiKey = selected ? process.env[selected.env]?.trim() : "";
  if (!selected || !apiKey) return null;
  if (!modelId) {
    fail(`Set PILOTDECK_REAL_MODEL when ${selected.env} is present. This script does not pick a model id.`);
  }
  return {
    providerId: selected.providerId,
    protocol: selected.protocol,
    modelId,
    apiKey,
    url: url || selected.url,
  };
}

function fixtureFetch() {
  const body = [
    'data: {"id":"chatcmpl-p2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"pong"},"finish_reason":null}]}',
    "",
    'data: {"id":"chatcmpl-p2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  return async () => new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function answerModuleCall(call) {
  const operation = call.payload?.operation;
  let payload;
  if (call.module === "model" && operation === "prepare") {
    const request = call.payload.request;
    payload = { prepared: { request, provider: request.provider, model: request.model } };
  } else if (call.module === "model" && operation === "stream_next") {
    const preparationId = call.payload.preparationId;
    let iterator = streams.get(preparationId);
    if (!iterator) {
      iterator = runtime.stream(call.payload.request)[Symbol.asyncIterator]();
      streams.set(preparationId, iterator);
    }
    const next = await iterator.next();
    if (next.done) {
      streams.delete(preparationId);
      payload = { events: [], done: true };
    } else {
      payload = { events: [next.value], done: false };
    }
  } else if (call.module === "model" && operation === "close_stream") {
    const iterator = streams.get(call.payload.preparationId);
    streams.delete(call.payload.preparationId);
    await iterator?.return?.();
    payload = { closed: true };
  } else {
    fail(`unexpected module_call ${call.module}.${operation}`);
  }
  send({
    kind: "response",
    messageId: `host-${call.messageId}`,
    inReplyTo: call.messageId,
    requestId: call.requestId,
    ok: true,
    payload,
  });
}

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function waitFor(pred, timeoutMs = 15_000) {
  if (pred(incoming)) return Promise.resolve(incoming.slice());
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for sidecar, have ${JSON.stringify(incoming.slice(-6))}\n${stderr}`));
    }, timeoutMs);
    waiters.push({
      pred,
      resolve: (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
    });
  });
}

function settleWaiters() {
  for (let index = waiters.length - 1; index >= 0; index -= 1) {
    if (waiters[index].pred(incoming)) {
      const waiter = waiters.splice(index, 1)[0];
      waiter.resolve(incoming.slice());
    }
  }
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message) {
  console.error(message);
  child.kill();
  process.exit(1);
}
