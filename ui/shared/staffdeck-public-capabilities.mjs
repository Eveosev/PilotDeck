/** Public protocol helpers only. The host owns authentication, PEP and operation authorization. */
export class PublicCapabilityError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'PublicCapabilityError';
    this.code = code;
    this.status = status;
  }
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, status) => { throw new PublicCapabilityError(code, message, status); };
const id = value => {
  if (typeof value !== 'string' || !value.trim()) fail('PUBLIC_INPUT_INVALID', 'A non-empty resource ID is required.', 400);
  return encodeURIComponent(value);
};
const own = (value, key) => Object.hasOwn(value, key);

export const PUBLIC_PROTOCOL_BLOCKERS = Object.freeze({
  rewrite_preview: 'The existing rewrite route does not accept dirty current_skill or conversation and persists a new draft.',
  move_to_draft: 'Creating a draft does not change the original published object to draft.',
  remove: 'Archive and binding omission do not preserve hidden/deleted branch semantics.',
  sync_from_overall: 'No equivalent public route in the audited v1 contract.',
  promote_to_overall: 'No equivalent public route preserving the original admin rule.',
  delete_version: 'No equivalent public route preserving overall-only and active-version rejection.',
  probe_tool: 'Testing an existing tool ID does not probe an unsaved tool.',
  delete_tool: 'Archiving a binding does not delete a tool.',
  extract_sop_file: 'Knowledge upload writes a knowledge resource; it is not SOP text extraction.',
  model_catalog: 'Agent model bindings are not an effective selectable model catalog.',
  user_catalog: 'Handoff records are not a visible user directory.',
  cancel_job: 'Account cancellation scope and host operation authorization remain pending.',
});

function publicBody(input) {
  if (!record(input.body)) fail('PUBLIC_INPUT_INVALID', 'An explicit public request body is required.', 400);
  for (const field of ['tenant_id', 'agent_id', 'user_id', 'actor_user_id']) {
    if (own(input.body, field)) fail('PUBLIC_SCOPE_OVERRIDE', `Host identity field ${field} cannot be supplied in the public body.`, 400);
  }
  return structuredClone(input.body);
}

function rejectMaskedCredentials(body) {
  for (const object of [body.headers, body.auth, body.connection?.headers, body.connection?.env]) {
    if (record(object) && Object.values(object).some(value => value === '********')) {
      fail('PUBLIC_MASKED_CREDENTIAL', 'Masked credentials cannot be written back; submit an explicit supported update.', 400);
    }
  }
}

/** Explicit route map, never an arbitrary URL proxy. IDs are encoded once by this layer. */
export function planPublicOperation(agentId, operation, input = {}) {
  const agent = `agents/${id(agentId)}`;
  const plan = { method: 'GET', headers: { accept: 'application/json' } };
  if (own(PUBLIC_PROTOCOL_BLOCKERS, operation)) fail('PUBLIC_PROTOCOL_UNAVAILABLE', PUBLIC_PROTOCOL_BLOCKERS[operation]);
  switch (operation) {
    case 'list_tools': plan.path = `${agent}/tools`; plan.shape = 'collection'; break;
    case 'list_general_skills': plan.path = `${agent}/general-skills`; plan.shape = 'collection'; break;
    case 'create_tool':
    case 'update_tool':
      plan.method = operation === 'create_tool' ? 'POST' : 'PUT';
      plan.path = `${agent}/tools${operation === 'update_tool' ? `/${id(input.toolId)}` : ''}`;
      plan.body = publicBody(input);
      rejectMaskedCredentials(plan.body);
      break;
    case 'test_tool':
      plan.method = 'POST'; plan.path = `${agent}/tools/${id(input.toolId)}:test`; plan.body = publicBody(input); break;
    case 'import_general_skill':
      plan.method = 'POST'; plan.path = `${agent}/general-skills`; plan.body = publicBody(input); break;
    case 'publish_general_skill':
    case 'archive_general_skill':
    case 'test_general_skill': {
      const action = operation.split('_')[0];
      plan.method = 'POST'; plan.path = `${agent}/general-skills/${id(input.slug)}:${action}`;
      if (action === 'test') plan.body = publicBody(input);
      break;
    }
    case 'generate_sop':
    case 'rewrite_saved_sop': {
      const body = publicBody(input);
      if (input.dirty === true || ['current_skill', 'currentSkill', 'conversation', 'conversation_context'].some(key => own(input, key) || own(body, key))) {
        fail('PUBLIC_PREVIEW_REQUIRED', 'The public job cannot preserve current editor content/conversation. A preview protocol is required.');
      }
      const fields = operation === 'generate_sop'
        ? ['title', 'raw_content', 'business_domain', 'model_config_id']
        : ['instruction', 'target_paths', 'model_config_id', 'draft_id'];
      if (Object.keys(body).some(key => !fields.includes(key))) fail('PUBLIC_INPUT_INVALID', 'Unsupported public job field; it will not be silently discarded.', 400);
      plan.method = 'POST'; plan.path = operation === 'generate_sop' ? `${agent}/sops:generate` : `${agent}/sops/${id(input.sopId)}:rewrite`;
      plan.body = body; plan.shape = 'accepted-job';
      break;
    }
    case 'get_job': plan.path = `jobs/${id(input.jobId)}`; plan.shape = 'job'; break;
    case 'get_job_result': plan.path = `jobs/${id(input.jobId)}/result`; plan.shape = 'job-result'; break;
    case 'job_events':
      plan.path = `jobs/${id(input.jobId)}/events`; plan.responseType = 'event-stream';
      plan.headers.accept = 'text/event-stream';
      if (input.lastEventId !== undefined) {
        if (!/^\d+$/.test(String(input.lastEventId))) fail('PUBLIC_INPUT_INVALID', 'Last-Event-ID must be a non-negative integer.', 400);
        plan.headers['Last-Event-ID'] = String(input.lastEventId);
      }
      break;
    default: fail('PUBLIC_OPERATION_UNSUPPORTED', `Unsupported public operation: ${operation}`, 400);
  }
  return plan;
}

