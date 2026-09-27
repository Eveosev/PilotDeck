import express from 'express';
import http from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { createModuleRuntimeRouter } from './modules.js';

const ownedServers = [];
let nextPort = 16660;
afterEach(async () => {
  await Promise.all(ownedServers.splice(0).map(server => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  })));
});

async function listen(app) {
  for (; nextPort < 16680;) {
    const port = nextPort++;
    const server = http.createServer(app);
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      ownedServers.push(server);
      return `http://127.0.0.1:${port}`;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('No free owned test port in 16660–16679');
}

async function fixture(onCreate, onList = (_req, res) => res.json({ data: [] })) {
  const key = 'sdak_bridge_test_account_123456789';
  const native = express();
  native.use(express.json());
  native.get('/api/auth/me', (_req, res) => res.json({ id: 'actor', tenant_id: 'tenant' }));
  native.get('/api/auth/me/api-credentials', (_req, res) => res.json([{ id: 'owned', user_id: 'actor',
    key_prefix: key.slice(0, 20) + '…', access: 'user_full_access', status: 'active', scopes: ['sops:read', 'sops:write', 'sops:publish'] }]));
  native.post('/api/v1/agents/agent/sops', onCreate);
  native.get('/api/v1/agents/agent/sops', onList);
  const origin = await listen(native);
  const config = {
    webui: { staffdeckCopy: { enabled: true, contract: 'staffdeck.enterprise-copy/v1', endpoint: origin,
      tenantId: 'tenant', actorUserId: 'actor', targetAgentId: 'agent', pilotDeckUserId: 'local', userTokenEnv: 'BRIDGE_TEST_LOGIN_TOKEN' } },
    modules: { sop: { enabled: true, management: { enabled: true, endpoint: origin + '/api/v1', apiKeyEnv: 'BRIDGE_TEST_ACCOUNT_KEY',
      credentialId: 'owned', agentId: 'agent', methods: ['create', 'list'] } } },
  };
  const previous = process.env.BRIDGE_TEST_LOGIN_TOKEN;
  const previousKey = process.env.BRIDGE_TEST_ACCOUNT_KEY;
  process.env.BRIDGE_TEST_ACCOUNT_KEY = key;
  process.env.BRIDGE_TEST_LOGIN_TOKEN = 'test-login';
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'local' }; next(); });
  app.use('/api/modules', createModuleRuntimeRouter({ loadConfig: () => config }));
  const local = await listen(app);
  return {
    call: (operation, input, signal) => fetch(local + '/api/modules/sop/management/call', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input }), signal,
    }),
    restore: () => { if (previousKey === undefined) delete process.env.BRIDGE_TEST_ACCOUNT_KEY; else process.env.BRIDGE_TEST_ACCOUNT_KEY = previousKey; if (previous === undefined) delete process.env.BRIDGE_TEST_LOGIN_TOKEN; else process.env.BRIDGE_TEST_LOGIN_TOKEN = previous; },
  };
}

it('creates the selected SOP content once and returns the original create ETag', async () => {
  const writes = [];
  const content = { name: 'Complex', version: '1.2.3', nodes: [{ node_id: 'n', config: { extra: true } }], edges: [], extension: ['kept'] };
  const f = await fixture((req, res) => {
    writes.push(req.body);
    res.setHeader('ETag', 'first-draft-etag');
    res.status(201).json({ id: 'actual-draft', sop_id: 'selected', content: req.body.content, version: '1.2.3' });
  });
  try {
    const response = await f.call('create', { sopId: 'selected', content });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ result: { id: 'actual-draft', sop_id: 'selected', etag: 'first-draft-etag', content: { ...content, skill_id: 'selected' } } });
    expect(writes).toEqual([{ content: { ...content, skill_id: 'selected' } }]);
    expect((await f.call('create', { sopId: 'selected', content: { ...content, skill_id: 'other' } })).status).toBe(400);
    expect(writes).toHaveLength(1);
  } finally { f.restore(); }
});

it('aborts the real upstream request when the browser disconnects', async () => {
  let resolveStarted;
  let resolveClosed;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const f = await fixture((_req, res) => res.json({}), (_req, res) => {
    res.once('close', () => resolveClosed(res.writableFinished));
    resolveStarted();
  });
  try {
    const controller = new AbortController();
    const pending = f.call('list', undefined, controller.signal).catch(error => error);
    await Promise.race([started, pending.then(async response => { if (response instanceof Error) throw response; throw new Error('Upstream not started: ' + response.status + ' ' + await response.text()); })]);
    controller.abort();
    expect((await pending).name).toBe('AbortError');
    expect(await closed).toBe(false);
  } finally { f.restore(); }
}, 10000);
