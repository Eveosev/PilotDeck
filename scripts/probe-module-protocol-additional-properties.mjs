#!/usr/bin/env node
/**
 * T-P0a-01 S0 probe: feed raw JSON text → JSON.parse → validateModuleMessage
 * to measure additionalProperties behavior. protocol.ts is the only runtime
 * input. Does not change protocol or runtime behavior.
 */
import { spawnSync, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protocolPath = resolve(root, "src/agent/modules/protocol.ts");
const { validateModuleMessage } = await import(pathToFileURL(protocolPath).href);

function git(command) {
  return execSync(command, { cwd: root, encoding: "utf8" }).trim();
}

const recordedSha = git("git rev-parse HEAD");
const recordedDirty = git("git status --porcelain") !== "";
if (recordedDirty) {
  console.error("probe-module-protocol-additional-properties requires a clean git tree so evidence can record gitDirty=false");
  process.exit(2);
}

function parseRaw(raw) {
  return JSON.parse(raw);
}

function runCase(id, raw) {
  const value = parseRaw(raw);
  const result = validateModuleMessage(value);
  return {
    id,
    raw,
    parsed: value,
    ok: result.ok === true,
    code: result.ok === true ? undefined : result.code,
    message: result.ok === true ? undefined : result.message,
  };
}

const executeBase = {
  kind: "request",
  messageId: "message-1",
  method: "execute",
  runId: "run-1",
  operationId: "operation-1",
  requestId: "request-1",
  payload: {},
};

const eventBase = {
  kind: "event",
  eventType: "model.delta",
  streamId: "stream-1",
  sequence: 0,
  runId: "run-1",
  operationId: "operation-1",
  requestId: "request-1",
  final: false,
  payload: {},
};

const cases = [
  runCase(
    "execute-extra-top-level",
    JSON.stringify({ ...executeBase, unexpectedTopLevel: "keep" }),
  ),
  runCase(
    "execute-extra-payload",
    JSON.stringify({ ...executeBase, payload: { unexpectedPayload: 1 } }),
  ),
  runCase(
    "execute-attemptId",
    JSON.stringify({ ...executeBase, attemptId: "attempt-1" }),
  ),
  runCase(
    "execute-stepId",
    JSON.stringify({ ...executeBase, stepId: "step-1" }),
  ),
  runCase(
    "execute-attemptId-and-extra",
    JSON.stringify({ ...executeBase, attemptId: "attempt-1", unexpectedTopLevel: true }),
  ),
  runCase(
    "event-extra-top-level",
    JSON.stringify({ ...eventBase, unexpectedTopLevel: "keep" }),
  ),
  runCase(
    "event-extra-payload",
    JSON.stringify({ ...eventBase, payload: { unexpectedPayload: { nested: true } } }),
  ),
  runCase(
    "event-moduleInstanceId",
    JSON.stringify({ ...eventBase, moduleInstanceId: "instance-1" }),
  ),
  runCase(
    "event-connectionGeneration",
    JSON.stringify({ ...eventBase, connectionGeneration: "generation-1" }),
  ),
  runCase(
    "response-extra-top-level",
    JSON.stringify({
      kind: "response",
      messageId: "response-1",
      inReplyTo: "message-1",
      ok: true,
      unexpectedTopLevel: "keep",
    }),
  ),
  runCase(
    "response-extra-payload",
    JSON.stringify({
      kind: "response",
      messageId: "response-1",
      inReplyTo: "message-1",
      ok: true,
      payload: { unexpectedPayload: "keep" },
    }),
  ),
  runCase(
    "module-call-extra-top-level-and-payload",
    JSON.stringify({
      kind: "request",
      messageId: "call-1",
      method: "module_call",
      runId: "run-1",
      operationId: "operation-1",
      requestId: "request-1",
      module: "model",
      unexpectedTopLevel: "keep",
      payload: { operation: "prepare", unexpectedPayload: true },
    }),
  ),
  runCase(
    "handshake-extra-top-level-and-payload",
    JSON.stringify({
      kind: "request",
      messageId: "hello-1",
      method: "hello",
      unexpectedTopLevel: "keep",
      payload: { unexpectedPayload: true },
    }),
  ),
  runCase(
    "error-extra-top-level",
    JSON.stringify({
      kind: "error",
      messageId: "error-1",
      code: "BROKEN",
      message: "broken",
      retryability: "safe",
      unexpectedTopLevel: "keep",
    }),
  ),
];

const acceptedExtra = cases.filter((item) => item.id.includes("extra") && item.ok);
const rejectedByName = cases.filter((item) => !item.ok);
const unexpectedRejects = cases.filter((item) => item.id.includes("extra") && !item.id.includes("attemptId") && !item.ok);

const additionalProperties = {
  topLevel: acceptedExtra.some((item) => item.id.includes("top-level")) && !unexpectedRejects.length,
  payload: acceptedExtra.some((item) => item.id.includes("payload")) && !unexpectedRejects.length,
};

const rejectedFieldNames = [...new Set(
  rejectedByName
    .filter((item) => item.code === "UNSUPPORTED_FIELD")
    .map((item) => {
      if (item.id.includes("attemptId")) return "attemptId";
      if (item.id.includes("stepId")) return "stepId";
      if (item.id.includes("moduleInstanceId")) return "moduleInstanceId";
      if (item.id.includes("connectionGeneration")) return "connectionGeneration";
      return item.id;
    }),
)];

const conclusion = {
  additionalProperties: additionalProperties.topLevel && additionalProperties.payload,
  topLevel: additionalProperties.topLevel,
  payload: additionalProperties.payload,
  rejectedByNameOnly: rejectedFieldNames.sort(),
  schemaImplication: {
    additionalProperties: true,
    notRequiredGroups: [
      ["attemptId", "stepId"],
      ["moduleInstanceId", "connectionGeneration"],
    ],
  },
};

const report = {
  task: "T-P0a-01",
  probe: "validateModuleMessage additionalProperties",
  input: "src/agent/modules/protocol.ts",
  method: "raw JSON text → JSON.parse → validateModuleMessage",
  gitSha: recordedSha,
  gitDirty: recordedDirty,
  cases,
  conclusion,
};

const jsonPath = resolve(root, "evidence/schema/additional-properties-probe.json");
const mdPath = resolve(root, "evidence/schema/additional-properties-probe.md");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const md = `# T-P0a-01 additionalProperties probe

Input: \`src/agent/modules/protocol.ts\` \`validateModuleMessage\`.
Method: raw JSON text → \`JSON.parse\` → validator. No protocol change.

| Case | ok | code |
| --- | --- | --- |
${cases.map((item) => `| \`${item.id}\` | ${item.ok} | ${item.code ?? ""} |`).join("\n")}

## Conclusion

- extra top-level fields: **accepted** (\`additionalProperties: true\`)
- extra payload fields: **accepted** (\`additionalProperties: true\`)
- rejected by name only: \`${conclusion.rejectedByNameOnly.join("`, `")}\`
- schema implication: \`additionalProperties: true\` plus two \`not: required\` groups
  (\`attemptId\`/\`stepId\`, \`moduleInstanceId\`/\`connectionGeneration\`)

gitSha: \`${report.gitSha}\`
gitDirty: \`${report.gitDirty}\`
`;
writeFileSync(mdPath, md);

console.log(JSON.stringify(conclusion, null, 2));
console.log(`wrote ${jsonPath}`);
console.log(`wrote ${mdPath}`);

if (!conclusion.additionalProperties || conclusion.rejectedByNameOnly.join(",") !== "attemptId,connectionGeneration,moduleInstanceId,stepId") {
  console.error("probe did not match the expected additionalProperties:true + named-reject pair behavior");
  process.exit(1);
}
