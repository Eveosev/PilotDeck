import express from 'express';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getPilotDeckGateway } from '../pilotdeck-bridge.js';
import { bindModuleRequestAbort, moduleUpstreamSignal } from '../module-request-abort.js';
import { createStaffDeckPublishRoute } from '../staffdeck-publish-route.js';
import { createStaffDeckCopyRouter, verifyStaffDeckKnowledgeBinding } from './staffdeck-copy.js';

const router = express.Router();
const SLOTS = ['agentLoop', 'skills', 'tools', 'context', 'modelProvider', 'sop', 'knowledge'];
const PUBLIC_FIELDS = ['enabled', 'provider', 'implementationId', 'frontendModule', 'contract', 'transport', 'methods'];
const KNOWLEDGE_OPERATIONS = new Set([
  'list_bases', 'create_base', 'get_base', 'update_base', 'delete_base', 'list_versions',
  'sync_base', 'publish_version', 'rollback_version', 'list_documents', 'get_document',
  'import_document', 'import_okf', 'update_document', 'delete_document', 'list_document_buckets',
  'update_bucket', 'list_bucket_chunks', 'update_chunk', 'get_job', 'list_jobs', 'cancel_job',
  'list_okf_concepts', 'get_okf_concept', 'upsert_okf_concept', 'export_okf', 'lint_okf',
  'list_discoveries', 'confirm_discovery', 'reject_discovery', 'query', 'resolve_citation',
]);
const KNOWLEDGE_READ_OPERATIONS = new Set([
  'list_bases', 'get_base', 'list_versions', 'list_documents', 'get_document',
  'list_document_buckets', 'list_bucket_chunks', 'get_job', 'list_jobs',
  'list_okf_concepts', 'get_okf_concept', 'export_okf', 'list_discoveries', 'query', 'resolve_citation',
]);
const SOP_MANAGEMENT_OPERATIONS = new Set([
  'list', 'create', 'get_draft', 'replace_draft', 'validate',
  'publish', 'archive', 'list_versions', 'get_version', 'rollback',
]);

/**
 * Return the sanitized runtime composition used by the generated frontend.
 * Endpoint URLs, credentials, deployment paths and SOP definitions never cross
 * this boundary. Module bindings are read from the service's active profile;
 * Gateway capabilities are supplemental and must not prevent module pages from
 * mounting while the chat runtime is starting or temporarily unavailable.
 */