/**
 * transport({method,path,headers,body,signal,responseType}) -> {status,body,headers?}.
 * It must use the host's already-authorized owner credentials and propagate HTTP
 * failures unchanged. This module neither obtains credentials nor enables routes.
 */
export function createPublicCapabilityClient({ agentId, transport, authorizedOperations = [] }) {
  const authorized = new Set(authorizedOperations);
  return Object.freeze({
    async call(operation, input = {}, { signal } = {}) {
      if (!authorized.has(operation)) fail('PUBLIC_OPERATION_NOT_AUTHORIZED', 'This operation has not been authorized by the host.', 403);
      signal?.throwIfAborted();
      const plan = planPublicOperation(agentId, operation, input);
      const response = await transport({ ...plan, signal });
      // A raw HTTP failure remains a failure with its original body/status.
      if (!response || !Number.isInteger(response.status)) fail('PUBLIC_RESPONSE_INVALID', 'Public transport did not return an HTTP response.', 502);
      if (response.status < 200 || response.status >= 300) return response;
      if (plan.responseType === 'event-stream') return response;
      const value = response.body;
      if (!record(value)) fail('PUBLIC_RESPONSE_INVALID', 'Public response must be an object.', 502);
      if (plan.shape === 'collection' && (!Array.isArray(value.data) || value.data.some(item => !record(item)))) {
        fail('PUBLIC_RESPONSE_INVALID', 'Public collection is missing its data array.', 502);
      }
      if (plan.shape === 'accepted-job' && response.status !== 202) fail('PUBLIC_RESPONSE_INVALID', 'Expected a 202 job acceptance.', 502);
      if (['accepted-job', 'job'].includes(plan.shape) && (typeof value.id !== 'string' || typeof value.status !== 'string')) {
        fail('PUBLIC_RESPONSE_INVALID', 'Public job is missing its ID or status.', 502);
      }
      if (plan.shape === 'job-result' && (!record(value.job) || !record(value.result) || !record(value.error))) {
        fail('PUBLIC_RESPONSE_INVALID', 'Public job result envelope is incomplete.', 502);
      }
      return response; // Preserve drafts, dates, ETags, terminal errors and extensions verbatim.
    },
  });
}

/** Decode actual SSE frames. No progress synthesis, token conversion or reconnect. */
export async function* decodePublicJobEvents(chunks, { signal } = {}) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let pendingCR = false;
  let frame = { event: 'message', data: [] };
  function line(value) {
    if (value === '') {
      const ready = frame.data.length ? { ...frame, data: frame.data.join('\n') } : undefined;
      frame = { event: 'message', data: [] };
      return ready;
    }
    if (value.startsWith(':')) return;
    const split = value.indexOf(':');
    const field = split < 0 ? value : value.slice(0, split);
    let data = split < 0 ? '' : value.slice(split + 1);
    if (data.startsWith(' ')) data = data.slice(1);
    if (field === 'data') frame.data.push(data);
    if (field === 'event') frame.event = data || 'message';
    if (field === 'id' && !data.includes('\0')) frame.id = data;
  }
  for await (const chunk of chunks) {
    signal?.throwIfAborted();
    const source = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    for (const char of source) {
      if (pendingCR && char === '\n') { pendingCR = false; continue; }
      pendingCR = false;
      if (char === '\r' || char === '\n') {
        const event = line(buffer); buffer = ''; pendingCR = char === '\r';
        if (event) yield event;
      } else buffer += char;
    }
  }
  signal?.throwIfAborted();
  decoder.decode(); // Reject truncated UTF-8. An unterminated SSE frame is not delivered.
}
