#!/usr/bin/env node
/**
 * T-P0a-01 A1–A4: replay 53 agent-loop-parity scenario traces plus negatives
 * and edges through the generated schema and validateModuleMessage.
 * Compares accept/reject only. Does not change protocol behavior.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AJV_VERSION,
  JSON_SCHEMA_DRAFT,
  PROTOCOL_PATH,
  PROTOCOL_REL,
  ROOT,
  SCHEMA_PATH,
  SCHEMA_REL,
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

const { validateModuleMessage } = await import(pathToFileURL(PROTOCOL_PATH).href);

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
  let dirtyRun;
  try {
    writeFileSync(dirtyMarker, "dirty\n");
    dirtyRun = spawnSync(process.execPath, [resolve(here, "generate-module-protocol-schema.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } finally {
    if (existsSync(dirtyMarker)) unlinkSync(dirtyMarker);
  }
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

function describeJsonNumber(value) {
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  return value;
}

const edges = JSON.parse(readFileSync(edgePath, "utf8")).samples;
const edgeComparisons = edges.map((sample) => {
  const parsed = parseRaw(sample.raw);
  const ts = tsAccepts(parsed);
  const schemaOk = schemaAccepts(validate, parsed);
  const expectedAccept = sample.expect === "accept";
  const parsedNumber = sample.bound
    ? (parsed.sequence ?? parsed.lastAppliedSequence)
    : undefined;
  return {
    id: sample.id,
    bound: sample.bound,
    expect: sample.expect,
    ts: decisionOf(ts),
    schema: decisionOf(schemaOk),
    match: ts === schemaOk,
    matchesExpect: ts === expectedAccept && schemaOk === expectedAccept,
    tP1RustSerdeParseRisk: sample.tP1RustSerdeParseRisk === true,
    token: sample.token,
    note: sample.note,
    objectIsNegativeZero: sample.id.includes("negative-zero")
      ? Object.is(parsed.sequence ?? parsed.lastAppliedSequence, -0)
      : undefined,
    jsParsedNumber: parsedNumber === undefined ? undefined : describeJsonNumber(parsedNumber),
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
    conditional: sample.conditional,
    ts: decisionOf(ts),
    loosenedSchema: decisionOf(loose),
    mismatch: ts !== loose,
  };
});
const loosenedPerRule = Object.fromEntries(requiredConditionals.map((name) => {
  const items = looseComparisons.filter((item) => item.conditional === name);
  const fail = items.some((item) => item.mismatch && item.ts === "reject" && item.loosenedSchema === "accept");
  return [name, { compared: items.length, fail, ids: items.map((item) => item.id) }];
}));
const loosenedControlFail = requiredConditionals.every((name) => loosenedPerRule[name].fail);

const expressibleMismatches = [
  ...traceComparisons.filter((item) => !item.match),
  ...negativeComparisons.filter((item) => !item.bothReject),
  ...edgeComparisons.filter((item) => !item.match),
].map((item) => ({ id: item.id, ts: item.ts, schema: item.schema }));

const inexpressibleRules = [];

function countDecisions(items) {
  return {
    accept: items.filter((item) => item.ts === "accept").length,
    reject: items.filter((item) => item.ts === "reject").length,
  };
}

function perSourceCounts(items) {
  const groups = new Map();
  for (const item of items) {
    const source = item.source ?? "unknown";
    const current = groups.get(source) ?? { total: 0, accept: 0, reject: 0 };
    current.total += 1;
    current[item.ts] += 1;
    groups.set(source, current);
  }
  return Object.fromEntries([...groups.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

const a2 = {
  corpus: {
    kind: "synthetic-templates",
    description: "Synthetic template messages materialized from the 53 tools/agent-loop-parity scenario metadata (REQUIRED_GATEWAY_SCENARIOS). Not live wire traces.",
  },
  scenarios: scenarios.length,
  scenarioIds: scenarios.map((scenario) => scenario.scenarioId),
  totalCompared: traceComparisons.length,
  decisions: countDecisions(traceComparisons),
  perSource: perSourceCounts(traceComparisons),
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
    perRuleEvery: true,
    compared: looseComparisons.length,
    perRule: loosenedPerRule,
    mismatches: looseComparisons.filter((item) => item.mismatch),
  },
};

const contractVersions = schema["x-pilotdeck"]?.contractVersions;
const a4 = {
  protocolVersion: contractVersions?.protocolVersion,
  capabilitiesVersion: contractVersions?.capabilitiesVersion,
  annotationsOnly: true,
  storageConfigVersionWrittenAsContract: contractVersions?.storageConfigVersion != null,
  notContractVersions: schema["x-pilotdeck"]?.notContractVersions ?? [],
  matchesSource: contractVersions?.protocolVersion?.field === "protocolVersion"
    && contractVersions?.protocolVersion?.value === contract.protocolVersion
    && contractVersions?.capabilitiesVersion?.field === "capabilitiesVersion"
    && contractVersions?.capabilitiesVersion?.value === null
    && contractVersions?.capabilitiesVersion?.negotiated === true
    && (schema["x-pilotdeck"]?.notContractVersions ?? []).includes("storageConfigVersion"),
};

const rustRisk = {
  name: "T-P1 Rust serde parse risk",
  ajvMustRunStrict: true,
  note: [
    "JSON.parse may collapse 1.0 / exponent forms (1e2, 1E0, 100e-2) to JS integers,",
    "keep Object.is(-0,-0), lose precision above 2^53, and turn 1e400 into Infinity.",
    "Rust serde_json may keep f64, reject exponent-as-integer, preserve signed zero,",
    "or error on overflow instead of Infinity. ajv must run strict:true for parity with this schema.",
  ].join(" "),
  samples: edgeComparisons
    .filter((item) => item.tP1RustSerdeParseRisk)
    .map((item) => ({
      id: item.id,
      rawNumberToken: item.token
        ?? (item.raw.includes("1.0") ? "1.0" : item.raw.includes("-0") ? "-0" : undefined),
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
    ajvStrict: true,
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

A2 corpus is **synthetic template messages** materialized from the 53
\`tools/agent-loop-parity\` scenario metadata (\`REQUIRED_GATEWAY_SCENARIOS\`).
These are **not** live wire traces.

- scenarios: **${a2.scenarios}**
- total compared: **${a2.totalCompared}**
- accept/reject: **${a2.decisions.accept}/${a2.decisions.reject}**
- per-source counts: ${Object.entries(a2.perSource).map(([source, count]) => `\`${source}\` ${count.total} (${count.accept}/${count.reject})`).join(", ")}
- expressible mismatches: **${a2.expressibleMismatches}** (must be 0)
- inexpressible rules: **${a2.inexpressibleRules}** (listed separately; schema was not loosened)

${a2.mismatches.length ? a2.mismatches.map((item) => `- MISMATCH \`${item.id}\` ts=${item.ts} schema=${item.schema}`).join("\n") : "No expressible mismatches."}

## A3 negatives, edges, loosened control

- negatives: ${a3.negatives}; both reject: \`${a3.allRejectedByBoth}\`
- missing message types: ${a3.missingMessageTypes.length ? a3.missingMessageTypes.join(", ") : "(none)"}
- missing conditionals: ${a3.missingConditionals.length ? a3.missingConditionals.join(", ") : "(none)"}
- edges: ${a3.edgeSamples}; match expect: \`${a3.edgesMatchExpect}\`
- loosened-schema control: **${a3.loosenedSchemaControl.result}** (must FAIL; per-rule every)

${Object.entries(a3.loosenedSchemaControl.perRule).map(([name, row]) => `- \`${name}\`: compared=${row.compared} fail=${row.fail}`).join("\n")}

## A4 contract versions

Versions in \`x-pilotdeck.contractVersions\` are **annotations**; the schema does not enforce them.

- protocolVersion: \`${JSON.stringify(a4.protocolVersion)}\`
- capabilitiesVersion: \`${JSON.stringify(a4.capabilitiesVersion)}\`
- storageConfigVersion written as contract: \`${a4.storageConfigVersionWrittenAsContract}\`
- notContractVersions: ${a4.notContractVersions.join(", ")}

## T-P1 Rust serde parse risk

${rustRisk.note}

ajv must run \`strict: true\` for parity with this schema.

${rustRisk.samples.map((item) => `- \`${item.id}\` token=${item.rawNumberToken} js=${item.jsAfterJSONParse} negativeZero=${item.objectIsNegativeZero}`).join("\n")}

## Inexpressible rules

${inexpressibleRules.length ? inexpressibleRules.map((item) => `- ${item.rule}: ${item.reason}`).join("\n") : "None. isId / isSequence / isResumeSequence / isBinding / isOutcome are all expressible in draft 2020-12. Schema was not loosened to force a zero mismatch count."}
`;
writeFileSync(reportMdPath, md);

console.log(JSON.stringify({
  gitSha: recordedSha,
  gitDirty: recordedDirty,
  A1: { ok: a1.reproducible && a1.dirtyTreeRefused },
  A2: { totalCompared: a2.totalCompared, decisions: a2.decisions, expressibleMismatches: a2.expressibleMismatches, inexpressibleRules: a2.inexpressibleRules },
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
