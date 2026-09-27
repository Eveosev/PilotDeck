import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicCapabilityClient, planPublicOperation, decodePublicJobEvents, decodePreviewJobEvents, PUBLIC_PROTOCOL_BLOCKERS, PUBLIC_APPROVED_OPERATIONS, PUBLIC_OPERATION_CONTRACTS } from './staffdeck-public-capabilities.mjs';

const code = expected => cause => cause.code === expected;

test('unapproved operations never reach transport; unknown/inequivalent operations have no route', async () => {
  let calls = 0;
  const client = createPublicCapabilityClient({ agentId: 'a', transport: () => { calls++; } });
  await assert.rejects(client.call('list_tools'), code('PUBLIC_OPERATION_NOT_AUTHORIZED'));
  for (const operation of Object.keys(PUBLIC_PROTOCOL_BLOCKERS)) assert.throws(() => planPublicOperation('a', operation), code('PUBLIC_PROTOCOL_UNAVAILABLE'));
  assert.equal(calls, 0);
});

test('directories preserve data envelopes and encoded scope; malformed response is not empty success', async () => {
  const response = { status: 200, body: { data: [{ id: 'tool', auth: { token: '********' } }], next_cursor: null } };
  let request;
  const client = createPublicCapabilityClient({ agentId: 'a/b', authorizedOperations: ['list_tools'], transport: async value => { request = value; return response; } });
  assert.equal(await client.call('list_tools'), response);
  assert.equal(request.path, 'agents/a%2Fb/tools');
  response.body = {};
  await assert.rejects(client.call('list_tools'), code('PUBLIC_RESPONSE_INVALID'));
});

test('tool write rejects masked credentials and scope override without modifying input', () => {
  const body = { name: 'x', connection: { headers: { key: '********' } } };
  assert.throws(() => planPublicOperation('a', 'update_tool', { toolId: 'x', body }), code('PUBLIC_MASKED_CREDENTIAL'));
  assert.equal(body.connection.headers.key, '********');
  assert.throws(() => planPublicOperation('a', 'import_general_skill', { body: { tenant_id: 'other' } }), code('PUBLIC_SCOPE_OVERRIDE'));
  assert.throws(() => planPublicOperation('a', 'test_tool', { body: {} }), code('PUBLIC_INPUT_INVALID'));
});

test('rewrite refuses dirty/current skill/conversation rather than discard them or save', async () => {
  let calls = 0;
  const client = createPublicCapabilityClient({ agentId: 'a', authorizedOperations: ['rewrite_saved_sop'], transport: () => { calls++; } });
  for (const input of [
    { dirty: true }, { current_skill: { version: '1' } }, { conversation: [] },
    { body: { instruction: 'change', current_skill: {} } },
  ]) {
    await assert.rejects(client.call('rewrite_saved_sop', { sopId: 's', body: { instruction: 'change' }, ...input }), code('PUBLIC_PREVIEW_REQUIRED'));
  }
  assert.equal(calls, 0);
});

test('generation and results preserve server-assigned draft/etag; never create a second draft', async () => {
  const requests = [];
  const accepted = { status: 202, body: { id: 'job', status: 'queued' } };
  const result = { status: 200, body: { job: { id: 'job', status: 'succeeded' }, result: { draft: { id: 'd', content: { nodes: [{ extra: true }] }, etag: 'original', version: '1.0.1' } }, error: {} } };
  const client = createPublicCapabilityClient({ agentId: 'a', authorizedOperations: ['generate_sop', 'get_job_result'], transport: async request => { requests.push(request); return requests.length === 1 ? accepted : result; } });
  assert.equal(await client.call('generate_sop', { body: { title: 'title', raw_content: 'source' } }), accepted);
  assert.equal(await client.call('get_job_result', { jobId: 'job' }), result);
  assert.deepEqual(requests.map(value => value.path), ['agents/a/sops:generate', 'jobs/job/result']);
});

test('original HTTP failures, abort signal and resume cursor are preserved', async () => {
  const failure = { status: 403, body: { error: { code: 'INSUFFICIENT_SCOPE', message: 'denied' } } };
  const controller = new AbortController();
  let request;
  const client = createPublicCapabilityClient({ agentId: 'a', authorizedOperations: ['job_events'], transport: async value => { request = value; return failure; } });
  assert.equal(await client.call('job_events', { jobId: 'j/x', lastEventId: '19' }, { signal: controller.signal }), failure);
  assert.equal(request.headers['Last-Event-ID'], '19');
  assert.equal(request.path, 'jobs/j%2Fx/events');
  assert.equal(request.signal, controller.signal);
  controller.abort();
  await assert.rejects(client.call('job_events', { jobId: 'j' }, { signal: controller.signal }), { name: 'AbortError' });
});

