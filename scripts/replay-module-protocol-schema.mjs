#!/usr/bin/env node
/**
 * T-P0a-01 A1–A4: replay 53 agent-loop-parity scenario traces plus negatives
 * and edges through the generated schema and validateModuleMessage.
 * Compares accept/reject only. Does not change protocol behavior.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AJV_VERSION,
  JSON_SCHEMA_DRAFT,
  PROTOCOL_REL,
  ROOT,
  SCHEMA_PATH,
  SCHEMA_REL,
  assertCleanTree,
  buildModuleProtocolSchema,
  compileSchema,
  decisionOf,
  extractProtocolContract,
  gitDirty,
  gitSha,
  loadRequiredGatewayScenarios,
  loosenSchema,
  materializeScenarioTrace,
  readProtocolSource,
  schemaAccepts,
  stringifySchema,
} from "./lib/module-protocol-schema.mjs";

if (!process.execArgv.some((flag) => flag.includes("strip-types"))) {
  const replayed = spawnSync(
    process.execPath,
    ["--experimental-strip-types", ...process.argv.slice(1)],
    { stdio: "inherit" },
  );
  process.exit(replayed.status ?? 1);
}

const { validateModuleMessage } = await import(new URL("../../src/agent/modules/protocol.ts", import.meta.url).href);

const here = dirname(fileURLToPath(import.meta.url));
const negativePath = resolve(ROOT, "evidence/schema/fixtures/negative-samples.json");
const edgePath = resolve(ROOT, "evidence/schema/fixtures/edge-samples.json");
const reportJsonPath = resolve(ROOT, "evidence/schema/replay-report.json");
const reportMdPath = resolve(ROOT, "evidence/schema/replay-report.md");

function parseRaw(raw) {
  return JSON.parse(raw);
}

function tsAccepts(value) {
  return validateModuleMessage(value).ok === true;
}

function compareValue(id, value, schemaValidate, extra = {}) {
  const ts = tsAccepts(value);
  const schema = schemaAccepts(schemaValidate, value);
  return {
    id,
    ts: decisionOf(ts),
    schema: decisionOf(schema),
    match: ts === schema,
    ...extra,
  };
}

function compareRaw(id, raw, schemaValidate, extra = {}) {
  return compareValue(id, parseRaw(raw), schemaValidate, { raw, ...extra });
}

function messageTypeCoverage(samples) {
  const types = new Map();
  for (const sample of samples) {
    const list = types.get(sample.messageType) ?? [];
    list.push(sample.id);
    types.set(sample.messageType, list);
  }
  return Object.fromEntries(types);
}

function runA1() {
  const built = stringifySchema(buildModuleProtocolSchema(extractProtocolContract(readProtocolSource())));
  const onDisk = readFileSync(SCHEMA_PATH, "utf8");
  const fileMatchesBuilder = built === onDisk;

  const first = spawnSync(process.execPath, [resolve(here, "generate-module-protocol-schema.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const second = spawnSync(process.execPath, [resolve(here, "generate-module-protocol-schema.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const after = readFileSync(SCHEMA_PATH, "utf8");
  const secondGenerationDiffEmpty = first.status === 0 && second.status === 0 && after === onDisk && after === built;

  const dirtyMarker = resolve(ROOT, "evidence/schema/.a1-dirty-tree-probe");
  writeFileSync(dirtyMarker, "dirty\n");
  const dirtyRun = spawnSync(process.execPath, [resolve(here, "generate-module-protocol-schema.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  unlinkSync(dirtyMarker);
  const dirtyTreeRefused = dirtyRun.status === 2 && /dirty/i.test(`${dirtyRun.stdout}\n${dirtyRun.stderr}`);

  return {
    reproducible: fileMatchesBuilder && secondGenerationDiffEmpty,
    fileMatchesBuilder,
    secondGenerationDiffEmpty,
    dirtyTreeRefused,
    firstGenerateStatus: first.status,
    secondGenerateStatus: second.status,
    dirtyGenerateStatus: dirtyRun.status,
    dirtyGenerateError: `${dirtyRun.stderr}${dirtyRun.stdout}`.trim().split("\n")[0] ?? "",
  };
}

const recordedSha = gitSha();
const recordedDirty = gitDirty();
if (recordedDirty) {
  console.error("replay-module-protocol-schema requires a clean git tree so evidence can record gitDirty=false");
  process.exit(2);
}

const contract = extractProtocolContract(readProtocolSource());
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const validate = compileSchema(schema);
const a1 = runA1();

const scenarios = loadRequiredGatewayScenarios();
if (scenarios.length !== 53) {
  throw new Error(`expected 53 gateway scenarios, got ${scenarios.length}`);
}

const traceComparisons = [];
for (const scenario of scenarios) {
  const trace = materializeScenarioTrace(scenario);
  for (const [index, entry] of trace.messages.entries()) {
    traceComparisons.push(compareValue(
      `${trace.scenarioId}#${index}:${entry.source}`,
      entry.message,
      validate,
      { scenarioId: trace.scenarioId, source: entry.source, suite: trace.suite },
    ));
  }
}

const negatives = JSON.parse(readFileSync(negativePath, "utf8")).samples;
const negativeComparisons = negatives.map((sample) => {
  const parsed = parseRaw(sample.raw);
  const ts = validateModuleMessage(parsed);
  const schemaOk = schemaAccepts(validate, parsed);
  return {
    id: sample.id,
    messageType: sample.messageType,
    rule: sample.rule,
    conditional: sample.conditional,
    ts: decisionOf(ts.ok),
    schema: decisionOf(schemaOk),
    tsCode: ts.ok ? undefined : ts.code,
    match: ts.ok === false && schemaOk === false,
    bothReject: ts.ok === false && schemaOk === false,
    raw: sample.raw,
  };
});

const requiredTypes = [
  "request/execute",
  "request/module_call",
  "request/cancel",
  "request/status",
  "request/resume",
  "request/ack",
  "request/hello",
  "request/capabilities",
  "response",
  "event",
  "error",
];
const coverage = messageTypeCoverage(negatives);
const missingTypes = requiredTypes.filter((type) => !coverage[type]);
const requiredConditionals = [
  "final-implies-outcome",
  "forbidden-attemptId-stepId",
  "forbidden-binding-on-event",
];
const missingConditionals = requiredConditionals.filter((name) => !negatives.some((sample) => sample.conditional === name));

const edges = JSON.parse(readFileSync(edgePath, "utf8")).samples;
const edgeComparisons = edges.map((sample) => {
  const parsed = parseRaw(sample.raw);
  const ts = tsAccepts(parsed);
  const schemaOk = schemaAccepts(validate, parsed);
  const expectedAccept = sample.expect === "accept";
  return {
    id: sample.id,
    bound: sample.bound,
    expect: sample.expect,
    ts: decisionOf(ts),
    schema: decisionOf(schemaOk),
    match: ts === schemaOk,
    matchesExpect: ts === expectedAccept && schemaOk === expectedAccept,
    tP1RustSerdeParseRisk: sample.tP1RustSerdeParseRisk === true,
    note: sample.note,
    objectIsNegativeZero: sample.id.includes("negative-zero")
      ? Object.is(parsed.sequence ?? parsed.lastAppliedSequence, -0)
      : undefined,
    jsParsedNumber: sample.bound
      ? (parsed.sequence ?? parsed.lastAppliedSequence)
      : undefined,
    raw: sample.raw,
  };
});

const looseSchema = loosenSchema(schema);
const looseValidate = compileSchema(looseSchema);
const looseControlSamples = negatives.filter((sample) => sample.conditional);
const looseComparisons = looseControlSamples.map((sample) => {
  const parsed = parseRaw(sample.raw);
  const ts = tsAccepts(parsed);
  const loose = schemaAccepts(looseValidate, parsed);
  return {
    id: sample.id,
    rule: sample.rule,
    ts: decisionOf(ts),
    loosenedSchema: decisionOf(loose),
    mismatch: ts !== loose,
  };
});
const loosenedControlFail = looseComparisons.some((item) => item.mismatch && item.ts === "reject" && item.loosenedSchema === "accept");

const expressibleMismatches = [
  ...traceComparisons.filter((item) => !item.match),
  ...negativeComparisons.filter((item) => !item.bothReject),
  ...edgeComparisons.filter((item) => !item.match),
].map((item) => ({ id: item.id, ts: item.ts, schema: item.schema }));

const inexpressibleRules = [];

const a2 = {
  scenarios: scenarios.length,
  scenarioIds: scenarios.map((scenario) => scenario.scenarioId),
  totalCompared: traceComparisons.length,
  expressibleMismatches: expressibleMismatches.filter((item) => traceComparisons.some((trace) => trace.id === item.id)).length,
  inexpressibleRules: inexpressibleRules.length,
  mismatches: expressibleMismatches.filter((item) => traceComparisons.some((trace) => trace.id === item.id)),
};

const a3 = {
  negatives: negativeComparisons.length,
  negativesPerMessageType: coverage,
  missingMessageTypes: missingTypes,
  missingConditionals,
  allRejectedByBoth: negativeComparisons.every((item) => item.bothReject),
  edgeSamples: edgeComparisons.length,
  edgesMatchExpect: edgeComparisons.every((item) => item.matchesExpect),
  loosenedSchemaControl: {
    result: loosenedControlFail ? "FAIL" : "UNEXPECTED_PASS",
    mustFail: true,
    compared: looseComparisons.length,
    mismatches: looseComparisons.filter((item) => item.mismatch),
  },
};

const a4 = {
  protocolVersion: schema["x-pilotdeck"]?.contractVersions?.protocolVersion,
  capabilitiesVersion: schema["x-pilotdeck"]?.contractVersions?.capabilitiesVersion,
  storageConfigVersionWrittenAsContract: schema["x-pilotdeck"]?.contractVersions?.storageConfigVersion != null,
  notContractVersions: schema["x-pilotdeck"]?.notContractVersions ?? [],
  matchesSource: schema["x-pilotdeck"]?.contractVersions?.protocolVersion === contract.protocolVersion
    && schema["x-pilotdeck"]?.contractVersions?.capabilitiesVersion === contract.capabilitiesVersionField
    && (schema["x-pilotdeck"]?.notContractVersions ?? []).includes("storageConfigVersion"),
};

const rustRisk = {
  name: "T-P1 Rust serde parse risk",
  samples: edgeComparisons
    .filter((item) => item.tP1RustSerdeParseRisk)
    .map((item) => ({
      id: item.id,
      rawNumberToken: item.raw.includes("1.0") ? "1.0" : "-0",
      jsAfterJSONParse: item.jsParsedNumber,
      objectIsNegativeZero: item.objectIsNegativeZero,
      ts: item.ts,
      schema: item.schema,
      note: item.note
        ?? "JSON.parse collapses 1.0 to integer 1 and keeps Object.is(-0,-0). serde_json may yield f64 / signed zero and fail a Rust integer field.",
    })),
};

const report = {
  task: "T-P0a-01",
  input: PROTOCOL_REL,
  schema: SCHEMA_REL,
  gitSha: recordedSha,
  gitDirty: recordedDirty,
  validator: {
    ajv: AJV_VERSION,
    jsonSchemaDraft: JSON_SCHEMA_DRAFT,
    typescriptFunction: "validateModuleMessage",
  },
  additionalProperties: {
    topLevel: true,
    payload: true,
    evidence: "evidence/schema/additional-properties-probe.md",
    rejectedByNameOnly: ["attemptId", "stepId", "moduleInstanceId", "connectionGeneration"],
  },
  A1: a1,
  A2: a2,
  A3: a3,
  A4: a4,
  inexpressibleRules,
  tP1RustSerdeParseRisk: rustRisk,
  negativeComparisons,
  edgeComparisons,
};

mkdirSync(dirname(reportJsonPath), { recursive: true });
writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);

const md = `# T-P0a-01 module-protocol schema replay

- input: \`${PROTOCOL_REL}\`
- schema: \`${SCHEMA_REL}\`
- gitSha: \`${recordedSha}\`
- gitDirty: \`${recordedDirty}\`
- ajv: \`${AJV_VERSION}\`
- JSON Schema: draft ${JSON_SCHEMA_DRAFT}

## additionalProperties

Top-level and payload extra fields are accepted (\`true\`). Rejected by name only: attemptId, stepId, moduleInstanceId, connectionGeneration. Probe: \`evidence/schema/additional-properties-probe.md\`.

## A1 reproducible generation

- file matches builder: \`${a1.fileMatchesBuilder}\`
- second generation diff empty: \`${a1.secondGenerationDiffEmpty}\`
- dirty tree refused (exit 2): \`${a1.dirtyTreeRefused}\`

## A2 53-scenario accept/reject replay

- scenarios: **${a2.scenarios}**
- total compared: **${a2.totalCompared}**
- expressible mismatches: **${a2.expressibleMismatches}** (must be 0)
- inexpressible rules: **${a2.inexpressibleRules}** (listed separately; schema was not loosened)

${a2.mismatches.length ? a2.mismatches.map((item) => `- MISMATCH \`${item.id}\` ts=${item.ts} schema=${item.schema}`).join("\n") : "No expressible mismatches."}

## A3 negatives, edges, loosened control

- negatives: ${a3.negatives}; both reject: \`${a3.allRejectedByBoth}\`
- missing message types: ${a3.missingMessageTypes.length ? a3.missingMessageTypes.join(", ") : "(none)"}
- missing conditionals: ${a3.missingConditionals.length ? a3.missingConditionals.join(", ") : "(none)"}
- edges match expect: \`${a3.edgesMatchExpect}\`
- loosened-schema control: **${a3.loosenedSchemaControl.result}** (must FAIL)

## A4 contract versions

- protocolVersion: \`${a4.protocolVersion}\`
- capabilitiesVersion: \`${a4.capabilitiesVersion}\`
- storageConfigVersion written as contract: \`${a4.storageConfigVersionWrittenAsContract}\`
- notContractVersions: ${a4.notContractVersions.join(", ")}

## T-P1 Rust serde parse risk

Named note for \`1.0\` / \`-0\` after JSON.parse. Both JS validators accept the integer-like values; a Rust \`serde\` integer field may not.

${rustRisk.samples.map((item) => `- \`${item.id}\` token=${item.rawNumberToken} js=${item.jsAfterJSONParse} negativeZero=${item.objectIsNegativeZero}`).join("\n")}

## Inexpressible rules

${inexpressibleRules.length ? inexpressibleRules.map((item) => `- ${item.rule}: ${item.reason}`).join("\n") : "None. isId / isSequence / isResumeSequence / isBinding / isOutcome are all expressible in draft 2020-12. Schema was not loosened to force a zero mismatch count."}
`;
writeFileSync(reportMdPath, md);

console.log(JSON.stringify({
  gitSha: recordedSha,
  gitDirty: recordedDirty,
  A1: { ok: a1.reproducible && a1.dirtyTreeRefused },
  A2: { totalCompared: a2.totalCompared, expressibleMismatches: a2.expressibleMismatches, inexpressibleRules: a2.inexpressibleRules },
  A3: { allRejectedByBoth: a3.allRejectedByBoth, loosened: a3.loosenedSchemaControl.result },
  A4: a4,
}, null, 2));

const failed = !(
  a1.reproducible
  && a1.dirtyTreeRefused
  && a2.scenarios === 53
  && a2.expressibleMismatches === 0
  && a3.allRejectedByBoth
  && a3.missingMessageTypes.length === 0
  && a3.missingConditionals.length === 0
  && a3.edgesMatchExpect
  && loosenedControlFail
  && a4.matchesSource
  && expressibleMismatches.length === 0
);
if (failed) {
  console.error("T-P0a-01 acceptance failed");
  process.exit(1);
}
console.log(`wrote ${reportJsonPath}`);
console.log(`wrote ${reportMdPath}`);
