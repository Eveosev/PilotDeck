import express from 'express';
import http from 'node:http';
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
async function fixture(handle, { scopes = ['sops:read', 'sops:write', 'sops:publish', 'sops:cancel', 'tools:read', 'skills:read', 'knowledge:read'], identity } = {}) {
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
    modules: { sop: { enabled: true, management: { enabled: true, endpoint: origin + '/api/v1/',
      apiKeyEnv: 'SDK_TEST_KEY', credentialId: 'owned', agentId: 'target', methods: ['list'] } } },
  };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'local' }; next(); });
  app.use('/api/modules', createModuleRuntimeRouter({ loadConfig: () => config }));
  const local = await listen(app);
  return {
    checks: () => checks,
    call: (operation, input = {}, scope, signal) => fetch(local + '/api/modules/staffdeck-sdk/call', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input, scope }), signal,
    }),
    events: (query, headers = {}, signal) => fetch(local + '/api/modules/staffdeck-sdk/events?' + query, { headers, signal }),
  };
}

it('preserves real 202/JSON/ETag and selected-agent PEP errors without result envelopes', async () => {
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
  expect(denied.headers.get('etag')).toBeNull();
  expect(await denied.text()).toBe('original agent denial');
  expect(requests.map(r => r.url)).toEqual(['/agents/target/sops:preview-generate', '/agents/non-target/tools']);
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

it('uses bounded team paths for four catalogs and transient preview, rejecting team writes', async () => {
  const calls = [];
  const f = await fixture((req, res) => {
    calls.push({ url: req.url, body: req.body });
    if (req.url.includes('/events')) return res.type('text/event-stream').end('data: {"seq":3}\n\n');
    if (req.url.endsWith(':cancel')) return res.json({ job_id: 'preview', status: 'cancel_requested' });
    if (req.url.includes('/sop-preview-jobs/')) return res.json({ job_id: 'preview', status: 'running', last_seq: 3 });
    if (req.url.includes(':preview-')) return res.status(202).json({ job_id: 'preview' });
    return res.json({ data: [], drafts: [] });
  });
  const scope = { kind: 'team' };
  for (const operation of ['list_tools', 'list_general_skills', 'list_knowledge_bases', 'list_sops']) {
    expect((await f.call(operation, {}, scope)).status).toBe(200);
  }
  const generate = { title: 'team', raw_content: 'dirty' };
  const rewrite = { current_skill: { skill_id: 'sop' }, instruction: 'change', conversation: [{ role: 'user', content: 'retain' }], target_paths: ['node'], target_label: 'label' };
  expect((await f.call('preview_generate_sop', { body: generate }, scope)).status).toBe(202);
  expect((await f.call('preview_rewrite_sop', { sopId: 'sop', body: rewrite }, scope)).status).toBe(202);
  expect((await f.call('get_preview_job', { jobId: 'preview' }, scope)).status).toBe(200);
  expect((await f.call('cancel_preview_job', { jobId: 'preview' }, scope)).status).toBe(200);
  expect(await (await f.events('operation=preview_job_events&jobId=preview&scope=team&afterSeq=2')).text()).toBe('data: {"seq":3}\n\n');
  const blocked = await f.call('remove_sop', { sopId: 'sop' }, scope);
  expect(blocked.status).toBe(409);
  expect(await blocked.json()).toMatchObject({ error: { code: 'PUBLIC_TEAM_PROTOCOL_UNAVAILABLE' } });
  expect(calls.map(c => c.url)).toEqual([
    '/team/tools', '/team/general-skills', '/team/knowledge-bases', '/team/sops',
    '/team/sops:preview-generate', '/team/sops/sop:preview-rewrite',
    '/team/sop-preview-jobs/preview', '/team/sop-preview-jobs/preview:cancel',
    '/team/sop-preview-jobs/preview/events?after_seq=2',
  ]);
  expect(calls[4].body).toEqual(generate);
  expect(calls[5].body).toEqual(rewrite);
});
