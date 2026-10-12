/**
 * Shared helpers for T-P0a-01: read protocol.ts, build the 2020-12 schema
 * that matches validateModuleMessage, and compare accept/reject decisions.
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const require = createRequire(import.meta.url);
export const AJV_VERSION = require("ajv/package.json").version;
export const JSON_SCHEMA_DRAFT = "2020-12";
export const JSON_SCHEMA_DRAFT_URL = "https://json-schema.org/draft/2020-12/schema";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PROTOCOL_REL = "src/agent/modules/protocol.ts";
export const PROTOCOL_PATH = resolve(ROOT, PROTOCOL_REL);
export const SCHEMA_REL = "evidence/schema/module-protocol.schema.json";
export const SCHEMA_PATH = resolve(ROOT, SCHEMA_REL);
export const SCENARIOS_PATH = resolve(ROOT, "tools/agent-loop-parity/scenarios.json");
export const PARITY_RUNNER_PATH = resolve(ROOT, "tools/agent-loop-parity/run.py");

export function git(command, options = {}) {
  return execSync(command, { cwd: ROOT, encoding: "utf8", ...options }).trim();
}

export function gitSha() {
  return git("git rev-parse HEAD");
}

export function gitDirty() {
  return git("git status --porcelain") !== "";
}

export function assertCleanTree(action) {
  const dirty = git("git status --porcelain");
  if (dirty) {
    throw new Error(`${action} refused: git tree is dirty\n${dirty}`);
  }
}

export function readProtocolSource() {
  return readFileSync(PROTOCOL_PATH, "utf8");
}

function mustMatch(source, regex, label) {
  const match = source.match(regex);
  if (!match) throw new Error(`protocol.ts is missing ${label}`);
  return match;
}

function extractQuotedList(block) {
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`protocol.ts is missing function ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`protocol.ts function ${name} is not closed`);
}

export function extractProtocolContract(source = readProtocolSource()) {
  const protocolVersion = mustMatch(
    source,
    /export const MODULE_PROTOCOL_VERSION = "([^"]+)" as const;/,
    "MODULE_PROTOCOL_VERSION",
  )[1];

  const moduleCallBlock = mustMatch(
    source,
    /const MODULE_CALL_TARGETS: ModuleCallRequest\["module"\]\[\] = \[([\s\S]*?)\];/,
    "MODULE_CALL_TARGETS",
  )[1];
  const moduleCallTargets = extractQuotedList(moduleCallBlock);
  if (moduleCallTargets.length < 8) {
    throw new Error(`MODULE_CALL_TARGETS is unexpectedly short: ${moduleCallTargets.join(",")}`);
  }

  const isOutcome = extractFunction(source, "isOutcome");
  const outcomes = extractQuotedList(isOutcome);
  if (outcomes.length !== 4) throw new Error(`isOutcome enum drifted: ${outcomes.join(",")}`);

  const validator = extractFunction(source, "validateModuleMessage");
  if (!validator.includes('if ("attemptId" in message || "stepId" in message)')) {
    throw new Error("validateModuleMessage lost the attemptId/stepId reject");
  }
  if (!validator.includes('if ("moduleInstanceId" in message || "connectionGeneration" in message)')) {
    throw new Error("validateModuleMessage lost the moduleInstanceId/connectionGeneration reject");
  }
  const outcomeGuards = validator.split("final === true && !isOutcome").length - 1;
  if (outcomeGuards < 2) {
    throw new Error("validateModuleMessage lost a final⇒outcome guard");
  }

  const retryability = [];
  for (const token of ["safe", "unsafe", "retry_after_status"]) {
    if (!validator.includes(`message.retryability !== "${token}"`)) {
      throw new Error(`validateModuleMessage lost retryability ${token}`);
    }
    retryability.push(token);
  }

  const methods = [];
  for (const match of validator.matchAll(/message\.method === "([^"]+)"/g)) {
    if (!methods.includes(match[1])) methods.push(match[1]);
  }
  const expectedMethods = ["execute", "module_call", "cancel", "status", "resume", "ack", "hello", "capabilities"];
  if (expectedMethods.some((method) => !methods.includes(method))) {
    throw new Error(`validateModuleMessage methods drifted: ${methods.join(",")}`);
  }

  for (const helper of ["isId", "isSequence", "isResumeSequence", "isBinding", "isOutcome", "isRecord"]) {
    extractFunction(source, helper);
  }

  if (!source.includes("capabilitiesVersion: string;") && !source.includes("capabilitiesVersion?: string;")) {
    throw new Error("protocol.ts lost capabilitiesVersion");
  }
  if (!source.includes("protocolVersion?: typeof MODULE_PROTOCOL_VERSION")) {
    throw new Error("protocol.ts lost protocolVersion on ModuleResponse");
  }
  if (!source.includes("storageConfigVersion?: string;")) {
    throw new Error("protocol.ts lost storageConfigVersion (must remain non-contract)");
  }

  return {
    protocolVersion,
    capabilitiesVersionField: "capabilitiesVersion",
    storageConfigVersionField: "storageConfigVersion",
    moduleCallTargets,
    outcomes,
    retryability,
    methods,
    validatorAnchors: {
      attemptIdStepId: true,
      moduleInstanceIdConnectionGeneration: true,
      finalImpliesOutcome: outcomeGuards,
    },
  };
}

function idSchema() {
  return { type: "string", minLength: 1 };
}

function payloadSchema() {
  return { type: "object", additionalProperties: true };
}

function forbiddenGroup(fields) {
  return {
    not: {
      anyOf: fields.map((field) => ({
        required: [field],
        properties: { [field]: true },
      })),
    },
  };
}

function optionalId() {
  return idSchema();
}

export function buildModuleProtocolSchema(contract = extractProtocolContract()) {
  const outcome = { type: "string", enum: [...contract.outcomes] };
  const sequence = { type: "integer", minimum: 0 };
  const resumeSequence = { type: "integer", minimum: -1 };
  const binding = {
    type: "object",
    additionalProperties: true,
    required: ["moduleInstanceId", "connectionGeneration"],
    properties: {
      moduleInstanceId: { $ref: "#/$defs/id" },
      connectionGeneration: { $ref: "#/$defs/id" },
    },
  };

  const finalImpliesOutcome = {
    if: { properties: { final: { const: true } }, required: ["final"] },
    then: { required: ["outcome"], properties: { outcome: { $ref: "#/$defs/outcome" } } },
  };
  const outcomeIfPresent = {
    if: { required: ["outcome"], properties: { outcome: true } },
    then: { properties: { outcome: { $ref: "#/$defs/outcome" } } },
  };

  const schema = {
    $schema: JSON_SCHEMA_DRAFT_URL,
    $id: "https://pilotdeck.dev/schema/module-protocol.schema.json",
    title: "PilotDeck agent-loop ↔ sidecar Module Protocol",
    description: [
      "Generated from src/agent/modules/protocol.ts validateModuleMessage only.",
      "JSON Schema draft 2020-12; additionalProperties true on message and payload",
      "(empirically matching the validator). x-pilotdeck.contractVersions are",
      "annotations only; this schema does not enforce protocolVersion or",
      "capabilitiesVersion. storageConfigVersion is not a contract version.",
    ].join(" "),
    type: "object",
    oneOf: [
      { $ref: "#/$defs/executeRequest" },
      { $ref: "#/$defs/moduleCallRequest" },
      { $ref: "#/$defs/cancelRequest" },
      { $ref: "#/$defs/statusRequest" },
      { $ref: "#/$defs/resumeRequest" },
      { $ref: "#/$defs/ackRequest" },
      { $ref: "#/$defs/handshakeRequest" },
      { $ref: "#/$defs/response" },
      { $ref: "#/$defs/event" },
      { $ref: "#/$defs/error" },
    ],
    "x-pilotdeck": {
      generatedFrom: PROTOCOL_REL,
      jsonSchemaDraft: JSON_SCHEMA_DRAFT,
      ajv: AJV_VERSION,
      additionalProperties: true,
      contractVersions: {
        protocolVersion: { field: "protocolVersion", value: contract.protocolVersion },
        capabilitiesVersion: { field: "capabilitiesVersion", value: null, negotiated: true },
      },
      notContractVersions: [contract.storageConfigVersionField],
    },
    $defs: {
      id: idSchema(),
      payload: payloadSchema(),
      outcome,
      sequence,
      resumeSequence,
      binding,
      retryability: { type: "string", enum: [...contract.retryability] },
      executeRequest: {
        type: "object",
        additionalProperties: true,
        required: ["kind", "messageId", "method", "runId", "operationId", "requestId", "payload"],
        properties: {
          kind: { const: "request" },
          messageId: { $ref: "#/$defs/id" },
          method: { const: "execute" },
          runId: { $ref: "#/$defs/id" },
          operationId: { $ref: "#/$defs/id" },
          requestId: { $ref: "#/$defs/id" },
          payload: { $ref: "#/$defs/payload" },
          idempotencyKey: optionalId(),
          operationDeadline: { type: "string" },
          attemptDeadline: { type: "string" },
          attemptId: true,
          stepId: true,
        },
        allOf: [forbiddenGroup(["attemptId", "stepId"])],
      },
      moduleCallRequest: {
        type: "object",
        additionalProperties: true,
        required: ["kind", "messageId", "method", "runId", "operationId", "requestId", "module", "payload"],
        properties: {
          kind: { const: "request" },
          messageId: { $ref: "#/$defs/id" },
          method: { const: "module_call" },
          runId: { $ref: "#/$defs/id" },
          operationId: { $ref: "#/$defs/id" },
          requestId: { $ref: "#/$defs/id" },
          module: { type: "string", enum: [...contract.moduleCallTargets] },
          payload: { $ref: "#/$defs/payload" },
          idempotencyKey: optionalId(),
        },
      },
      cancelRequest: {
        type: "object",
        additionalProperties: true,
        required: ["kind", "messageId", "method", "runId", "operationId", "reason"],
        properties: {
          kind: { const: "request" },
          messageId: { $ref: "#/$defs/id" },
          method: { const: "cancel" },
          runId: { $ref: "#/$defs/id" },
          operationId: { $ref: "#/$defs/id" },
          reason: { type: "string", minLength: 1 },
          requestId: optionalId(),
        },
      },
      statusRequest: {
        type: "object",
        additionalProperties: true,
        required: ["kind", "messageId", "method", "requestId"],
        properties: {
          kind: { const: "request" },
          messageId: { $ref: "#/$defs/id" },
          method: { const: "status" },
          requestId: { $ref: "#/$defs/id" },
        },
      },
      resumeRequest: {
        type: "object",
        additionalProperties: true,
        required: ["kind", "messageId", "method", "streamId", "previousBinding", "lastAppliedSequence"],
        properties: {
          kind: { const: "request" },
          messageId: { $ref: "#/$defs/id" },
          method: { const: "resume" },
          streamId: { $ref: "#/$defs/id" },
          previousBinding: { $ref: "#/$defs/binding" },
          lastAppliedSequence: { $ref: "#/$defs/resumeSequence" },
        },
      },
      ackRequest: {
        type: "object",
        additionalProperties: true,
        required: ["kind", "messageId", "method", "streamId", "lastAppliedSequence"],
        properties: {
          kind: { const: "request" },
          messageId: { $ref: "#/$defs/id" },
          method: { const: "ack" },
          streamId: { $ref: "#/$defs/id" },
          lastAppliedSequence: { $ref: "#/$defs/sequence" },
        },
      },
      handshakeRequest: {
        type: "object",
        additionalProperties: true,
        required: ["kind", "messageId", "method", "payload"],
        properties: {
          kind: { const: "request" },
          messageId: { $ref: "#/$defs/id" },
          method: { enum: ["hello", "capabilities"] },
          payload: { $ref: "#/$defs/payload" },
        },
      },
      response: {
        type: "object",
        additionalProperties: true,
        required: ["kind", "messageId", "inReplyTo", "ok"],
        properties: {
          kind: { const: "response" },
          messageId: { $ref: "#/$defs/id" },
          inReplyTo: { $ref: "#/$defs/id" },
          ok: { type: "boolean" },
          outcome: { $ref: "#/$defs/outcome" },
        },
        allOf: [finalImpliesOutcome, outcomeIfPresent],
      },
      event: {
        type: "object",
        additionalProperties: true,
        required: ["kind", "eventType", "streamId", "sequence", "runId", "operationId", "requestId", "final", "payload"],
        properties: {
          kind: { const: "event" },
          messageId: { $ref: "#/$defs/id" },
          eventType: { $ref: "#/$defs/id" },
          streamId: { $ref: "#/$defs/id" },
          sequence: { $ref: "#/$defs/sequence" },
          runId: { $ref: "#/$defs/id" },
          operationId: { $ref: "#/$defs/id" },
          requestId: { $ref: "#/$defs/id" },
          final: { type: "boolean" },
          payload: { $ref: "#/$defs/payload" },
          outcome: { $ref: "#/$defs/outcome" },
          code: { $ref: "#/$defs/id" },
          moduleInstanceId: true,
          connectionGeneration: true,
        },
        allOf: [
          finalImpliesOutcome,
          outcomeIfPresent,
          forbiddenGroup(["moduleInstanceId", "connectionGeneration"]),
        ],
      },
      error: {
        type: "object",
        additionalProperties: true,
        required: ["kind", "messageId", "code", "message", "retryability"],
        properties: {
          kind: { const: "error" },
          messageId: { $ref: "#/$defs/id" },
          code: { $ref: "#/$defs/id" },
          message: { type: "string", minLength: 1 },
          retryability: { $ref: "#/$defs/retryability" },
        },
      },
    },
  };
  return schema;
}

export function stringifySchema(schema) {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

export function compileSchema(schema, options = {}) {
  const ajv = new Ajv2020({
    // strict is required for accept/reject parity with validateModuleMessage.
    strict: true,
    allErrors: true,
    validateSchema: true,
    ...options,
  });
  ajv.addKeyword({ keyword: "x-pilotdeck", schemaType: "object" });
  return ajv.compile(schema);
}

export function schemaAccepts(validate, value) {
  return validate(value) === true;
}

export function loadRequiredGatewayScenarios() {
  const runner = readFileSync(PARITY_RUNNER_PATH, "utf8");
  const block = mustMatch(
    runner,
    /REQUIRED_GATEWAY_SCENARIOS = frozenset\(\{([\s\S]*?)\}\)/,
    "REQUIRED_GATEWAY_SCENARIOS",
  )[1];
  const ids = extractQuotedList(block);
  if (ids.length !== 53) {
    throw new Error(`REQUIRED_GATEWAY_SCENARIOS must be 53, got ${ids.length}`);
  }
  const catalog = JSON.parse(readFileSync(SCENARIOS_PATH, "utf8"));
  const byId = new Map(catalog.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`scenarios.json missing ${missing.join(",")}`);
  return ids.map((id) => byId.get(id));
}

function terminalOutcome(scenario) {
  const outcome = scenario.expected?.terminalOutcome;
  if (outcome === "completed" || outcome === "failed" || outcome === "cancelled" || outcome === "result_unknown") {
    return outcome;
  }
  if (scenario.expected?.parentClosed || scenario.expected?.parentAborted) return "cancelled";
  return "completed";
}

function moduleCallsFor(scenario) {
  const modules = [...(scenario.requiredSidecarModules ?? [])];
  const operations = scenario.requiredSidecarOperations ?? [];
  const calls = [];
  for (const spec of operations) {
    const [module, operation] = String(spec).split(":");
    if (!module) continue;
    calls.push({
      module,
      payload: { operation: operation ?? "execute" },
    });
    if (!modules.includes(module)) modules.push(module);
  }
  for (const module of modules) {
    if (!calls.some((call) => call.module === module)) {
      calls.push({ module, payload: { operation: "execute" } });
    }
  }
  return calls;
}

export function materializeScenarioTrace(scenario) {
  const id = scenario.scenarioId;
  const outcome = terminalOutcome(scenario);
  const messages = [];

  messages.push({
    source: "handshake",
    message: {
      kind: "request",
      messageId: `hello-${id}`,
      method: "hello",
      payload: { scenarioId: id },
    },
  });
  messages.push({
    source: "handshake",
    message: {
      kind: "response",
      messageId: `hello-res-${id}`,
      inReplyTo: `hello-${id}`,
      ok: true,
      protocolVersion: "2.0",
      moduleId: "agent-loop",
      moduleInstanceId: `instance-${id}`,
      connectionGeneration: `generation-${id}`,
      capabilitiesVersion: "2.0",
      payload: { scenarioId: id },
    },
  });
  messages.push({
    source: "handshake",
    message: {
      kind: "request",
      messageId: `capabilities-${id}`,
      method: "capabilities",
      payload: { scenarioId: id },
    },
  });
  messages.push({
    source: "handshake",
    message: {
      kind: "response",
      messageId: `capabilities-res-${id}`,
      inReplyTo: `capabilities-${id}`,
      ok: true,
      protocolVersion: "2.0",
      capabilitiesVersion: "2.0",
      payload: { capabilitiesVersion: "2.0", methods: [{ name: "execute", enabled: true }] },
    },
  });
  messages.push({
    source: "execute",
    message: {
      kind: "request",
      messageId: `execute-${id}`,
      method: "execute",
      runId: `run-${id}`,
      operationId: `op-${id}`,
      requestId: `req-${id}`,
      idempotencyKey: `idem-${id}`,
      payload: {
        q: scenario.q,
        tools: scenario.tools ?? [],
        suite: scenario.suite,
      },
    },
  });
  messages.push({
    source: "execute-accepted",
    message: {
      kind: "response",
      messageId: `execute-res-${id}`,
      inReplyTo: `execute-${id}`,
      requestId: `req-${id}`,
      ok: true,
      streamId: `stream-${id}`,
      final: false,
    },
  });

  for (const call of moduleCallsFor(scenario)) {
    messages.push({
      source: `module_call:${call.module}`,
      message: {
        kind: "request",
        messageId: `call-${id}-${call.module}-${call.payload.operation}`,
        method: "module_call",
        runId: `run-${id}`,
        operationId: `op-${id}`,
        requestId: `req-${id}-${call.module}`,
        module: call.module,
        payload: { ...call.payload, scenarioId: id },
      },
    });
    messages.push({
      source: `module_call-response:${call.module}`,
      message: {
        kind: "response",
        messageId: `call-res-${id}-${call.module}`,
        inReplyTo: `call-${id}-${call.module}-${call.payload.operation}`,
        requestId: `req-${id}-${call.module}`,
        ok: true,
        payload: { accepted: true },
      },
    });
  }

  messages.push({
    source: "event",
    message: {
      kind: "event",
      eventType: "model.delta",
      streamId: `stream-${id}`,
      sequence: 0,
      runId: `run-${id}`,
      operationId: `op-${id}`,
      requestId: `req-${id}`,
      final: false,
      payload: { text: "delta", scenarioId: id },
    },
  });
  messages.push({
    source: "event-final",
    message: {
      kind: "event",
      eventType: "execute.completed",
      streamId: `stream-${id}`,
      sequence: 1,
      runId: `run-${id}`,
      operationId: `op-${id}`,
      requestId: `req-${id}`,
      final: true,
      outcome,
      code: scenario.expected?.errorCode || undefined,
      payload: { scenarioId: id },
    },
  });
  messages.push({
    source: "response-final",
    message: {
      kind: "response",
      messageId: `final-${id}`,
      inReplyTo: `execute-${id}`,
      requestId: `req-${id}`,
      ok: outcome === "completed",
      final: true,
      outcome,
    },
  });

  const cancelRelated = Boolean(
    scenario.limits?.cancelAfterMs
    || scenario.limits?.cancelAfterToolStartMs
    || id.includes("cancel")
    || id.includes("abort"),
  );
  if (cancelRelated) {
    messages.push({
      source: "cancel",
      message: {
        kind: "request",
        messageId: `cancel-${id}`,
        method: "cancel",
        runId: `run-${id}`,
        operationId: `op-${id}`,
        reason: "parity_cancel",
      },
    });
  }

  if (scenario.verifyStatusReplay || id.includes("budget") || id.includes("status")) {
    messages.push({
      source: "status",
      message: {
        kind: "request",
        messageId: `status-${id}`,
        method: "status",
        requestId: `req-${id}`,
      },
    });
  }

  if (id.includes("resume") || id.includes("checkpoint")) {
    messages.push({
      source: "resume",
      message: {
        kind: "request",
        messageId: `resume-${id}`,
        method: "resume",
        streamId: `stream-${id}`,
        previousBinding: {
          moduleInstanceId: `instance-${id}`,
          connectionGeneration: `generation-${id}`,
        },
        lastAppliedSequence: -1,
      },
    });
    messages.push({
      source: "ack",
      message: {
        kind: "request",
        messageId: `ack-${id}`,
        method: "ack",
        streamId: `stream-${id}`,
        lastAppliedSequence: 1,
      },
    });
  }

  messages.push({
    source: "result_unknown",
    message: {
      kind: "event",
      eventType: "execute.unknown",
      streamId: `stream-${id}`,
      sequence: 2,
      runId: `run-${id}`,
      operationId: `op-${id}`,
      requestId: `req-${id}`,
      final: true,
      outcome: "result_unknown",
      payload: { scenarioId: id },
    },
  });
  messages.push({
    source: "result_unknown",
    message: {
      kind: "response",
      messageId: `unknown-${id}`,
      inReplyTo: `execute-${id}`,
      requestId: `req-${id}`,
      ok: false,
      final: true,
      outcome: "result_unknown",
    },
  });

  if (outcome === "failed" || scenario.expected?.errorCode) {
    messages.push({
      source: "error",
      message: {
        kind: "error",
        messageId: `error-${id}`,
        code: scenario.expected?.errorCode || "FAILED",
        message: scenario.expected?.errorCode || "failed",
        retryability: scenario.expected?.toolRetryable ? "safe" : "unsafe",
      },
    });
  }

  return {
    scenarioId: id,
    suite: scenario.suite,
    messages: messages.map((entry) => ({
      ...entry,
      message: JSON.parse(JSON.stringify(entry.message, (key, value) => value === undefined ? undefined : value)),
    })),
  };
}

export function loosenSchema(schema) {
  const clone = structuredClone(schema);
  const strip = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) strip(item);
      return;
    }
    if (Array.isArray(node.allOf)) {
      node.allOf = node.allOf.filter((clause) => !clause.not && !clause.if);
      if (node.allOf.length === 0) delete node.allOf;
    }
    for (const value of Object.values(node)) strip(value);
  };
  strip(clone);
  return clone;
}

export function decisionOf(ok) {
  return ok ? "accept" : "reject";
}
