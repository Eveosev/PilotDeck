import express from 'express';
import http from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { createModuleRuntimeRouter } from './modules.js';

const servers = [];
const restorations = [];
let nextPort = 16680;
afterEach(async () => {
  restorations.splice(0).forEach(restore => restore());
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  })));
});
async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(nextPort++, '127.0.0.1', resolve);
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
async function fixture(handle, { scopes = ['sops:read', 'sops:write', 'sops:publish', 'sops:cancel', 'tools:read', 'skills:read', 'knowledge:read'], identity, binding, getGateway } = {}) {
  const key = 'sdak_sdk_owned_account_123456789';
  const native = express();
  native.disable('etag');
  native.use(express.json());
  let checks = 0;
  native.get('/api/auth/me', identity ?? ((_req, res) => { checks++; res.json({ id: 'actor', tenant_id: 'tenant' }); }));
  native.get('/api/auth/me/api-credentials', (_req, res) => res.json([{ id: 'owned', user_id: 'actor',
    key_prefix: key.slice(0, 20) + '…', access: 'user_full_access', status: 'active', scopes }]));
  native.use('/api/v1', handle);
  const origin = await listen(native);
  for (const [name, value] of Object.entries({ SDK_TEST_LOGIN: 'login', SDK_TEST_KEY: key })) {
    const previous = process.env[name]; process.env[name] = value;
    restorations.push(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const config = {
    webui: { staffdeckCopy: { enabled: true, contract: 'staffdeck.enterprise-copy/v1', endpoint: origin,
      tenantId: 'tenant', actorUserId: 'actor', targetAgentId: 'target', pilotDeckUserId: 'local', userTokenEnv: 'SDK_TEST_LOGIN' } },
    modules: { sop: { enabled: true, ...binding, ...(binding ? { discoveryEndpoint: origin + '/api/v1/' } : {}), management: { enabled: true, endpoint: origin + '/api/v1/',
      apiKeyEnv: 'SDK_TEST_KEY', credentialId: 'owned', agentId: 'target', methods: ['list'] } } },
  };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'local' }; next(); });
  app.use('/api/modules', createModuleRuntimeRouter({ loadConfig: () => config, ...(getGateway ? { getGateway } : {}) }));
  const local = await listen(app);
  return {
    checks: () => checks,
    management: () => fetch(local + '/api/modules/sop/management'),
    call: (operation, input = {}, scope, signal) => fetch(local + '/api/modules/staffdeck-sdk/call', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input, scope }), signal,
    }),
    events: (query, headers = {}, signal) => fetch(local + '/api/modules/staffdeck-sdk/events?' + query, { headers, signal }),
  };
}

it('preserves real target 202/JSON/ETag and rejects excluded scopes before business transport', async () => {
  const requests = [];
  const f = await fixture((req, res) => {
    requests.push({ url: req.url, body: req.body, auth: req.get('authorization') });
    if (req.url === '/agents/non-target/tools') return res.status(403).type('text').send('original agent denial');
    res.status(202).set('ETag', 'owner-etag').type('json').send('{ "job_id": "preview" }');
  });
  const response = await f.call('preview_generate_sop', { body: { title: 'title', raw_content: 'dirty' } }, { kind: 'agent', agentId: 'target' });
  expect(response.status).toBe(202);
  expect(response.headers.get('etag')).toBe('owner-etag');
  expect(await response.text()).toBe('{ "job_id": "preview" }');
  const denied = await f.call('list_tools', {}, { kind: 'agent', agentId: 'non-target' });
  expect(denied.status).toBe(403);
  expect(denied.headers.get('etag')).not.toBe('owner-etag');
  expect(await denied.json()).toMatchObject({ error: { code: 'PUBLIC_FIXED_TARGET_SCOPE_MISMATCH' } });
  expect(requests.map(r => r.url)).toEqual(['/agents/target/sops:preview-generate']);
  expect(requests[0].body).toEqual({ title: 'title', raw_content: 'dirty' });
  expect(requests.every(r => r.auth.startsWith('Bearer sdak_'))).toBe(true);
  expect(f.checks()).toBe(2);
});

