import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";

import { createLocalGateway } from "../../../dist/src/cli/createLocalGateway.js";

const publishedPath = resolve(process.env.G5_PUBLISHED_SOP_JSON ?? "products/pilotdeck-staffdeck-sop/evidence/g5-pilotdeck-page-published-1.2.1.json");
const sourcePilotHome = process.env.REAL_MODEL_SOURCE_PILOT_HOME ?? process.env.PILOT_HOME;
const endpoint = process.env.STAFFDECK_SOP_ENDPOINT ?? "http://127.0.0.1:16205";
const selectedModel = process.env.REAL_MODEL_SMOKE_MODEL;
const outputPath = process.env.G5_NATURAL_OUTPUT ?? "/tmp/g5-agentloop-natural-discovery-1.2.1.json";
const discoveryEndpoint = process.env.STAFFDECK_SOP_DISCOVERY_ENDPOINT;
const discoveryAgentId = process.env.STAFFDECK_SOP_DISCOVERY_AGENT_ID;
const discoveryApiKey = process.env.STAFFDECK_SOP_DISCOVERY_API_KEY;
if (!sourcePilotHome) throw new Error("REAL_MODEL_SOURCE_PILOT_HOME or PILOT_HOME is required.");
if (!discoveryEndpoint || !discoveryAgentId || !discoveryApiKey) {
  throw new Error("STAFFDECK_SOP_DISCOVERY_ENDPOINT, STAFFDECK_SOP_DISCOVERY_AGENT_ID, and STAFFDECK_SOP_DISCOVERY_API_KEY are required.");
}

const sourceConfig = YAML.parse(await readFile(join(sourcePilotHome, "pilotdeck.yaml"), "utf8"));
const selected = selectedModel ?? sourceConfig?.agent?.model;
const [providerId] = typeof selected === "string" ? selected.split("/") : [];
const provider = providerId ? sourceConfig?.model?.providers?.[providerId] : undefined;
if (!selected || !providerId || !provider) throw new Error("The source config must select a configured model provider.");

const publishedResponse = JSON.parse(await readFile(publishedPath, "utf8"));
const published = publishedResponse?.result?.sop ?? publishedResponse?.sop ?? publishedResponse;
if (!published?.skill_id || !published?.version || !published?.content) throw new Error("Published SOP response is incomplete.");

const root = await mkdtemp(join(tmpdir(), "pilotdeck-natural-sop-"));
const projectRoot = join(root, "project");
const sessionKey = "natural-published-sop";
const statePath = join(projectRoot, "sop", "sessions", `${Buffer.from(sessionKey, "utf8").toString("base64url")}.json`);
const messages = [
  "请处理这项项目推进工作。目标是交付真实SOP运行验证，当前阶段是验证，已知阻塞为无。项目材料在 approval-context.txt，请先阅读材料。范围、资源和日期已经发生变化，在负责人审批影响前不能继续推进，也不要先输出最终行动清单。",
  "继续完成这份项目推进计划，把范围变化的影响、负责人、里程碑和风险依赖整理清楚，并按流程推进。",
  "请基于当前收集的信息生成推进计划，标出范围变化的影响。生成计划前，必须先把范围、资源和日期变化的影响交给负责人确认，确认前不要输出最终行动清单。",
  "请把确认请求正式发给负责人，说明影响和需要确认的内容；不要假设负责人已经确认。",
  "请等待负责人回复，不要自行把计划标为已确认或输出最终行动清单。",
  "范围、资源和日期的变化影响需要负责人审批。请现在暂停在范围变更确认环节，等待负责人回复，不要继续生成最终行动清单。",
  "请把项目流程推进到负责人确认范围变更这一步，明确说明等待审批，不要自行确认。",
];
assert.equal(messages.some((message) => /submit_step_result|status\s*=|status:/iu.test(message)), false);

