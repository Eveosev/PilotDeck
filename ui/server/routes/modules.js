import express from 'express';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getPilotDeckGateway } from '../pilotdeck-bridge.js';

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
  // A definition write is visible immediately on disk, but the active AgentLoop
  // keeps its previous snapshot until the process is restarted. Keep that
  // distinction explicit in the runtime contract so the UI can disable only
  // the affected workflow while the restart is pending.
  const unavailableSlots = new Set();
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
      const requestId = `knowledge-ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const messageId = `module-http-${requestId}`;
      const input = { ...(req.body ?? {}) };
      if (!input.baseId && typeof binding.defaultBaseId === 'string' && binding.defaultBaseId.trim()) {
        input.baseId = binding.defaultBaseId.trim();
      }
      if (!input.knowledgeBaseIds && typeof binding.defaultBaseId === 'string' && binding.defaultBaseId.trim()) {
        input.knowledgeBaseIds = [binding.defaultBaseId.trim()];
      }
      if (!input.tenantId && typeof binding.tenantId === 'string' && binding.tenantId.trim()) {
        input.tenantId = binding.tenantId.trim();
      }
      if (!input.actorUserId && typeof binding.actorUserId === 'string' && binding.actorUserId.trim()) {
        input.actorUserId = binding.actorUserId.trim();
      }
      if (input.limit === undefined && Number.isInteger(binding.resultLimit) && binding.resultLimit > 0) {
        input.limit = binding.resultLimit;
      }
      const response = await fetch(new URL(binding.callPath || '/v2/module/call', binding.endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(Number(binding.timeoutMs) || 10_000),
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
      return res.status(502).json({ error: { code: 'MODULE_QUERY_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) } });
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
      const requestId = `knowledge-ui-citation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const messageId = `module-http-${requestId}`;
      const input = { ...(req.body ?? {}) };
      if (!input.tenantId && typeof binding.tenantId === 'string' && binding.tenantId.trim()) {
        input.tenantId = binding.tenantId.trim();
      }
      if (!input.actorUserId && typeof binding.actorUserId === 'string' && binding.actorUserId.trim()) {
        input.actorUserId = binding.actorUserId.trim();
      }
      const response = await fetch(new URL(binding.callPath || '/v2/module/call', binding.endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(Number(binding.timeoutMs) || 10_000),
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
      return res.status(502).json({ error: { code: 'MODULE_CITATION_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) } });
    }
  });
  route.post('/knowledge/call', async (req, res) => {
    try {
      const binding = readConfig()?.modules?.knowledge;
      const operation = typeof req.body?.operation === 'string' ? req.body.operation : '';
      if (!KNOWLEDGE_OPERATIONS.has(operation)) {
        return res.status(400).json({ error: { code: 'MODULE_OPERATION_UNSUPPORTED', message: 'Knowledge operation is not part of staffdeck.knowledge/v1.' } });
      }
      if (binding?.enabled !== true || typeof binding.endpoint !== 'string') {
        return res.status(501).json({ error: { code: 'MODULE_DISABLED', message: 'Knowledge module is not configured for module calls.' } });
      }
      if (!Array.isArray(binding.methods) || !binding.methods.includes(operation)) {
        return res.status(409).json({ error: { code: 'MODULE_CAPABILITY_UNAVAILABLE', message: `Knowledge module does not advertise ${operation}.` } });
      }
      const input = withKnowledgeDefaults(binding, req.body?.input);
      const response = await callKnowledgeModule(binding, operation, input);
      if (!response.response.ok || !response.body || response.body.kind !== 'response' || response.body.inReplyTo !== response.messageId || response.body.ok !== true) {
        return res.status(response.response.status === 200 ? 502 : response.response.status).json({ error: { code: response.body?.code || 'MODULE_CALL_FAILED', message: response.body?.error?.message || 'Knowledge module call failed.' } });
      }
      return res.json({ result: response.body.payload?.result ?? response.body.payload });
    } catch (error) {
      return res.status(502).json({ error: { code: 'MODULE_CALL_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) } });
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
  route.get('/sop/management', (_req, res) => {
    try {
      const management = readSopManagement(readConfig()?.modules?.sop);
      return res.json({ enabled: true, methods: management.methods, agentId: management.agentId });
    } catch (error) {
      return res.status(501).json({ error: { code: 'SOP_MANAGEMENT_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) } });
    }
  });
  route.post('/sop/management/call', async (req, res) => {
    try {
      const operation = typeof req.body?.operation === 'string' ? req.body.operation : '';
      if (!SOP_MANAGEMENT_OPERATIONS.has(operation)) {
        return res.status(400).json({ error: { code: 'SOP_MANAGEMENT_OPERATION_UNSUPPORTED', message: 'SOP management operation is not supported.' } });
      }
      const management = readSopManagement(readConfig()?.modules?.sop);
      if (!management.methods.includes(operation)) {
        return res.status(409).json({ error: { code: 'SOP_MANAGEMENT_CAPABILITY_UNAVAILABLE', message: `SOP management does not advertise ${operation}.` } });
      }
      const result = await callSopManagement(management, operation, req.body?.input);
      return res.status(result.status).json({ result: result.body });
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

async function callKnowledgeModule(binding, operation, input) {
  const requestId = `knowledge-ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const messageId = `module-http-${requestId}`;
  const response = await fetch(new URL(binding.callPath || '/v2/module/call', binding.endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(Number(binding.timeoutMs) || 10_000),
    body: JSON.stringify({
      kind: 'request', messageId, method: 'module_call', runId: 'knowledge-ui', operationId: `knowledge-ui-${operation}`, requestId,
      module: 'knowledge', payload: { operation, input },
    }),
  });
  return { response, body: await response.json().catch(() => undefined), messageId };
}

function withKnowledgeDefaults(binding, value) {
  const input = isRecord(value) ? { ...value } : {};
  if (!input.baseId && typeof binding.defaultBaseId === 'string' && binding.defaultBaseId.trim()) input.baseId = binding.defaultBaseId.trim();
  if (!input.knowledgeBaseIds && typeof binding.defaultBaseId === 'string' && binding.defaultBaseId.trim()) input.knowledgeBaseIds = [binding.defaultBaseId.trim()];
  if (!input.tenantId && typeof binding.tenantId === 'string' && binding.tenantId.trim()) input.tenantId = binding.tenantId.trim();
  if (!input.actorUserId && typeof binding.actorUserId === 'string' && binding.actorUserId.trim()) input.actorUserId = binding.actorUserId.trim();
  if (input.limit === undefined && Number.isInteger(binding.resultLimit) && binding.resultLimit > 0) input.limit = binding.resultLimit;
  return input;
}

function readSopDefinitions(binding) {
  if (binding?.enabled !== true || typeof binding.definitionsPath !== 'string') {
    throw new Error('StaffDeck SOP definitions are not configured.');
  }
  if (!existsSync(binding.definitionsPath)) throw new Error('StaffDeck SOP definitions file does not exist.');
  const parsed = parseYaml(readFileSync(binding.definitionsPath, 'utf8'));
  const bundle = Array.isArray(parsed) ? { sops: parsed } : parsed;
  validateSopBundle(bundle);
  return bundle;
}

function readSopManagement(binding) {
  const management = binding?.management;
  if (!isRecord(management) || management.enabled !== true || typeof management.endpoint !== 'string' || !management.endpoint.trim()) {
    throw new Error('StaffDeck public SOP management is not configured.');
  }
  const apiKey = typeof management.apiKey === 'string' && management.apiKey.trim()
    ? management.apiKey
    : typeof management.apiKeyEnv === 'string' && management.apiKeyEnv.trim()
      ? process.env[management.apiKeyEnv]
      : undefined;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('StaffDeck public SOP management credentials are not configured.');
  }
  if (typeof management.agentId !== 'string' || !management.agentId.trim()) {
    throw new Error('StaffDeck public SOP management requires an agentId.');
  }
  const methods = Array.isArray(management.methods) ? management.methods.filter((item) => SOP_MANAGEMENT_OPERATIONS.has(item)) : [];
  if (methods.length === 0) throw new Error('StaffDeck public SOP management does not declare any supported methods.');
  return { endpoint: management.endpoint.endsWith('/') ? management.endpoint : `${management.endpoint}/`, apiKey, agentId: management.agentId, methods, timeoutMs: Number(management.timeoutMs) || 10_000 };
}

async function callSopManagement(management, operation, value) {
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
      method = 'POST'; target = `agents/${path(management.agentId)}/sops`; body = { content: input.content }; break;
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
  const response = await fetch(new URL(target, management.endpoint), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(management.timeoutMs) });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw Object.assign(new Error(payload?.error?.message || payload?.detail || `StaffDeck SOP management request failed (${response.status}).`), { code: payload?.error?.code || 'SOP_MANAGEMENT_UPSTREAM_FAILED', status: response.status });
  }
  if (isRecord(payload) && !payload.etag && ['get_draft', 'replace_draft'].includes(operation) && response.headers.get('etag')) payload.etag = response.headers.get('etag');
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
