import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createNativeApprovalSessionResolver, readNativeInstallationOwner, readNativeSessionAdmission } from '../../src/composition/nativeApprovalSessionResolver.js';
import { createLocalGateway } from '../../src/cli/createLocalGateway.js';
import { createAgentProjectSessionStorage } from '../../src/session/index.js';

const binding = { tenantId: 'tenant', agentId: 'target', pilotDeckUserId: '1' };
const subject = { tenantId: 'tenant', userId: 'approver', source: 'web' as const, role: 'member' as const, disabled: false };

test('production resolver joins persisted native owner and original transcript admission; refuses old, foreign and ambiguous sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-approval-authority-'));
  const path = join(root, 'auth.db');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE users (id INTEGER, is_active INTEGER); INSERT INTO users VALUES (1, 1)');
  const storage = createAgentProjectSessionStorage({ projectRoot: root, pilotHome: root, sessionId: 'session' });
  try {
    await storage.restore();
    await storage.transcript.recordSessionMetadata('session', 'host-admission', { staffDeckAdmission: { ...binding, projectKey: root } });
    const readAdmission = async () => readNativeSessionAdmission((await storage.persistence.load()).entries, 'session');
    let projects = [root];
    const resolver = createNativeApprovalSessionResolver({
      readOwner: () => readNativeInstallationOwner(path), listProjects: async () => projects,
      listSessions: async () => [{ sessionId: 'session' }], sessionAdmission: readAdmission,
    });
    const input = { sessionKey: 'session', binding, subject };
    assert.deepEqual(await resolver(input), { ...binding, sessionKey: 'session', projectKey: root });
    projects = [root, root];
    assert.equal(await resolver(input), undefined);
    projects = [root];
    await storage.transcript.recordSessionMetadata('session', 'metadata-reappend', { isSnapshot: true, staffDeckAdmission: { ...binding, projectKey: root } });
    assert.deepEqual(await resolver(input), { ...binding, sessionKey: 'session', projectKey: root });
    assert.equal(await resolver({ ...input, projectKey: '/foreign' }), undefined);
    assert.equal(await resolver({ ...input, sessionKey: 'unknown' }), undefined);
    assert.equal(await resolver({ ...input, binding: { ...binding, agentId: 'foreign' } }), undefined);
    db.exec('INSERT INTO users VALUES (2, 1)');
    assert.equal(await resolver(input), undefined);
    db.exec('DELETE FROM users WHERE id = 2');
    assert.equal(readNativeSessionAdmission([], 'session'), undefined);
    const entries = (await storage.persistence.load()).entries;
    assert.equal(readNativeSessionAdmission(entries, 'different-session'), undefined);
    await storage.transcript.recordSessionMetadata('session', 'host-admission', { staffDeckAdmission: { ...binding, agentId: 'changed', projectKey: root } });
    assert.equal(await resolver(input), undefined);
  } finally { db.close(); await storage.dispose(); await rm(root, { recursive: true, force: true }); }
});


test('normal production gateway admission persists the join once and does not backfill old sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'production-approval-admission-'));
  const db = new DatabaseSync(join(root, 'auth.db'));
  db.exec('CREATE TABLE users (id INTEGER, is_active INTEGER); INSERT INTO users VALUES (1, 1)');
  await writeFile(join(root, 'pilotdeck.yaml'), `schemaVersion: 1
agent: { model: test/test }
model:
  providers:
    test:
      protocol: openai
      url: http://127.0.0.1:1
      apiKey: controlled-test
      models:
        test:
          capabilities: { supportsToolUse: true, maxContextTokens: 8192, maxOutputTokens: 1024 }
modules:
  sop:
    enabled: true
    provider: staffdeck
    endpoint: http://127.0.0.1:1
    definitionsPath: bundle.yaml
    defaultSopId: approval
    discoveryEndpoint: http://127.0.0.1:1/api/v1
    discoveryAgentId: target
    discoveryApiKey: controlled-test
`);
  await writeFile(join(root, 'bundle.yaml'), 'sops: [{ id: approval, version: "1", content: { nodes: [{ node_id: start }] } }]');
  const old = createAgentProjectSessionStorage({ projectRoot: root, pilotHome: root, sessionId: 'old' });
  await old.restore();
  await old.transcript.recordSessionMetadata('old', 'original-metadata', { title: 'Existing history' });
  await old.dispose();
  const broken = createAgentProjectSessionStorage({ projectRoot: root, pilotHome: root, sessionId: 'broken' });
  await writeFile(broken.transcriptPath, 'invalid original transcript');
  await broken.dispose();
  const local = createLocalGateway({ projectRoot: root, pilotHome: root, env: { ...process.env,
    STAFFDECK_COPY_TENANT_ID: 'tenant', STAFFDECK_COPY_TARGET_AGENT_ID: 'target', STAFFDECK_COPY_PILOTDECK_USER_ID: '1' } });
  try {
    const fresh = await local.registry.createSession({ sessionKey: 'fresh', projectKey: root, channelKey: 'test' });
    await fresh.dispose?.();
    const previous = await local.registry.createSession({ sessionKey: 'old', projectKey: root, channelKey: 'test' });
    await previous.dispose?.();
    const corrupt = await local.registry.createSession({ sessionKey: 'broken', projectKey: root, channelKey: 'test' });
    await corrupt.dispose?.();
    const read = async (sessionKey: string) => {
      const storage = local.registry.createPersistentSessionStorage(root, sessionKey);
      try { return readNativeSessionAdmission((await storage.persistence.load()).entries, sessionKey); }
      finally { await storage.dispose(); }
    };
    assert.deepEqual(await read('fresh'), { ...binding, projectKey: root });
    assert.equal(await read('old'), undefined);
    assert.equal(await read('broken'), undefined);
  } finally { await local.dispose(); db.close(); await rm(root, { recursive: true, force: true }); }
});