it('rejects unknown operations, scope overrides and missing cancel scope before business fetch', async () => {
  let businessCalls = 0;
  const f = await fixture((_req, res) => { businessCalls++; res.json({}); }, { scopes: ['sops:read', 'sops:write', 'sops:publish'] });
  expect((await f.call('arbitrary_proxy', { url: 'https://example.invalid' })).status).toBe(400);
  expect((await f.call('list_tools', { tenantId: 'other' })).status).toBe(400);
  const denied = await f.call('cancel_job', { jobId: 'job' });
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ error: { code: 'PUBLIC_SCOPE_FORBIDDEN' } });
  expect(businessCalls).toBe(0);
});

it('passes explicit cancellation once and dirty preview unchanged without saving', async () => {
  const calls = [];
  const f = await fixture((req, res) => {
    calls.push({ method: req.method, url: req.url, body: req.body });
    if (req.url.endsWith(':cancel')) return res.json({ id: 'job', status: 'cancel_requested' });
    res.status(202).json({ job_id: 'transient' });
  });
  expect(await (await f.call('cancel_job', { jobId: 'job' })).json()).toEqual({ id: 'job', status: 'cancel_requested' });
  const body = { current_skill: { skill_id: 'sop', nodes: [{ node_id: 'dirty' }] }, instruction: 'change', conversation: [{ role: 'user', content: 'keep' }] };
  expect((await f.call('preview_rewrite_sop', { sopId: 'sop', body }, { kind: 'agent', agentId: 'target' })).status).toBe(202);
  expect(calls).toEqual([
    { method: 'POST', url: '/jobs/job:cancel', body: {} },
    { method: 'POST', url: '/agents/target/sops/sop:preview-rewrite', body },
  ]);
});

it('preserves raw SSE bytes and keeps APIJob cursor separate from preview sequence', async () => {
  const calls = [];
  const raw = ': heartbeat\r\nid: 7\r\nevent: token\r\ndata: {"text":"中文","seq":9}\r\n\r\n';
  const f = await fixture((req, res) => {
    calls.push({ url: req.url, cursor: req.get('Last-Event-ID') });
    res.type('text/event-stream').write(Buffer.from(raw).subarray(0, 51));
    res.end(Buffer.from(raw).subarray(51));
  });
  const events = await f.events('operation=job_events&jobId=api&lastEventId=2', { 'Last-Event-ID': '7' });
  expect(events.status).toBe(200); expect(await events.text()).toBe(raw);
  const preview = await f.events('operation=preview_job_events&jobId=preview&scope=agent&agentId=target&afterSeq=9', { 'Last-Event-ID': '999' });
  expect(await preview.text()).toBe(raw);
  expect(calls).toEqual([{ url: '/jobs/api/events', cursor: '7' }, { url: '/agents/target/sop-preview-jobs/preview/events?after_seq=9', cursor: undefined }]);
});

it('returns original pre-stream error status/body rather than SSE success', async () => {
  const f = await fixture((_req, res) => res.status(409).set('Retry-After', '3').type('json').send('{"error":{"code":"ORIGINAL"}}'));
  const response = await f.events('operation=job_events&jobId=job');
  expect(response.status).toBe(409);
  expect(response.headers.get('retry-after')).toBe('3');
  expect(await response.text()).toBe('{"error":{"code":"ORIGINAL"}}');
});

it('browser stream abort closes upstream without issuing cancel', async () => {
  const calls = [];
  let close;
  const closed = new Promise(resolve => { close = resolve; });
  const f = await fixture((req, res) => {
    calls.push(req.url);
    res.type('text/event-stream').flushHeaders();
    res.write('data: {"seq":1}\n\n');
    res.once('close', () => close(res.writableFinished));
  });
  const controller = new AbortController();
  const response = await f.events('operation=preview_job_events&jobId=preview&scope=agent&agentId=target', {}, controller.signal);
  await response.body.getReader().read();
  controller.abort();
  expect(await closed).toBe(false);
  expect(calls).toEqual(['/agents/target/sop-preview-jobs/preview/events']);
}, 10000);


