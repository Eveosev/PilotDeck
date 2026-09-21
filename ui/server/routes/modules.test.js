import express from 'express';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createModuleRuntimeRouter } from './modules.js';

describe('module runtime route', () => {
  it('returns sanitized module bindings and gateway capabilities', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/modules', createModuleRuntimeRouter({
      loadConfig: () => ({ modules: {
        agentLoop: { enabled: true, provider: 'pilotdeck', secret: 'must-not-leak' },
        knowledge: { enabled: true, implementationId: 'staffdeck.knowledge', contract: 'staffdeck.knowledge/v1', transport: 'module-http-v2', endpoint: 'http://private', methods: ['query'] },
      } }),
      getGateway: vi.fn(async () => ({ describeServer: async () => ({ capabilities: ['set_permission_mode'] }) })),
    }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/modules/runtime`);
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.modules.knowledge).toMatchObject({ enabled: true, implementationId: 'staffdeck.knowledge', methods: ['query'] });
      expect(body.modules.knowledge.endpoint).toBeUndefined();
      expect(body.modules.agentLoop.secret).toBeUndefined();
      expect(body.gatewayCapabilities).toEqual(['set_permission_mode']);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });

  it('returns module bindings when the chat gateway is unavailable', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/modules', createModuleRuntimeRouter({
      loadConfig: () => ({ modules: {
        sop: { enabled: true, implementationId: 'staffdeck.portable-sop', contract: 'sop.lifecycle/v2' },
      } }),
      getGateway: vi.fn(async () => { throw new Error('Gateway is starting'); }),
    }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/modules/runtime`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        modules: { sop: { enabled: true, implementationId: 'staffdeck.portable-sop' } },
        gatewayCapabilities: [],
        runtime: { gatewayState: 'unavailable', unavailableSlots: [] },
      });
    } finally { await new Promise(resolve => server.close(resolve)); }
  });

  it('rejects a query when the configured capability is absent', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/modules', createModuleRuntimeRouter({ loadConfig: () => ({ modules: { knowledge: { enabled: true, endpoint: 'http://127.0.0.1:1', methods: [] } } }) }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/modules/knowledge/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'handbook' }) });
      const body = await response.json();
      expect(response.status).toBe(409);
      expect(body.error.code).toBe('MODULE_CAPABILITY_UNAVAILABLE');
    } finally { await new Promise(resolve => server.close(resolve)); }
  });

  it('rejects citation resolution when the configured capability is absent', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/modules', createModuleRuntimeRouter({ loadConfig: () => ({ modules: { knowledge: { enabled: true, endpoint: 'http://127.0.0.1:1', methods: ['query'] } } }) }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/modules/knowledge/citation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chunkId: 'chunk-1' }) });
      const body = await response.json();
      expect(response.status).toBe(409);
      expect(body.error.code).toBe('MODULE_CAPABILITY_UNAVAILABLE');
    } finally { await new Promise(resolve => server.close(resolve)); }
  });

  it('applies the saved Knowledge defaults to a real module query', async () => {
    let received;
    const moduleApp = express();
    moduleApp.use(express.json());
    moduleApp.post('/v2/module/call', (req, res) => {
      received = req.body;
      res.json({ kind: 'response', inReplyTo: req.body.messageId, ok: true, payload: { result: { chunks: [] } } });
    });
    const moduleServer = http.createServer(moduleApp);
    await new Promise(resolve => moduleServer.listen(0, '127.0.0.1', resolve));
    const app = express();
    app.use(express.json());
    app.use('/api/modules', createModuleRuntimeRouter({ loadConfig: () => ({ modules: { knowledge: {
      enabled: true,
      endpoint: `http://127.0.0.1:${moduleServer.address().port}`,
      methods: ['query'],
      defaultBaseId: 'published-base',
      tenantId: 'tenant-demo',
      actorUserId: 'operator',
      resultLimit: 7,
    } } }) }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/modules/knowledge/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'handbook' }) });
      expect(response.status).toBe(200);
      expect(received.payload.input).toMatchObject({ query: 'handbook', baseId: 'published-base', knowledgeBaseIds: ['published-base'], tenantId: 'tenant-demo', actorUserId: 'operator', limit: 7 });
    } finally {
      await new Promise(resolve => server.close(resolve));
      await new Promise(resolve => moduleServer.close(resolve));
    }
  });

  it('proxies declared Knowledge management operations through the module contract', async () => {
    let received;
    const moduleApp = express();
    moduleApp.use(express.json());
    moduleApp.post('/v2/module/call', (req, res) => {
      received = req.body;
      res.json({ kind: 'response', inReplyTo: req.body.messageId, ok: true, payload: { result: [{ id: 'kb-1', name: 'Handbook' }] } });
    });
    const moduleServer = http.createServer(moduleApp);
    await new Promise(resolve => moduleServer.listen(0, '127.0.0.1', resolve));
    const app = express();
    app.use(express.json());
    app.use('/api/modules', createModuleRuntimeRouter({ loadConfig: () => ({ modules: { knowledge: {
      enabled: true,
      endpoint: `http://127.0.0.1:${moduleServer.address().port}`,
      methods: ['list_bases'],
      tenantId: 'tenant-demo',
      actorUserId: 'operator',
    } } }) }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/modules/knowledge/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'list_bases', input: {} }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ result: [{ id: 'kb-1', name: 'Handbook' }] });
      expect(received.payload).toEqual({ operation: 'list_bases', input: { tenantId: 'tenant-demo', actorUserId: 'operator' } });
    } finally {
      await new Promise(resolve => server.close(resolve));
      await new Promise(resolve => moduleServer.close(resolve));
    }
  });

  it('reads and saves deployment-owned SOP definitions without exposing the runtime endpoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pilotdeck-sop-definitions-'));
    const definitionsPath = join(root, 'definitions.yaml');
    await writeFile(definitionsPath, 'sops:\n  - id: approval\n    name: Operator approval\n    content:\n      nodes:\n        - node_id: handoff\n          type: handoff\n');
    const app = express();
    app.use(express.json());
    app.use('/api/modules', createModuleRuntimeRouter({
      loadConfig: () => ({ modules: { sop: { enabled: true, definitionsPath, defaultSopId: 'approval', endpoint: 'http://private-runtime' } } }),
      getGateway: vi.fn(async () => ({ describeServer: async () => ({ capabilities: ['sop_status'] }) })),
    }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const listed = await fetch(`http://127.0.0.1:${server.address().port}/api/modules/sop/definitions`);
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({ defaultSopId: 'approval', definitions: [{ id: 'approval', name: 'Operator approval' }] });
      const saved = await fetch(`http://127.0.0.1:${server.address().port}/api/modules/sop/definitions/approval`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ definition: { id: 'approval', name: 'Updated approval', content: { nodes: [{ node_id: 'handoff', type: 'handoff' }] } } }) });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ definition: { id: 'approval', name: 'Updated approval' }, restartRequired: true });
      expect(await readFile(definitionsPath, 'utf8')).toContain('Updated approval');
      const runtime = await fetch(`http://127.0.0.1:${server.address().port}/api/modules/runtime`);
      expect(await runtime.json()).toMatchObject({
        runtime: { gatewayState: 'ready', unavailableSlots: ['sop'] },
      });
    } finally {
      await new Promise(resolve => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('proxies allowlisted StaffDeck public SOP management with server-side credentials and ETags', async () => {
    const received = [];
    const managementApp = express();
    managementApp.use(express.json());
    managementApp.get('/api/v1/agents/agent-1/sops', (req, res) => {
      received.push({ path: req.path, authorization: req.headers.authorization });
      res.json({ data: [{ skill_id: 'review', name: 'Review', status: 'published' }], drafts: [] });
    });
    managementApp.put('/api/v1/agents/agent-1/sops/review', (req, res) => {
      received.push({ path: req.path, authorization: req.headers.authorization, ifMatch: req.headers['if-match'], body: req.body });
      res.setHeader('ETag', 'etag-next');
      res.json({ id: 'draft-1', sop_id: 'review', content: req.body.content });
    });
    const managementServer = http.createServer(managementApp);
    await new Promise(resolve => managementServer.listen(0, '127.0.0.1', resolve));
    const app = express();
    app.use(express.json());
    app.use('/api/modules', createModuleRuntimeRouter({ loadConfig: () => ({ modules: { sop: {
      enabled: true,
      management: {
        enabled: true,
        endpoint: `http://127.0.0.1:${managementServer.address().port}/api/v1`,
        apiKey: 'server-only-key',
        agentId: 'agent-1',
        methods: ['list', 'replace_draft'],
      },
    } } }) }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const listed = await fetch(`http://127.0.0.1:${server.address().port}/api/modules/sop/management/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'list' }) });
      expect(listed.status).toBe(200);
      expect(await listed.json()).toEqual({ result: { data: [{ skill_id: 'review', name: 'Review', status: 'published' }], drafts: [] } });
      const saved = await fetch(`http://127.0.0.1:${server.address().port}/api/modules/sop/management/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'replace_draft', input: { sopId: 'review', draftId: 'draft-1', etag: 'etag-current', content: { skill_id: 'review', nodes: [] } } }) });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ result: { id: 'draft-1', etag: 'etag-next' } });
      expect(received).toEqual([
        { path: '/api/v1/agents/agent-1/sops', authorization: 'Bearer server-only-key' },
        { path: '/api/v1/agents/agent-1/sops/review', authorization: 'Bearer server-only-key', ifMatch: 'etag-current', body: { content: { skill_id: 'review', nodes: [] } } },
      ]);
      const denied = await fetch(`http://127.0.0.1:${server.address().port}/api/modules/sop/management/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'publish', input: { sopId: 'review', draftId: 'draft-1' } }) });
      expect(denied.status).toBe(409);
      expect((await denied.json()).error.code).toBe('SOP_MANAGEMENT_CAPABILITY_UNAVAILABLE');
    } finally {
      await new Promise(resolve => server.close(resolve));
      await new Promise(resolve => managementServer.close(resolve));
    }
  });
});
