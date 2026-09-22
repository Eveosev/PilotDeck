import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const staffRoot = process.env.STAFFDECK_ROOT || resolve(root, '../StaffDeck-g4-knowledge-sd');
const python = process.env.STAFFDECK_PYTHON || '/tmp/staffdeck-shared-venv/bin/python';
const ports = { knowledge: 16100, vite: 16101, api: 16102, gateway: 16103 };
const artifactRoot = process.env.G4_KNOWLEDGE_ARTIFACT_ROOT || resolve(root, 'test-results/g4-knowledge-browser');
const tempRoot = await mkdtemp(join(tmpdir(), 'pilotdeck-g4-knowledge-'));
const database = join(tempRoot, 'staffdeck-knowledge.sqlite');
const pilotHome = join(tempRoot, 'pilot-home');
const configPath = join(tempRoot, 'pilotdeck.yaml');
const output = { ports, actions: [], requests: [], jobs: [], persistence: {}, cleanup: { tempRoot } };

function start(command, args, env, cwd) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  return { child, logs: () => logs };
}

async function waitFor(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `${response.status}`;
    } catch (error) { last = error instanceof Error ? error.message : String(error); }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${last}`);
}

async function stop(handle) {
  if (!handle?.child || handle.child.exitCode !== null) return;
  try { process.kill(-handle.child.pid, 'SIGTERM'); } catch {}
  await new Promise((resolveStop) => setTimeout(resolveStop, 800));
  if (handle.child.exitCode === null) { try { process.kill(-handle.child.pid, 'SIGKILL'); } catch {} }
}

async function findPolicyRow(page) {
  await page.waitForFunction(() => !document.body.innerText.includes('Loading...'), undefined, { timeout: 20_000 });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const search = page.getByPlaceholder(/搜索知识库名称|Search knowledge bases/i);
    if (await search.count() && attempt === 0) {
      await search.fill('g4-policy');
      await page.waitForTimeout(300);
    }
    const row = page.locator('tr').filter({ hasText: 'g4-policy' }).first();
    if (await row.count() && await row.isVisible()) return row;
    const next = page.getByRole('button', { name: /下一页|Next Page/i }).last();
    if (await next.count() && !(await next.isDisabled())) {
      await next.click();
    }
    if (attempt > 0 && attempt % 20 === 19) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.body.innerText.includes('Loading...'), undefined, { timeout: 20_000 });
      const refreshedSearch = page.getByPlaceholder(/搜索知识库名称|Search knowledge bases/i);
      if (await refreshedSearch.count()) await refreshedSearch.fill('g4-policy');
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error('Persisted g4-policy base was not found in the Knowledge table pages');
}

await mkdir(artifactRoot, { recursive: true });
await mkdir(pilotHome, { recursive: true });
await writeFile(configPath, `schemaVersion: 1\nagent:\n  model: smoke/operator\nmodel:\n  providers:\n    smoke:\n      protocol: openai\n      url: http://127.0.0.1:19992/v1\n      apiKey: local-only\n      models:\n        operator:\n          capabilities:\n            supportsToolUse: true\nwebui:\n  runtime:\n    serverPort: ${ports.api}\n    vitePort: ${ports.vite}\n    databasePath: ${join(pilotHome, 'auth.db')}\n    workspacesRoot: ${join(pilotHome, 'workspaces')}\nmodules:\n  knowledge:\n    enabled: true\n    implementationId: staffdeck.knowledge\n    frontendModule: staffdeck.knowledge\n    contract: staffdeck.knowledge/v1\n    transport: module-http-v2\n    endpoint: http://127.0.0.1:${ports.knowledge}\n    callPath: /v2/module/call\n    tenantId: tenant_g4_browser\n    actorUserId: g4-owner\n    methods: [list_bases, create_base, get_base, update_base, delete_base, list_versions, sync_base, publish_version, rollback_version, list_documents, get_document, import_document, import_okf, update_document, delete_document, list_document_buckets, update_bucket, list_bucket_chunks, update_chunk, get_job, list_jobs, cancel_job, list_okf_concepts, get_okf_concept, upsert_okf_concept, export_okf, lint_okf, list_discoveries, confirm_discovery, reject_discovery, query, resolve_citation]\n  sop:\n    enabled: false\nrouter:\n  enabled: false\nfrontend:\n  businessModules:\n    agent.routing:\n      enabled: false\n`, 'utf8');

await writeFile(configPath, (await readFile(configPath, 'utf8')).replace('tenant_g4_browser', 'tenant_demo').replace('g4-owner', 'admin'), 'utf8');