it('requires explicit scope, rejects legacy target fallback and leaves global jobs unscoped', async () => {
  const calls = [];
  const f = await fixture((req, res) => { calls.push(req.url); res.json({ id: 'job', status: 'running' }); });
  const missing = await f.call('list_tools');
  expect(missing.status).toBe(400);
  expect(await missing.json()).toMatchObject({ error: { code: 'PUBLIC_SELECTED_SCOPE_REQUIRED' } });
  expect((await f.call('list_tools', { agentId: 'target' })).status).toBe(400);
  expect((await f.call('list_tools', {}, { kind: 'agent' })).status).toBe(400);
  expect((await f.events('operation=preview_job_events&jobId=preview&scope=team&agentId=target')).status).toBe(400);
  expect(f.checks()).toBe(0);
  expect((await f.call('get_job', { jobId: 'job' })).status).toBe(200);
  expect((await f.call('get_job', { jobId: 'job' }, { kind: 'team' })).status).toBe(400);
  expect((await f.call('update_tool', { toolId: 'tool', body: {}, etag: 'original' }, { kind: 'agent', agentId: 'target' })).status).toBe(409);
  expect(calls).toEqual(['/jobs/job']);
});

it('rejects excluded team catalogs and preview calls and streams before business transport', async () => {
  const calls = [];
  const f = await fixture((req, res) => { calls.push(req.url); res.json({}); });
  for (const operation of ['list_tools', 'list_general_skills', 'list_knowledge_bases', 'list_sops',
    'preview_generate_sop', 'preview_rewrite_sop', 'get_preview_job', 'cancel_preview_job', 'remove_sop']) {
    const response = await f.call(operation, { jobId: 'preview', sopId: 'sop', body: {} }, { kind: 'team' });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'PUBLIC_FIXED_TARGET_SCOPE_MISMATCH' } });
  }
  const stream = await f.events('operation=preview_job_events&jobId=preview&scope=team&afterSeq=2');
  expect(stream.status).toBe(403);
  expect(await stream.json()).toMatchObject({ error: { code: 'PUBLIC_FIXED_TARGET_SCOPE_MISMATCH' } });
  expect(calls).toEqual([]);
});


it('routes selected draft/version management precisely and preserves same-response ETags and precondition errors', async () => {
  const calls = [];
  const draft = { id: 'draft/id', sop_id: 'sop/id', content: { skill_id: 'sop/id' }, etag: '"original etag"' };
  const f = await fixture((req, res) => {
    calls.push({ method: req.method, url: req.url, body: req.body, etag: req.get('If-Match') });
    if (req.method === 'PUT' && req.get('If-Match') !== draft.etag) return res.status(412).type('json').end('{"error":{"code":"ETAG_MISMATCH"}}');
    if (req.url.includes('/versions/v%2F1:rollback')) return res.status(201).json(draft);
    if (req.url.includes('/versions/v%2F1')) return res.json({ version: 'v/1', content: draft.content });
    if (req.url.includes('/versions')) return res.json({ data: [{ version: 'v/1' }] });
    if (req.url.includes(':archive')) return res.json({ skill_id: 'sop/id', status: 'archived' });
    return res.status(req.method === 'POST' ? 201 : 200).set('ETag', draft.etag).json(draft);
  });
  const scope = { kind: 'agent', agentId: 'target' };
  for (const [operation, input, status] of [
    ['get_sop_draft', { sopId: 'sop/id', draftId: 'draft/id' }, 200],
    ['create_sop_draft', { body: { content: draft.content } }, 201],
    ['replace_sop_draft', { sopId: 'sop/id', draftId: 'draft/id', etag: draft.etag, body: { content: draft.content } }, 200],
  ]) {
    const response = await f.call(operation, input, scope);
    expect(response.status).toBe(status);
    expect(response.headers.get('etag')).toBe(draft.etag);
    expect(await response.json()).toEqual(draft);
  }
  const input = { sopId: 'sop/id', draftId: 'draft/id', body: { content: draft.content } };
  expect((await f.call('replace_sop_draft', input, scope)).status).toBe(428);
  const stale = await f.call('replace_sop_draft', { ...input, etag: '"stale"' }, scope);
  expect(stale.status).toBe(412); expect(await stale.text()).toBe('{"error":{"code":"ETAG_MISMATCH"}}');
  expect((await f.call('list_sop_versions', { sopId: 'sop/id' }, scope)).status).toBe(200);
  expect((await f.call('get_sop_version', { sopId: 'sop/id', version: 'v/1' }, scope)).status).toBe(200);
  const rolled = await f.call('rollback_sop_version', { sopId: 'sop/id', version: 'v/1' }, scope);
  expect(rolled.status).toBe(201); expect(await rolled.json()).toEqual(draft);
  expect((await f.call('archive_sop', { sopId: 'sop/id' }, scope)).status).toBe(200);
  expect(calls.map(c => c.url)).toEqual([
    '/agents/target/sops/sop%2Fid/drafts/draft%2Fid', '/agents/target/sops',
    '/agents/target/sops/sop%2Fid?draft_id=draft%2Fid', '/agents/target/sops/sop%2Fid?draft_id=draft%2Fid',
    '/sops/sop%2Fid/versions?agent_id=target', '/sops/sop%2Fid/versions/v%2F1?agent_id=target',
    '/sops/sop%2Fid/versions/v%2F1:rollback?agent_id=target', '/sops/sop%2Fid:archive?agent_id=target',
  ]);
  expect(calls[2].etag).toBe(draft.etag); expect(calls[3].etag).toBe('"stale"');
});