const collect = async (events) => {
  const result = [];
  for await (const event of events) result.push(event);
  return result;
};
const redact = (value, key = "") => {
  if (/(api[_-]?key|authorization|password|secret|token|credential)/iu.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  return value;
};
const parseBody = (body) => {
  if (typeof body !== "string") return body === undefined ? undefined : String(body);
  try { return JSON.parse(body); } catch { return body; }
};
const serviceTrace = [];
const endpointPrefix = endpoint.replace(/\/+$/u, "");
const discoveryPrefix = discoveryEndpoint.replace(/\/+$/u, "");
const classifyServiceUrl = (url) => {
  if (url.startsWith(discoveryPrefix) && url.includes("/sops:route")) return "discovery";
  if (url.startsWith(endpointPrefix) && (/\/healthz$/u.test(url) || /\/v1\/sop\/(prepare|submit)$/u.test(url))) return "lifecycle";
  return undefined;
};
const nativeFetch = globalThis.fetch.bind(globalThis);
const tracedFetch = async (input, init) => {
  const response = await nativeFetch(input, init);
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const kind = classifyServiceUrl(rawUrl);
  if (kind) {
    let responseBody;
    try { responseBody = await response.clone().json(); } catch { responseBody = await response.clone().text(); }
    serviceTrace.push({
      kind,
      method: init?.method ?? "GET",
      path: new URL(rawUrl).pathname,
      status: response.status,
      request: redact(parseBody(init?.body)),
      response: redact(responseBody),
    });
  }
  return response;
};
globalThis.fetch = tracedFetch;
const eventTrace = (events) => events.map((event) => {
  if (event.type === "tool_call_started") return redact({ type: event.type, toolCallId: event.toolCallId, toolName: event.name, input: event.argsPreview });
  if (event.type === "tool_call_finished") return redact({
    type: event.type,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    ok: event.ok,
    result: event.resultPreview,
    resultLineCount: event.resultLineCount,
    resultBytes: event.resultBytes,
    data: event.data,
    errorCode: event.errorCode,
  });
  if (event.type === "error") return redact({ type: event.type, code: event.code, message: event.message });
  return { type: event.type };
});
const summary = (events) => eventTrace(events).filter((event) => event.type === "tool_call_started" || event.type === "tool_call_finished" || event.type === "error");
const snapshot = (status) => status && redact({
  revision: status.revision,
  state: status.state,
  wait: status.wait,
});
const persistedBinding = async () => {
  try {
    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    const selectedId = persisted.state?.selected_skill_id ?? persisted.state?.active_skill_id;
    const definition = persisted.bundle?.sops?.find((item) => (item?.id ?? item?.skill_id) === selectedId);
    return definition ? { skillId: selectedId, version: definition.version, name: definition.name } : { skillId: selectedId ?? null, version: null, name: null };
  } catch {
    return { skillId: null, version: null, name: null };
  }
};
const traceTurn = async (phase, index, message, events, status) => ({
  phase,
  index,
  message,
  events: eventTrace(events),
  sopStatus: snapshot(status),
  runtimeBinding: await persistedBinding(),
});

await mkdir(projectRoot, { recursive: true });
await writeFile(join(projectRoot, "approval-context.txt"), "The release scope changed: confirm owner impact before finalizing.\n", "utf8");
await writeFile(join(projectRoot, "pilotdeck.yaml"), YAML.stringify({
  schemaVersion: 1,
  agent: { model: selected, maxContextTokens: 65536, maxOutputTokens: 8192 },
  model: { providers: { [providerId]: provider } },
  modules: {
    agentLoop: { enabled: true, provider: "pilotdeck" },
    modelProvider: { enabled: true, provider: "pilotdeck" },
    tools: { enabled: true, provider: "pilotdeck" },
    sop: {
      enabled: true,
      provider: "staffdeck",
      endpoint,
      definitionsPath: publishedPath,
      defaultSopId: published.skill_id,
      timeoutMs: 30000,
      discoveryTimeoutMs: Number(process.env.STAFFDECK_SOP_DISCOVERY_TIMEOUT_MS ?? 120000),
      discoveryEndpoint,
      discoveryAgentId,
      discoveryApiKey,
    },
  },
}), "utf8");

let local;
let turns = [];
let current;
let nodeTransitions = [];
let wait;
let reloaded;
let resume;
let duplicate;
let postResumeTurns = [];
let finalStatus;
try {
  local = createLocalGateway({ projectRoot, pilotHome: projectRoot, fallbackProjectRoot: projectRoot });
  const recordNode = (status) => {
    const nodeId = status?.state?.active_step_id;
    if (typeof nodeId === "string" && nodeTransitions.at(-1) !== nodeId) nodeTransitions.push(nodeId);
  };
  for (const [index, message] of messages.entries()) {
    const events = await collect(local.gateway.submitTurn({ sessionKey, channelKey: "natural", workspaceCwd: projectRoot, message, mode: "default", canPrompt: false, allowedTools: ["read_file", "submit_step_result"] }));
    const errors = events.filter((event) => event.type === "error");
    assert.equal(errors.length, 0, JSON.stringify(summary(events)));
    current = await local.gateway.sopStatus({ sessionKey, projectKey: projectRoot });
    recordNode(current);
    if (turns.length === 0) {
      assert.equal(current?.state.selected_skill_id ?? current?.state.active_skill_id, published.skill_id);
      assert.equal(summary(events).find((event) => event.type === "tool_call_finished" && event.ok)?.toolName, "read_file");
    }
    turns.push(await traceTurn("ordinary", index + 1, message, events, current));
    if (current?.state.status === "handoff") break;
  }

  wait = current?.wait;
  assert.equal(current?.state.status, "handoff", JSON.stringify(snapshot(current)));
  assert.ok(wait?.id, JSON.stringify(snapshot(current)));
  assert.equal(wait.kind, "handoff");
  let afterResume;
  const before = current;
  await local.dispose();
  local = createLocalGateway({ projectRoot, pilotHome: projectRoot, fallbackProjectRoot: projectRoot });
  reloaded = await local.gateway.sopStatus({ sessionKey, projectKey: projectRoot });
  assert.equal(reloaded?.wait?.id, wait.id);
  recordNode(reloaded);
  resume = await local.gateway.resumeSop({
    sessionKey,
    projectKey: projectRoot,
    requestId: "natural-resume-1",
    waitId: wait.id,
    source: "human",
    message: "负责人已确认范围变化的影响，可以继续完成项目计划。",
    expectedRevision: before.revision,
    slotUpdates: { scope_confirmed: true },
  });
  duplicate = await local.gateway.resumeSop({ sessionKey, projectKey: projectRoot, requestId: "natural-resume-1", waitId: wait.id, source: "human", message: "重复确认" });
  assert.equal(resume.accepted, true);
  assert.equal(resume.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  const resumedStatus = await local.gateway.sopStatus({ sessionKey, projectKey: projectRoot });
  recordNode(resumedStatus);
  const postResume = [];
  postResumeTurns = [];
  for (const [index, message] of [
    resume.message,
    "请继续完成当前项目计划并按流程输出下一步。",
    "请输出最终行动清单，包含里程碑、负责人、风险和依赖。",
    "负责人已经确认范围变化的影响，请完成最终行动清单。",
    "请完成当前流程并给出最终行动清单。",
  ].entries()) {
    const events = await collect(local.gateway.submitTurn({ sessionKey, channelKey: "natural", workspaceCwd: projectRoot, message, mode: "default", canPrompt: false, allowedTools: ["read_file", "submit_step_result"] }));
    assert.equal(events.some((event) => event.type === "error"), false, JSON.stringify(summary(events)));
    postResume.push(...events);
    const status = await local.gateway.sopStatus({ sessionKey, projectKey: projectRoot });
    recordNode(status);
    postResumeTurns.push(await traceTurn("post_resume", index + 1, message, events, status));
    if (status?.state.status === "completed") break;
  }
  const finalAfterResume = await local.gateway.sopStatus({ sessionKey, projectKey: projectRoot });
  assert.equal(finalAfterResume?.state.status, "completed", JSON.stringify(snapshot(finalAfterResume)));
  recordNode(finalAfterResume);
  const runtimeBinding = await persistedBinding();
  assert.equal(runtimeBinding.skillId, published.skill_id);
  assert.equal(typeof runtimeBinding.version, "string");
  assert.equal(runtimeBinding.version, published.version);
  assert.equal(typeof finalAfterResume.state.slots_json?.scope_confirmed, "boolean");
  assert.ok(nodeTransitions.includes(wait.stepId), JSON.stringify({ nodeTransitions, wait }));
  assert.ok(nodeTransitions.includes(finalAfterResume.state.active_step_id), JSON.stringify({ nodeTransitions, finalAfterResume }));
  const discoveryCalls = serviceTrace.filter((entry) => entry.kind === "discovery");
  const discoverySelection = discoveryCalls.find((entry) => entry.response?.selected_sop_id === published.skill_id);
  assert.ok(discoverySelection, JSON.stringify({ discoveryCalls }));
  assert.ok(discoverySelection.response?.candidate_sop_ids?.includes(published.skill_id), JSON.stringify(discoverySelection));
  assert.ok(serviceTrace.some((entry) => entry.kind === "lifecycle" && entry.path === "/v1/sop/prepare" && entry.status === 200), JSON.stringify({ serviceTrace }));
  assert.ok(serviceTrace.some((entry) => entry.kind === "lifecycle" && entry.path === "/v1/sop/submit" && entry.status === 200), JSON.stringify({ serviceTrace }));
  afterResume = {
    reload: { status: snapshot(reloaded), sameWaitId: reloaded?.wait?.id === wait.id },
    resume: redact(resume),
    duplicate: redact(duplicate),
    status: snapshot(finalAfterResume),
  };

  finalStatus = await local.gateway.sopStatus({ sessionKey, projectKey: projectRoot });
  const result = {
    status: "passed",
    permissionMode: "default",
    provider: providerId,
    model: selected.slice(providerId.length + 1),
    modelSource: "REAL_MODEL_SOURCE_PILOT_HOME/pilotdeck.yaml",
    inputDefinition: { path: "products/pilotdeck-staffdeck-sop/evidence/g5-pilotdeck-page-published-1.2.1.json", skillId: published.skill_id, version: published.version },
    discovery: { endpoint: discoveryEndpoint, agentId: discoveryAgentId },
    published: { sopId: published.skill_id, version: published.version, nodes: published.content.nodes.length, edges: published.content.edges.length },
    inputContract: "ordinary project-delivery requests; no SOP tool name or result status in user messages",
    capabilityFilter: ["read_file", "submit_step_result"],
    firstBusinessTool: { toolName: "read_file", ok: true },
    runtimeBinding,
    selectedState: { skillId: published.skill_id, nodeTransitions },
    handoff: { waitId: wait.id, kind: wait.kind, stepId: wait.stepId, reloadedSameWaitId: afterResume.reload.sameWaitId },
    approval: { accepted: resume.accepted, duplicateReplay: duplicate.duplicate, source: "human" },
    terminal: { status: finalStatus.state.status, activeStep: finalStatus.state.active_step_id, scopeConfirmed: finalStatus.state.slots_json.scope_confirmed },
    trace: { ordinaryTurns: turns, postResumeTurns, reload: afterResume.reload, resume: afterResume.resume, duplicate: afterResume.duplicate, service: serviceTrace },
    reproduction: {
      command: "REAL_MODEL_SOURCE_PILOT_HOME=/path/to/pilot-home STAFFDECK_SOP_ENDPOINT=http://127.0.0.1:16205 STAFFDECK_SOP_DISCOVERY_ENDPOINT=http://127.0.0.1:16224/api/v1 STAFFDECK_SOP_DISCOVERY_AGENT_ID=agent_tenant_demo_overall STAFFDECK_SOP_DISCOVERY_API_KEY=<ephemeral> node products/pilotdeck-staffdeck-sop/evidence/g5-agentloop-natural-discovery-run.mjs",
      discoveryStartup: "DATABASE_URL=sqlite:////tmp/g5-real-chain-reverify.sqlite3 APP_SECRET=<ephemeral> DEMO_SEED_ENABLED=true DEMO_MODEL_BASE_URL=<provider1.url> DEMO_MODEL_NAME=qwen3.6-flash-distill DEMO_MODEL_API_KEY=<provider1.apiKey> backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 16224",
      lifecycleEndpoint: endpoint,
      cleanup: "Runner disposes createLocalGateway and removes its temporary project; terminate the isolated StaffDeck process and remove its temporary SQLite/WAL files after the run.",
    },
  };
  await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify({ status: result.status, permissionMode: "default", sop: `${published.skill_id}@${published.version}`, wait: wait?.id ?? null, terminal: finalStatus?.state.status ?? null }));
} catch (error) {
  const failure = {
    status: "failed",
    error: {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    current: snapshot(current),
    wait: wait ? redact(wait) : null,
    reload: reloaded ? snapshot(reloaded) : null,
    resume: resume ? redact(resume) : null,
    duplicate: duplicate ? redact(duplicate) : null,
    nodeTransitions,
    ordinaryTurns: turns,
    postResumeTurns,
    service: serviceTrace,
    inputDefinition: { path: publishedPath, skillId: published.skill_id, version: published.version },
    runtimeBinding: await persistedBinding(),
  };
  await writeFile(outputPath, JSON.stringify(failure, null, 2), "utf8");
  throw error;
} finally {
  await local?.dispose();
  globalThis.fetch = nativeFetch;
  await rm(root, { recursive: true, force: true });
}