test('SSE preserves real IDs, event names, multiline data and split UTF-8; drops incomplete frame', async () => {
  const wire = new TextEncoder().encode(': keepalive\r\nid: 7\r\nevent: sop.generate.learning\r\ndata: {"text":"中文"}\r\ndata: second\r\n\r\nid: 8\nevent: job.succeeded\ndata: {}\n\ndata: incomplete');
  async function* chunks() { for (const byte of wire) yield Uint8Array.of(byte); }
  const events = [];
  for await (const event of decodePublicJobEvents(chunks())) events.push(event);
  assert.deepEqual(events, [
    { id: '7', event: 'sop.generate.learning', data: '{"text":"中文"}\nsecond' },
    { id: '8', event: 'job.succeeded', data: '{}' },
  ]);
});

test('approved facade plans remain fixed by name, method, path and input', () => {
  const cases = [
    ['preview_generate_sop', { body: { title: 't', raw_content: 'r' } }, 'POST', 'agents/a/sops:preview-generate'],
    ['preview_rewrite_sop', { sopId: 's/x', body: { current_skill: { skill_id: 's/x' }, instruction: 'change', conversation: [{ role: 'user', content: 'current' }] } }, 'POST', 'agents/a/sops/s%2Fx:preview-rewrite'],
    ['get_preview_job', { jobId: 'j' }, 'GET', 'agents/a/sop-preview-jobs/j'],
    ['preview_job_events', { jobId: 'j', afterSeq: 4 }, 'GET', 'agents/a/sop-preview-jobs/j/events?after_seq=4'],
    ['cancel_preview_job', { jobId: 'j' }, 'POST', 'agents/a/sop-preview-jobs/j:cancel'],
    ['move_to_draft_sop', { sopId: 's' }, 'POST', 'agents/a/sops/s:move-to-draft'],
    ['remove_sop', { sopId: 's' }, 'DELETE', 'agents/a/sops/s'],
    ['sync_sop_from_overall', { sopId: 's' }, 'POST', 'agents/a/sops/s:sync-from-overall'],
    ['promote_sop_to_overall', { sopId: 's' }, 'POST', 'agents/a/sops/s:promote-to-overall'],
    ['delete_sop_version', { sopId: 's', version: '1.0.0' }, 'DELETE', 'agents/a/sops/s/versions/1.0.0'],
    ['probe_unsaved_tool', { body: { name: 't', url: 'https://example.test' } }, 'POST', 'agents/a/tools:probe'],
    ['remove_tool', { toolId: 't' }, 'DELETE', 'agents/a/tools/t'],
    ['extract_sop_text', { body: { filename: 'a.txt', content_base64: 'YQ==' } }, 'POST', 'agents/a/sops:extract-file'],
    ['list_model_catalog', {}, 'GET', 'agents/a/model-catalog'],
    ['list_handoff_users', {}, 'GET', 'agents/a/handoff-users'],
    ['cancel_job', { jobId: 'j' }, 'POST', 'jobs/j:cancel'],
  ];
  for (const [operation, input, method, path] of cases) {
    const planned = planPublicOperation('a', operation, input);
    assert.equal(planned.method, method, operation);
    assert.equal(planned.path, path, operation);
  }
  assert.equal(PUBLIC_APPROVED_OPERATIONS.length, 30);
  for (const operation of PUBLIC_APPROVED_OPERATIONS) {
    assert.equal(typeof PUBLIC_OPERATION_CONTRACTS[operation][2], 'string');
  }
});

test('preview keeps dirty current skill and conversation, while saved rewrite still rejects them', async () => {
  let request;
  const client = createPublicCapabilityClient({ agentId: 'a', authorizedOperations: ['preview_rewrite_sop', 'rewrite_saved_sop'], transport: async value => { request = value; return { status: 202, body: { job_id: 'preview' } }; } });
  const current_skill = { skill_id: 's', version: '1', nodes: [{ id: 'dirty' }] };
  const conversation = [{ role: 'user', content: 'keep this' }];
  const input = { sopId: 's', body: { current_skill, instruction: 'rewrite', conversation } };
  assert.deepEqual((await client.call('preview_rewrite_sop', input)).body, { job_id: 'preview' });
  assert.deepEqual(request.body.current_skill, current_skill);
  assert.deepEqual(request.body.conversation, conversation);
  await assert.rejects(client.call('rewrite_saved_sop', input), code('PUBLIC_PREVIEW_REQUIRED'));
});

test('preview SSE exposes only the native data.seq cursor and preserves token event text', async () => {
  async function* chunks() {
    yield 'event: message_chunk\ndata: {"job_id":"j","seq":12,"text":"part"}\n\n';
    yield 'event: job_complete\ndata: {"job_id":"j","status":"succeeded"}\n\n';
  }
  const events = [];
  for await (const event of decodePreviewJobEvents(chunks())) events.push(event);
  assert.deepEqual(events, [
    { event: 'message_chunk', data: '{"job_id":"j","seq":12,"text":"part"}', sequence: 12 },
    { event: 'job_complete', data: '{"job_id":"j","status":"succeeded"}' },
  ]);
  assert.equal(events[0].id, undefined);
});