export function createModuleRuntimeRouter({ loadConfig, getGateway = getPilotDeckGateway } = {}) {
  const readConfig = loadConfig ?? (() => {
    const path = process.env.PILOTDECK_CONFIG_PATH || join(process.env.PILOT_HOME || join(homedir(), '.pilotdeck'), 'pilotdeck.yaml');
    if (!existsSync(path)) return {};
    try { return parseYaml(readFileSync(path, 'utf8')) ?? {}; } catch { return {}; }
  });
  const route = express.Router();
  route.use((req, res, next) => {
    req.moduleRequestSignal = bindModuleRequestAbort(req, res);
    next();
  });
  route.use('/staffdeck-copy', createStaffDeckCopyRouter({ loadConfig: readConfig }));
  // A definition write is visible immediately on disk, but the active AgentLoop
  // keeps its previous snapshot until the process is restarted. Keep that
  // distinction explicit in the runtime contract so the UI can disable only
  // the affected workflow while the restart is pending.
  const unavailableSlots = new Set();
  const publishRuntime = createStaffDeckPublishRoute({ getGateway });
  route.get('/runtime', async (_req, res) => {
    try {
      const config = readConfig() ?? {};
      const modules = Object.fromEntries(SLOTS.map((slot) => {
        const value = config.modules?.[slot];
        if (value === undefined) return [slot, { enabled: slot === 'sop' || slot === 'knowledge' ? false : true, provider: 'pilotdeck' }];
        const sanitized = Object.fromEntries(PUBLIC_FIELDS
          .filter((field) => value[field] !== undefined)
          .map((field) => [field, field === 'methods' && Array.isArray(value[field]) ? [...value[field]] : value[field]]));
        return [slot, sanitized];
      }));
      const gateway = await readGatewayCapabilities(getGateway);
      return res.json({
        modules,
        gatewayCapabilities: gateway.capabilities,
        runtime: {
          gatewayState: gateway.state,
          unavailableSlots: [...unavailableSlots],
        },
      });
    } catch (error) {
      return res.status(503).json({
        error: { code: 'MODULE_RUNTIME_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });
  route.post('/knowledge/query', async (req, res) => {
    try {
      const binding = readConfig()?.modules?.knowledge;
      if (binding?.enabled !== true || typeof binding.endpoint !== 'string') {
        return res.status(501).json({ error: { code: 'MODULE_DISABLED', message: 'Knowledge module is not configured for HTTP queries.' } });
      }
      if (!Array.isArray(binding.methods) || !binding.methods.includes('query')) {
        return res.status(409).json({ error: { code: 'MODULE_CAPABILITY_UNAVAILABLE', message: 'Knowledge module does not advertise query.' } });
      }
      if (!hasKnowledgeIdentity(binding)) {
        return res.status(501).json({ error: { code: 'MODULE_IDENTITY_UNAVAILABLE', message: 'Knowledge module requires a server-configured tenantId and actorUserId.' } });
      }
      const requestId = `knowledge-ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await verifyStaffDeckKnowledgeBinding(readConfig(), req.user, binding, req.body, req.moduleRequestSignal);
      const messageId = `module-http-${requestId}`;
      const input = withTrustedKnowledgeIdentity(binding, req.body);
      if (!input.baseId && typeof binding.defaultBaseId === 'string' && binding.defaultBaseId.trim()) {
        input.baseId = binding.defaultBaseId.trim();
      }
      if (!input.knowledgeBaseIds && typeof binding.defaultBaseId === 'string' && binding.defaultBaseId.trim()) {
        input.knowledgeBaseIds = [binding.defaultBaseId.trim()];
      }
      if (input.limit === undefined && Number.isInteger(binding.resultLimit) && binding.resultLimit > 0) {
        input.limit = binding.resultLimit;
      }
      const response = await fetch(new URL(binding.callPath || '/v2/module/call', binding.endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: moduleUpstreamSignal(req.moduleRequestSignal, Number(binding.timeoutMs) || 10_000),
        body: JSON.stringify({
          kind: 'request', messageId, method: 'module_call', runId: 'knowledge-ui', operationId: 'knowledge-ui', requestId,
          module: 'knowledge', payload: { operation: 'query', input },
        }),
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok || !body || body.kind !== 'response' || body.inReplyTo !== messageId || body.ok !== true) {
        return res.status(response.ok ? 502 : response.status).json({ error: { code: body?.code || 'MODULE_QUERY_FAILED', message: body?.error?.message || 'Knowledge module query failed.' } });
      }
      return res.json({ result: body.payload?.result ?? body.payload });
    } catch (error) {
      return res.status(error?.status || 502).json({ error: { code: error?.code || 'MODULE_QUERY_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) } });
    }
  });
  route.post('/knowledge/citation', async (req, res) => {
    try {
      const binding = readConfig()?.modules?.knowledge;
      if (binding?.enabled !== true || typeof binding.endpoint !== 'string') {
        return res.status(501).json({ error: { code: 'MODULE_DISABLED', message: 'Knowledge module is not configured for HTTP citations.' } });
      }
      if (!Array.isArray(binding.methods) || !binding.methods.includes('resolve_citation')) {
        return res.status(409).json({ error: { code: 'MODULE_CAPABILITY_UNAVAILABLE', message: 'Knowledge module does not advertise resolve_citation.' } });
      }
      if (!hasKnowledgeIdentity(binding)) {
        return res.status(501).json({ error: { code: 'MODULE_IDENTITY_UNAVAILABLE', message: 'Knowledge module requires a server-configured tenantId and actorUserId.' } });
      }
      const requestId = `knowledge-ui-citation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await verifyStaffDeckKnowledgeBinding(readConfig(), req.user, binding, req.body, req.moduleRequestSignal);
      const messageId = `module-http-${requestId}`;
      const input = withTrustedKnowledgeIdentity(binding, req.body);
      const response = await fetch(new URL(binding.callPath || '/v2/module/call', binding.endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: moduleUpstreamSignal(req.moduleRequestSignal, Number(binding.timeoutMs) || 10_000),
        body: JSON.stringify({
          kind: 'request', messageId, method: 'module_call', runId: 'knowledge-ui', operationId: 'knowledge-ui-citation', requestId,
          module: 'knowledge', payload: { operation: 'resolve_citation', input },
        }),
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok || !body || body.kind !== 'response' || body.inReplyTo !== messageId || body.ok !== true) {
        return res.status(response.ok ? 502 : response.status).json({ error: { code: body?.code || 'MODULE_CITATION_FAILED', message: body?.error?.message || 'Knowledge citation resolve failed.' } });
      }
      return res.json({ result: body.payload?.result ?? body.payload });
    } catch (error) {
      return res.status(error?.status || 502).json({ error: { code: error?.code || 'MODULE_CITATION_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) } });
    }
  });
  route.post('/knowledge/call', async (req, res) => {
    try {
      const binding = readConfig()?.modules?.knowledge;
      const operation = typeof req.body?.operation === 'string' ? req.body.operation : '';
      if (!KNOWLEDGE_OPERATIONS.has(operation)) {
        return res.status(400).json({ error: { code: 'MODULE_OPERATION_UNSUPPORTED', message: 'Knowledge operation is not part of staffdeck.knowledge/v1.' } });
      }
      if (!KNOWLEDGE_READ_OPERATIONS.has(operation) && process.env.PILOTDECK_MODULE_ADMIN === '0') {
        return res.status(403).json({ error: { code: 'MODULE_ADMIN_REQUIRED', message: 'Knowledge write operations require the PilotDeck module administrator.' } });
      }
      if (binding?.enabled !== true || typeof binding.endpoint !== 'string') {
        return res.status(501).json({ error: { code: 'MODULE_DISABLED', message: 'Knowledge module is not configured for module calls.' } });
      }
      if (!hasKnowledgeIdentity(binding)) {
        return res.status(501).json({ error: { code: 'MODULE_IDENTITY_UNAVAILABLE', message: 'Knowledge module requires a server-configured tenantId and actorUserId.' } });
      }
      if (!Array.isArray(binding.methods) || !binding.methods.includes(operation)) {
        return res.status(409).json({ error: { code: 'MODULE_CAPABILITY_UNAVAILABLE', message: `Knowledge module does not advertise ${operation}.` } });
      }
      const input = withKnowledgeDefaults(binding, req.body?.input);
      await verifyStaffDeckKnowledgeBinding(readConfig(), req.user, binding, req.body?.input, req.moduleRequestSignal);
      const response = await callKnowledgeModule(binding, operation, input, req.moduleRequestSignal);
      if (!response.response.ok || !response.body || response.body.kind !== 'response' || response.body.inReplyTo !== response.messageId || response.body.ok !== true) {
        return res.status(response.response.status === 200 ? 502 : response.response.status).json({ error: { code: response.body?.code || 'MODULE_CALL_FAILED', message: response.body?.error?.message || 'Knowledge module call failed.' } });
      }
      return res.json({ result: response.body.payload?.result ?? response.body.payload });
    } catch (error) {
      return res.status(error?.status || 502).json({ error: { code: error?.code || 'MODULE_CALL_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) } });
    }
  });
  route.get('/sop/definitions', (_req, res) => {
    try {
      const binding = readConfig()?.modules?.sop;
      const bundle = readSopDefinitions(binding);
      return res.json({ defaultSopId: binding.defaultSopId, definitions: bundle.sops });
    } catch (error) {
      return res.status(501).json({ error: { code: 'SOP_DEFINITIONS_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) } });
    }
  });
  route.put('/sop/definitions/:definitionId', (req, res) => {
    try {
      const binding = readConfig()?.modules?.sop;
      const definitionId = typeof req.params.definitionId === 'string' ? req.params.definitionId.trim() : '';
      const definition = req.body?.definition;
      if (!definitionId || !isRecord(definition) || text(definition.id) !== definitionId) {
        return res.status(400).json({ error: { code: 'SOP_DEFINITION_INVALID', message: 'The definition id must match the requested definition.' } });
      }
      const bundle = readSopDefinitions(binding);
      const index = bundle.sops.findIndex((item) => text(item.id) === definitionId);
      if (index < 0) return res.status(404).json({ error: { code: 'SOP_DEFINITION_NOT_FOUND', message: 'SOP definition was not found.' } });
      const next = { ...bundle, sops: bundle.sops.map((item, itemIndex) => itemIndex === index ? definition : item) };
      validateSopBundle(next);
      writeFileSync(binding.definitionsPath, stringifyYaml(next), 'utf8');
      unavailableSlots.add('sop');
      return res.json({ definition, restartRequired: true });
    } catch (error) {
      return res.status(422).json({ error: { code: 'SOP_DEFINITION_SAVE_FAILED', message: error instanceof Error ? error.message : String(error) } });
    }
  });
  route.get('/sop/management', async (req, res) => {
    try {
      const config = readConfig();
      const management = readSopManagement(config);
      const owner = await verifySopManagementIdentity(config, management, req.user, req.moduleRequestSignal);
      const runtime = await publishRuntime.read({ binding: config.modules?.sop, management, owner });
      return res.json({ enabled: true, methods: management.methods, agentId: management.agentId, runtime });
    } catch (error) {
      return res.status(Number.isInteger(error?.status) ? error.status : 502).json({ error: { code: error?.code || 'SOP_MANAGEMENT_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) } });
    }
  });
  route.post('/sop/management/call', async (req, res) => {
    try {
      const operation = typeof req.body?.operation === 'string' ? req.body.operation : '';
      if (!SOP_MANAGEMENT_OPERATIONS.has(operation)) {
        return res.status(400).json({ error: { code: 'SOP_MANAGEMENT_OPERATION_UNSUPPORTED', message: 'SOP management operation is not supported.' } });
      }
      const config = readConfig();
      const management = readSopManagement(config);
      if (!management.methods.includes(operation)) {
        return res.status(409).json({ error: { code: 'SOP_MANAGEMENT_CAPABILITY_UNAVAILABLE', message: `SOP management does not advertise ${operation}.` } });
      }
      const owner = await verifySopManagementIdentity(config, management, req.user, req.moduleRequestSignal);
      const publish = () => callSopManagement(management, operation, req.body?.input, req.moduleRequestSignal);
      const result = operation === 'publish'
        ? await publishRuntime.publish({ binding: config.modules?.sop, management, owner, sopId: text(req.body?.input?.sopId), publish })
        : await publish();
      return res.status(result.status).json({ result: result.body, ...(result.runtime ? { runtime: result.runtime } : {}) });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 502;
      return res.status(status).json({ error: { code: error?.code || 'SOP_MANAGEMENT_CALL_FAILED', message: error instanceof Error ? error.message : String(error) } });
    }
  });
  return route;
}

async function readGatewayCapabilities(getGateway) {
  // A module page does not need an active chat Gateway to render its own
  // profile-backed controls. Keep this best-effort to avoid blocking the full
  // application during the bridge's long startup retry window.
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Gateway capability check timed out.')), 1_000);
  });
  try {
    const gateway = await Promise.race([getGateway(), timeout]);
    const server = await Promise.race([gateway.describeServer(), timeout]);
    return { state: 'ready', capabilities: Array.isArray(server?.capabilities) ? server.capabilities : [] };
  } catch {
    return { state: 'unavailable', capabilities: [] };
  }
}

async function callKnowledgeModule(binding, operation, input, signal) {
  const requestId = `knowledge-ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const messageId = `module-http-${requestId}`;
  const response = await fetch(new URL(binding.callPath || '/v2/module/call', binding.endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: moduleUpstreamSignal(signal, Number(binding.timeoutMs) || 10_000),
    body: JSON.stringify({
      kind: 'request', messageId, method: 'module_call', runId: 'knowledge-ui', operationId: `knowledge-ui-${operation}`, requestId,
      module: 'knowledge', payload: { operation, input },
    }),
  });
  return { response, body: await response.json().catch(() => undefined), messageId };
}

function withKnowledgeDefaults(binding, value) {
  const input = withTrustedKnowledgeIdentity(binding, value);
  if (!input.baseId && typeof binding.defaultBaseId === 'string' && binding.defaultBaseId.trim()) input.baseId = binding.defaultBaseId.trim();
  if (!input.knowledgeBaseIds && typeof binding.defaultBaseId === 'string' && binding.defaultBaseId.trim()) input.knowledgeBaseIds = [binding.defaultBaseId.trim()];
  if (input.limit === undefined && Number.isInteger(binding.resultLimit) && binding.resultLimit > 0) input.limit = binding.resultLimit;
  return input;
}

function withTrustedKnowledgeIdentity(binding, value) {
  const input = isRecord(value) ? { ...value } : {};
  if (typeof binding?.tenantId === 'string' && binding.tenantId.trim()) {
    input.tenantId = binding.tenantId.trim();
    input.tenant_id = binding.tenantId.trim();
  } else {
    delete input.tenantId;
    delete input.tenant_id;
  }
  if (typeof binding?.actorUserId === 'string' && binding.actorUserId.trim()) {
    input.actorUserId = binding.actorUserId.trim();
    input.actor_user_id = binding.actorUserId.trim();
  } else {
    delete input.actorUserId;
    delete input.actor_user_id;
  }
  return input;
}

function hasKnowledgeIdentity(binding) {
  return typeof binding?.tenantId === 'string' && Boolean(binding.tenantId.trim())
    && typeof binding?.actorUserId === 'string' && Boolean(binding.actorUserId.trim());
}

function readSopDefinitions(binding) {
  if (binding?.enabled !== true || typeof binding.definitionsPath !== 'string') {
    throw new Error('StaffDeck SOP definitions are not configured.');
  }
  if (!existsSync(binding.definitionsPath)) throw new Error('StaffDeck SOP definitions file does not exist.');
  const parsed = parseYaml(readFileSync(binding.definitionsPath, 'utf8'));
  // Management GETs return one published SOP object, while the portable
  // definition host stores a bundle. Accept both shapes so an exact
  // page-published response can be replayed without reshaping the evidence.
  const bundle = Array.isArray(parsed)
    ? { sops: parsed }
    : isRecord(parsed) && text(parsed.skill_id) && isRecord(parsed.content)
      ? { sops: [parsed] }
      : parsed;
  validateSopBundle(bundle);
  return bundle;
}

function managementError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function configuredValue(binding, name) {
  return text(binding?.[name]) || text(process.env[text(binding?.[`${name}Env`])]);
}

function readSopManagement(config) {
  const management = config?.modules?.sop?.management;
  const endpoint = configuredValue(management, 'endpoint');
  if (!isRecord(management) || management.enabled !== true || !endpoint) {
    throw managementError(501, 'SOP_MANAGEMENT_UNAVAILABLE', 'StaffDeck public SOP management is not configured.');
  }
  const apiKey = text(process.env[text(management.apiKeyEnv)]);
  const credentialId = configuredValue(management, 'credentialId');
  if (!apiKey || !credentialId) {
    throw managementError(501, 'SOP_MANAGEMENT_UNAVAILABLE', 'StaffDeck public SOP management account credential is not configured.');
  }
  const agentId = configuredValue(management, 'agentId');
  if (!agentId) {
    throw managementError(501, 'SOP_MANAGEMENT_UNAVAILABLE', 'StaffDeck public SOP management requires an agentId.');
  }
  const methods = Array.isArray(management.methods) ? management.methods.filter((item) => SOP_MANAGEMENT_OPERATIONS.has(item)) : [];
  if (methods.length === 0) throw managementError(501, 'SOP_MANAGEMENT_UNAVAILABLE', 'StaffDeck public SOP management does not declare any supported methods.');
  return { endpoint: endpoint.endsWith('/') ? endpoint : `${endpoint}/`, apiKey, credentialId, agentId, methods, timeoutMs: Number(management.timeoutMs) || 10_000 };
}

async function verifySopManagementIdentity(config, management, user, signal) {
  const copy = config?.webui?.staffdeckCopy;
  if (copy?.enabled !== true || copy?.contract !== 'staffdeck.enterprise-copy/v1') {
    throw managementError(501, 'SOP_MANAGEMENT_UNAVAILABLE', 'StaffDeck copy identity is not enabled for SOP management.');
  }
  const pilotDeckUserId = configuredValue(copy, 'pilotDeckUserId');
  const tenantId = configuredValue(copy, 'tenantId');
  const actorUserId = configuredValue(copy, 'actorUserId');
  const targetAgentId = configuredValue(copy, 'targetAgentId');
  const token = text(process.env[text(copy?.userTokenEnv)]);
  let origin;
  try {
    const copyUrl = new URL(configuredValue(copy, 'endpoint'));
    const managementUrl = new URL(management.endpoint);
    if (!['http:', 'https:'].includes(copyUrl.protocol) || copyUrl.origin !== managementUrl.origin) throw new Error('Different StaffDeck origins');
    origin = copyUrl.origin;
  } catch {
    throw managementError(501, 'SOP_MANAGEMENT_UNAVAILABLE', 'StaffDeck copy and SOP management must use the same formal service.');
  }
  if (!pilotDeckUserId || !tenantId || !actorUserId || !targetAgentId || !token) {
    throw managementError(501, 'SOP_MANAGEMENT_UNAVAILABLE', 'StaffDeck SOP management identity binding is incomplete.');
  }
  if (String(user?.id ?? '') !== pilotDeckUserId) {
    throw managementError(403, 'SOP_MANAGEMENT_USER_FORBIDDEN', 'This PilotDeck user is not bound to StaffDeck management.');
  }
  if (management.agentId !== targetAgentId) {
    throw managementError(409, 'SOP_MANAGEMENT_TARGET_MISMATCH', 'StaffDeck SOP management target differs from the copy target.');
  }
  const officialGet = async (path) => {
    const response = await fetch(new URL(path, origin), {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'error', signal: moduleUpstreamSignal(signal, management.timeoutMs),
    });
    if (!response.ok) throw managementError(response.status, 'SOP_MANAGEMENT_IDENTITY_REJECTED', `StaffDeck rejected the configured user credential (${response.status}).`);
    return response.json();
  };
  const actor = await officialGet('/api/auth/me');
  if (actor?.id !== actorUserId || actor?.tenant_id !== tenantId || actor?.disabled === true) {
    throw managementError(403, 'SOP_MANAGEMENT_ACTOR_MISMATCH', 'StaffDeck authenticated a different actor or tenant.');
  }
  const credentials = await officialGet('/api/auth/me/api-credentials');
  const credential = Array.isArray(credentials) ? credentials.find((item) => item?.id === management.credentialId) : undefined;
  const prefix = credential?.key_prefix?.endsWith('…') ? credential.key_prefix.slice(0, -1) : '';
  if (!credential || credential.user_id !== actorUserId || prefix.length !== 20 || !management.apiKey.startsWith(prefix)) {
    throw managementError(403, 'SOP_MANAGEMENT_CREDENTIAL_MISMATCH', 'The account key is not the configured actor credential.');
  }
  if (credential.status !== 'active' || credential.revoked_at || (credential.expires_at && Date.parse(credential.expires_at) <= Date.now())) {
    throw managementError(401, 'SOP_MANAGEMENT_CREDENTIAL_INACTIVE', 'The StaffDeck account credential is inactive.');
  }
  if (credential.access !== 'user_full_access' || !['sops:read', 'sops:write', 'sops:publish'].every((scope) => credential.scopes?.includes(scope))) {
    throw managementError(403, 'SOP_MANAGEMENT_SCOPE_FORBIDDEN', 'The StaffDeck account credential lacks SOP management scopes.');
  }
  return { tenantId, actorUserId, agentId: targetAgentId, credentialId: management.credentialId };
}

async function callSopManagement(management, operation, value, signal) {
  const input = isRecord(value) ? value : {};
  const sopId = text(input.sopId);
  const version = text(input.version);
  const draftId = text(input.draftId);
  const path = (...segments) => segments.map((segment) => encodeURIComponent(segment)).join('/');
  let method = 'GET';
  let target;
  let body;
  switch (operation) {
    case 'list': target = `agents/${path(management.agentId)}/sops`; break;
    case 'create':
      method = 'POST'; target = `agents/${path(management.agentId)}/sops`;
      if (!isRecord(input.content)) throw managementError(400, 'SOP_CONTENT_REQUIRED', 'SOP creation requires the selected content.');
      if (sopId && input.content.skill_id !== undefined && input.content.skill_id !== sopId) {
        throw managementError(400, 'SOP_ID_MISMATCH', 'SOP content must match the selected SOP.');
      }
      body = { content: sopId ? { ...input.content, skill_id: sopId } : input.content };
      break;
    case 'get_draft':
      required(sopId, 'sopId'); required(draftId, 'draftId'); target = `agents/${path(management.agentId)}/sops/${path(sopId)}/drafts/${path(draftId)}`; break;
    case 'replace_draft':
      required(sopId, 'sopId'); required(draftId, 'draftId'); method = 'PUT'; target = `agents/${path(management.agentId)}/sops/${path(sopId)}?draft_id=${encodeURIComponent(draftId)}`; body = { content: input.content }; break;
    case 'validate':
      required(sopId, 'sopId'); required(draftId, 'draftId'); method = 'POST'; target = `sops/${path(sopId)}:validate?agent_id=${encodeURIComponent(management.agentId)}&draft_id=${encodeURIComponent(draftId)}`; break;
    case 'publish':
      required(sopId, 'sopId'); required(draftId, 'draftId'); method = 'POST'; target = `sops/${path(sopId)}:publish?agent_id=${encodeURIComponent(management.agentId)}`; body = { draft_id: draftId }; break;
    case 'archive':
      required(sopId, 'sopId'); method = 'POST'; target = `sops/${path(sopId)}:archive?agent_id=${encodeURIComponent(management.agentId)}`; break;
    case 'list_versions':
      required(sopId, 'sopId'); target = `sops/${path(sopId)}/versions?agent_id=${encodeURIComponent(management.agentId)}`; break;
    case 'get_version':
      required(sopId, 'sopId'); required(version, 'version'); target = `sops/${path(sopId)}/versions/${path(version)}?agent_id=${encodeURIComponent(management.agentId)}`; break;
    case 'rollback':
      required(sopId, 'sopId'); required(version, 'version'); method = 'POST'; target = `sops/${path(sopId)}/versions/${path(version)}:rollback?agent_id=${encodeURIComponent(management.agentId)}`; break;
    default: throw Object.assign(new Error('Unsupported SOP management operation.'), { code: 'SOP_MANAGEMENT_OPERATION_UNSUPPORTED', status: 400 });
  }
  const headers = { accept: 'application/json', authorization: `Bearer ${management.apiKey}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (operation === 'replace_draft') {
    required(text(input.etag), 'etag');
    headers['if-match'] = text(input.etag);
  }
  const response = await fetch(new URL(target, management.endpoint), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: moduleUpstreamSignal(signal, management.timeoutMs) });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw Object.assign(new Error(payload?.error?.message || payload?.detail || `StaffDeck SOP management request failed (${response.status}).`), { code: payload?.error?.code || 'SOP_MANAGEMENT_UPSTREAM_FAILED', status: response.status });
  }
  if (isRecord(payload) && !payload.etag && ['create', 'get_draft', 'replace_draft', 'rollback'].includes(operation) && response.headers.get('etag')) payload.etag = response.headers.get('etag');
  return { status: response.status, body: payload };
}

function required(value, field) {
  if (!value) throw Object.assign(new Error(`${field} is required.`), { code: 'SOP_MANAGEMENT_INPUT_INVALID', status: 400 });
}

function validateSopBundle(bundle) {
  if (!isRecord(bundle) || !Array.isArray(bundle.sops) || bundle.sops.length === 0) {
    throw new Error('StaffDeck SOP definitions must contain a non-empty sops list.');
  }
  const ids = new Set();
  for (const definition of bundle.sops) {
    const id = isRecord(definition) ? text(definition.id) : undefined;
    if (!id) throw new Error('Every StaffDeck SOP definition must have an id.');
    if (ids.has(id)) throw new Error(`StaffDeck SOP definitions contain duplicate id '${id}'.`);
    ids.add(id);
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export default createModuleRuntimeRouter;