it('rejects excluded team draft/version management without business transport', async () => {
  const calls = [];
  const f = await fixture((req, res) => { calls.push(req.url); res.json({}); });
  for (const operation of ['list_sop_versions', 'get_sop_version', 'get_sop_draft', 'create_sop_draft',
    'replace_sop_draft', 'publish_sop', 'archive_sop', 'rollback_sop_version']) {
    const response = await f.call(operation, { sopId: 'sop', draftId: 'draft', version: '1',
      ...(operation === 'replace_sop_draft' ? { etag: 'original' } : {}) }, { kind: 'team' });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'PUBLIC_FIXED_TARGET_SCOPE_MISMATCH' } });
  }
  expect(calls).toEqual([]);
});

it('SDK publish reuses the once-publish coordinator and retains original body with separate runtime status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-publish-'));
  const path = join(dir, 'definitions.yaml');
  await writeFile(path, JSON.stringify({ sops: [{ id: 'sop', version: '1', content: { skill_id: 'sop', version: '1' } }] }));
  let publications = 0;
  const refreshes = [];
  const publication = { sop: { id: 'row', skill_id: 'sop', status: 'published', version: '2', content: { skill_id: 'sop', version: '2' } }, draft: { id: 'draft' } };
  const f = await fixture((req, res) => {
    publications++;
    expect(req.url).toBe('/sops/sop:publish?agent_id=target');
    expect(req.body).toEqual({ draft_id: 'draft' });
    expect(req.get('If-Match')).toBeUndefined();
    res.json(publication);
  }, { binding: { definitionsPath: path, defaultSopId: 'sop', discoveryAgentId: 'target' },
    getGateway: async () => ({ reloadExtensions: async input => { refreshes.push(input); return { reloaded: true }; } }) });
  try {
    const response = await f.call('publish_sop', { sopId: 'sop', draftId: 'draft' }, { kind: 'agent', agentId: 'target' });
    expect(response.status).toBe(200); expect(await response.json()).toEqual(publication);
    expect(JSON.parse(response.headers.get('X-StaffDeck-Runtime'))).toMatchObject({ ownerPublished: true, snapshotWritten: true, refreshRequested: true, receiptPersisted: true, effective: false });
    expect(publications).toBe(1); expect(refreshes).toEqual([{ changedPaths: [path] }]);
    expect(JSON.parse(await readFile(path, 'utf8')).sops[0].version).toBe('2');
    expect((await (await f.management()).json()).runtime.receipts).toEqual([expect.objectContaining({ sopId: 'sop', effective: false })]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('an excluded non-target publish makes no publication, bundle write or refresh', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-publish-scope-'));
  const path = join(dir, 'definitions.yaml');
  const original = JSON.stringify({ sops: [{ id: 'sop', version: '1' }] });
  await writeFile(path, original);
  let publications = 0, refreshes = 0;
  const f = await fixture((req, res) => {
    publications++; expect(req.url).toBe('/sops/sop:publish?agent_id=other');
    res.json({ sop: { id: 'row', skill_id: 'sop', status: 'published', version: '2', content: { skill_id: 'sop', version: '2' } } });
  }, { binding: { definitionsPath: path, defaultSopId: 'sop', discoveryAgentId: 'target' }, getGateway: async () => ({ reloadExtensions: async () => { refreshes++; return { reloaded: true }; } }) });
  try {
    const response = await f.call('publish_sop', { sopId: 'sop', draftId: 'draft' }, { kind: 'agent', agentId: 'other' });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'PUBLIC_FIXED_TARGET_SCOPE_MISMATCH' } });
    expect(response.headers.get('X-StaffDeck-Runtime')).toBeNull();
    expect(publications).toBe(0); expect(refreshes).toBe(0); expect(await readFile(path, 'utf8')).toBe(original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