let knowledgeService;
let pilotService;
let browser;
try {
  knowledgeService = start(python, ['-m', 'uvicorn', 'app.module_knowledge_app:app', '--host', '127.0.0.1', '--port', String(ports.knowledge), '--log-level', 'warning'], {
    PYTHONPATH: `${join(staffRoot, 'backend')}:${join(staffRoot, 'backend/src')}:${join(staffRoot, 'portable_sop/src')}`,
    DATABASE_URL: `sqlite:///${database}`,
    APP_SECRET: 'g4-browser-secret',
    STAFFDECK_KNOWLEDGE_SEED: 'true',
    DEMO_SEED_ENABLED: 'false',
    STARTUP_ORPHAN_CLEANUP_ENABLED: 'false',
    STAFFDECK_KNOWLEDGE_USER_ID: 'admin',
    STAFFDECK_KNOWLEDGE_TENANT_ID: 'tenant_demo',
  }, join(staffRoot, 'backend'));
  await waitFor(`http://127.0.0.1:${ports.knowledge}/api/health`);
  pilotService = start(process.execPath, ['scripts/dev-launcher.mjs'], {
    NODE_OPTIONS: '', PILOT_HOME: pilotHome, PILOTDECK_CONFIG_PATH: configPath,
    PILOTDECK_FRONTEND_PROFILE: configPath, PILOTDECK_DISABLE_LOCAL_AUTH: '0',
    SERVER_PORT: String(ports.api), VITE_PORT: String(ports.vite),
    PILOTDECK_GATEWAY_PORT: String(ports.gateway), PILOTDECK_GATEWAY_URL: `ws://127.0.0.1:${ports.gateway}/ws`,
    PILOTDECK_MODULE_ADMIN: '1',
  }, root);
  await waitFor(`http://127.0.0.1:${ports.vite}/api/auth/status`);
  browser = await chromium.launch({ headless: process.env.HEADED !== '1', executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes('/api/modules/knowledge')) output.requests.push({ method: request.method(), path: url.pathname, body: request.postDataJSON?.() ?? null });
  });
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (url.pathname === '/api/modules/knowledge/call') {
      output.requests.push({
        operation: response.request().postDataJSON?.().operation,
        responseStatus: response.status(),
        responseBody: await response.text().catch(() => ''),
      });
    }
  });
  const credentials = { username: 'g4-browser-owner', password: 'g4-browser-owner-password' };
  output.actions.push('register-or-login single-user owner');
  const registration = await context.request.post(`http://127.0.0.1:${ports.vite}/api/auth/register`, { data: credentials });
  const account = registration.ok() ? await registration.json() : await (await context.request.post(`http://127.0.0.1:${ports.vite}/api/auth/login`, { data: credentials })).json();
  assert.equal(typeof account.token, 'string');
  await context.request.post(`http://127.0.0.1:${ports.vite}/api/user/complete-onboarding`, { headers: { authorization: `Bearer ${account.token}` } });
  await page.addInitScript((token) => localStorage.setItem('auth-token', token), account.token);
  await page.goto(`http://127.0.0.1:${ports.vite}/knowledge/new`, { waitUntil: 'domcontentloaded' });
  output.actions.push('open Knowledge new page');
  const file = join(tempRoot, 'g4-policy.md');
  await writeFile(file, '# G4 Approval Policy\n\nOwner approval is required.\n\nUnchanged field: retain this paragraph.\n', 'utf8');
  const chooser = page.locator('input[type=file]').first();
  await chooser.setInputFiles(file);
  output.actions.push('upload document through file input');
  await page.waitForTimeout(1_500);
  const uploadBody = await page.locator('body').innerText();
  if (!/g4-policy\.md/.test(uploadBody)) throw new Error(`Upload UI did not render job. body=${uploadBody.slice(-3000)}`);
  const jobStatuses = new Set();
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const statusText = await page.locator('.knowledge-job').first().innerText().catch(() => '');
    output.jobs.push(statusText);
    const match = statusText.match(/(排队中|处理中|已完成|成功|失败|取消)/);
    if (match) jobStatuses.add(match[1]);
    if (/已完成|成功/.test(statusText)) break;
    if (/失败|取消/.test(statusText)) throw new Error(`Knowledge job failed: ${statusText}`);
    await page.waitForTimeout(1_000);
  }
  assert.ok(output.jobs.length > 0, 'UI did not render the ingest job');
  output.actions.push('wait for async ingest completion in UI');
  await page.goto(`http://127.0.0.1:${ports.vite}/knowledge`, { waitUntil: 'domcontentloaded' });
  const row = await findPolicyRow(page);
  output.actions.push('refresh Knowledge management page and locate persisted base');
  const baseText = await page.locator('body').innerText();
  assert.match(baseText, /g4-policy/);
  await row.click();
  await page.getByText(/Knowledge graph|知识图谱/).last().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  const detailTextBefore = await page.locator('body').innerText();
  output.persistence.detailBefore = detailTextBefore.slice(-4000);
  output.actions.push('open persisted document detail');
  const viewDocumentButton = page.locator('.knowledge-pageindex-card').getByRole('button', { name: /详情|Details/ });
  await viewDocumentButton.scrollIntoViewIfNeeded();
  await viewDocumentButton.click();
  await page.getByText(/文档详情|Document Details/).last().waitFor({ state: 'visible', timeout: 10_000 });
  const editButton = page.getByRole('button', { name: /修改|编辑|Modify|Edit/ }).last();
  assert.equal(await editButton.count(), 1, 'Persisted document detail did not expose the edit action');
  await editButton.click();
  const textarea = page.locator('textarea').last();
  assert.equal(await textarea.count(), 1, 'Document editor did not render a textarea');
  await textarea.fill('# G4 Approval Policy Updated\n\nOwner approval is required.\n\nUnchanged field: retain this paragraph.\n');
  await page.getByRole('button', { name: /保存并重建索引|Save and rebuild/ }).last().click();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const saved = output.requests.find((item) => item.operation === 'update_document' && Number.isInteger(item.responseStatus));
    if (saved) {
      assert.ok(saved.responseStatus >= 200 && saved.responseStatus < 300, `Document update failed with HTTP ${saved.responseStatus}`);
      break;
    }
    await page.waitForTimeout(1_000);
    if (attempt === 29) throw new Error('Timed out waiting for update_document response evidence');
  }
  output.actions.push('edit正文 and save through UI');

  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloadedRow = await findPolicyRow(page);
  await reloadedRow.click();
  await page.getByText(/Knowledge graph|知识图谱/).last().waitFor({ timeout: 20_000 });
  const reloadedViewDocumentButton = page.locator('.knowledge-pageindex-card').getByRole('button', { name: /详情|Details/ });
  await reloadedViewDocumentButton.scrollIntoViewIfNeeded();
  await reloadedViewDocumentButton.click();
  await page.getByText(/文档详情|Document Details/).last().waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText('Unchanged field', { exact: false }).last().waitFor({ timeout: 20_000 });
  output.persistence.detailAfter = (await page.locator('body').innerText()).slice(-4000);
  assert.match(output.persistence.detailAfter, /G4 Approval Policy Updated/);
  assert.match(output.persistence.detailAfter, /Unchanged field/);
  output.actions.push('reload and verify unchanged field persisted');
  await page.keyboard.press('Escape');
  const openDocumentDialog = page.locator('[role="dialog"]').last();
  if (await openDocumentDialog.count()) await openDocumentDialog.click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(300);
  const queryInput = page.getByPlaceholder(/输入知识问题|knowledge question/i);
  if (await queryInput.count()) {
    await queryInput.fill('Owner approval');
    await page.getByRole('button', { name: /检索|Search/i }).click();
    let queryEvidence;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      queryEvidence = output.requests.find((item) => item.operation === 'query' && Number.isInteger(item.responseStatus));
      if (queryEvidence) break;
      await page.waitForTimeout(1_000);
    }
    assert.ok(queryEvidence, 'Timed out waiting for query response evidence');
    assert.ok(queryEvidence.responseStatus >= 200 && queryEvidence.responseStatus < 300, `Knowledge query failed with HTTP ${queryEvidence.responseStatus}`);
    const body = JSON.parse(queryEvidence.responseBody);
    const result = body.result || body;
    const citation = result.evidence_pack?.[0]?.chunk_id || result.evidence_pack?.[0]?.chunkId;
    assert.ok(citation, `query returned no citation: ${JSON.stringify(result)}`);
    const citationResponse = await context.request.post(`http://127.0.0.1:${ports.vite}/api/modules/knowledge/citation`, { headers: { authorization: `Bearer ${account.token}` }, data: { chunkId: citation } });
    assert.equal(citationResponse.ok(), true);
    output.persistence.citation = await citationResponse.json();
    output.actions.push('query and resolve citation source');
  }
  await page.screenshot({ path: join(artifactRoot, 'g4-knowledge-browser.png'), fullPage: true });
  await writeFile(join(artifactRoot, 'report.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await context.close();
} catch (error) {
  output.error = error instanceof Error ? error.stack : String(error);
  await writeFile(join(artifactRoot, 'report.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  throw error;
} finally {
  await browser?.close();
  await stop(pilotService);
  await stop(knowledgeService);
  await rm(tempRoot, { recursive: true, force: true });
  output.cleanup.removed = true;
  await writeFile(join(artifactRoot, 'cleanup.json'), `${JSON.stringify(output.cleanup, null, 2)}\n`, 'utf8').catch(() => undefined);
}

console.log(JSON.stringify({ artifactRoot, actions: output.actions, requestCount: output.requests.length, jobSamples: output.jobs.length }, null, 2));
