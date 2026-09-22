#!/usr/bin/env node

/**
 * Browser-level seven-state composition matrix.
 *
 * Each state gets its own generated frontend entrypoint. The default mock mode
 * supplies deterministic shell responses, while --mode=real starts the actual
 * PilotDeck server/Vite/runtime projection and authenticates through its JWT
 * API. Both modes exercise the real browser router, settings composition,
 * legacy redirects, chat surface, and request contract.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { stringify as stringifyYaml } from 'yaml';
import { renderGeneratedEntrypoint } from './generate-frontend-modules.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const uiRoot = resolve(root, 'ui');
const generatedPath = resolve(uiRoot, 'src/composition/generated/frontend-modules.ts');
const artifactRoot = resolve(root, 'test-results/frontend-g3-browser-matrix');
const mode = process.argv.includes('--mode=real') ? 'real' : 'mock';

const core = {
  agentLoop: { enabled: true, provider: 'pilotdeck' },
  skills: { enabled: true, provider: 'pilotdeck' },
  tools: { enabled: true, provider: 'pilotdeck' },
  context: { enabled: true, provider: 'pilotdeck' },
  modelProvider: { enabled: true, provider: 'pilotdeck' },
};
const staffdeckSlots = {
  ...core,
  sop: {
    enabled: true,
    implementationId: 'staffdeck.portable-sop',
    contract: 'sop.lifecycle/v2',
    transport: 'sop-http-v2',
    methods: ['prepare', 'submit'],
  },
  knowledge: {
    enabled: true,
    implementationId: 'staffdeck.knowledge',
    contract: 'staffdeck.knowledge/v1',
    transport: 'module-http-v2',
    methods: ['list_bases', 'import_document', 'get_job', 'update_document', 'query', 'resolve_citation'],
  },
};
const minimalSlots = {
  ...core,
  skills: { enabled: false },
  sop: { enabled: false },
  knowledge: { enabled: false },
};

const replacementKnowledgeSlots = {
  ...core,
  skills: { enabled: false },
  knowledge: {
    enabled: true,
    implementationId: 'replacement.knowledge',
    frontendModule: 'fixture.knowledge-search',
    contract: 'staffdeck.knowledge/v1',
    transport: 'module-http-v2',
    methods: ['query', 'resolve_citation'],
  },
};

const states = [
  {
    id: 'native-routing-installed-off', modules: core, routingInstalled: true, routingEnabled: false,
    permissionsInstalled: true, expectedKnowledge: false, expectedSop: false,
  },
  {
    id: 'native-routing-enabled', modules: core, routingInstalled: true, routingEnabled: true,
    permissionsInstalled: true, expectedKnowledge: false, expectedSop: false,
  },
  {
    id: 'staffdeck-routing-installed-off', modules: staffdeckSlots, routingInstalled: true, routingEnabled: false,
    permissionsInstalled: true, expectedKnowledge: true, expectedSop: true,
  },
  {
    id: 'staffdeck-routing-enabled', modules: staffdeckSlots, routingInstalled: true, routingEnabled: true,
    permissionsInstalled: true, expectedKnowledge: true, expectedSop: true,
  },
  {
    id: 'minimal-routing-installed-off', modules: minimalSlots, routingInstalled: false, routingEnabled: false,
    permissionsInstalled: false, expectedKnowledge: false, expectedSop: false,
  },
  {
    id: 'minimal-routing-enabled', modules: minimalSlots, routingInstalled: false, routingEnabled: false,
    permissionsInstalled: false, expectedKnowledge: false, expectedSop: false,
  },
  {
    id: 'replacement-knowledge-enabled', modules: replacementKnowledgeSlots, routingInstalled: false, routingEnabled: false,
    permissionsInstalled: true, expectedKnowledge: false, expectedSop: false, replacement: true,
  },
].map((state) => ({
  ...state,
  frontend: { businessModules: {
    ...(state.routingInstalled ? { 'agent.routing': { enabled: true } } : {}),
    'tools.permissions': { enabled: state.permissionsInstalled },
  } },
  expectedRoutingSettings: state.routingInstalled,
  expectedPermissions: state.permissionsInstalled,
}));
const requestedState = process.env.G3_STATE;
const matrixStates = requestedState ? states.filter((state) => state.id === requestedState) : states;
if (requestedState && matrixStates.length === 0) throw new Error(`Unknown G3_STATE: ${requestedState}`);

const slotContracts = {
  agentLoop: 'pilotdeck.agent-loop/v1',
  skills: 'pilotdeck.skills/v1',
  tools: 'pilotdeck.tools/v1',
  context: 'pilotdeck.context/v1',
  modelProvider: 'pilotdeck.model-provider/v1',
  sop: 'sop.lifecycle/v2',
  knowledge: 'staffdeck.knowledge/v1',
};
const slotTransports = {
  agentLoop: 'pilotdeck-http-v1',
  skills: 'pilotdeck-http-v1',
  tools: 'pilotdeck-http-v1',
  context: 'pilotdeck-http-v1',
  modelProvider: 'pilotdeck-http-v1',
  sop: 'sop-http-v2',
  knowledge: 'module-http-v2',
};
const slotMethods = {
  agentLoop: ['execute', 'cancel', 'status', 'resume', 'ack'],
  skills: ['list', 'read'],
  tools: ['execute'],
  context: ['prepare_for_model', 'apply_tool_results', 'try_auto_compact'],
  modelProvider: ['prepare', 'stream'],
  sop: ['prepare', 'submit', 'status', 'resume'],
  knowledge: ['list_bases', 'import_document', 'get_job', 'update_document', 'query', 'resolve_citation'],
};

function runtimeFor(modules) {
  const result = {};
  for (const [slot, binding] of Object.entries(modules)) {
    result[slot] = {
      enabled: binding.enabled !== false,
      provider: binding.provider,
      implementationId: binding.implementationId,
      frontendModule: binding.frontendModule,
      contract: binding.contract ?? slotContracts[slot],
      transport: binding.transport ?? slotTransports[slot],
      methods: binding.methods ?? slotMethods[slot],
    };
  }
  for (const slot of Object.keys(slotContracts)) {
    if (!result[slot]) result[slot] = { enabled: false };
  }
  return {
    modules: result,
    gatewayCapabilities: ['chat', 'permissions'],
    runtime: { gatewayState: 'ready', unavailableSlots: [] },
  };
}

function waitForHttp(url, timeoutMs = 20_000) {
  const started = Date.now();
  return new Promise((resolveWait, reject) => {
    const poll = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) return resolveWait();
      } catch {}
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting for ${url}`));
      setTimeout(poll, 100);
    };
    void poll();
  });
}

function start(command, args, env, { detached = false, cwd = uiRoot } = {}) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return { child, detached, getOutput: () => output };
}

async function stop(processHandle) {
  if (!processHandle || processHandle.child.exitCode !== null) return;
  if (processHandle.detached) {
    try { process.kill(-processHandle.child.pid, 'SIGTERM'); } catch {}
  } else processHandle.child.kill('SIGTERM');
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      if (processHandle.child.exitCode === null) processHandle.child.kill('SIGKILL');
      resolveStop();
    }, 2_000);
    processHandle.child.once('exit', () => { clearTimeout(timer); resolveStop(); });
  });
}

async function startStaffDeckServices(state, stateRoot, realModules) {
  if (mode !== 'real') return [];
  const staffRoot = process.env.STAFFDECK_ROOT || resolve(root, '../StaffDeck-shared-business-ui');
  const python = process.env.STAFFDECK_PYTHON || '/tmp/staffdeck-shared-venv/bin/python';
  const services = [];
  const baseEnv = {
    ...process.env,
    PYTHONPATH: `${resolve(staffRoot, 'backend')}:${resolve(staffRoot, 'backend/src')}:${resolve(staffRoot, 'portable_sop/src')}`,
  };
  if (realModules.knowledge?.enabled && realModules.knowledge.frontendModule === 'fixture.knowledge-search') {
    const port = 19993;
    const evidencePath = resolve(stateRoot, 'replacement-evidence.jsonl');
    const replacement = start(process.execPath, [resolve(root, 'products/pilotdeck-staffdeck-sop/fixtures/replacement-knowledge-runtime.mjs')], {
      ...process.env,
      REPLACEMENT_KNOWLEDGE_PORT: String(port),
      REPLACEMENT_KNOWLEDGE_EVIDENCE_PATH: evidencePath,
    });
    services.push(replacement);
    await waitForHttp(`http://127.0.0.1:${port}/healthz`);
    realModules.knowledge.endpoint = `http://127.0.0.1:${port}`;
  } else if (realModules.knowledge?.enabled) {
    const port = 19990;
    const database = resolve(stateRoot, 'knowledge.db');
    const knowledge = start(python, ['-m', 'uvicorn', 'app.module_knowledge_app:app', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'warning'], {
      ...baseEnv,
      DATABASE_URL: `sqlite:///${database}`,
      APP_SECRET: 'g3-real-browser-secret',
      STAFFDECK_KNOWLEDGE_SEED: 'true',
      STAFFDECK_KNOWLEDGE_USER_ID: 'admin',
    }, { cwd: resolve(staffRoot, 'backend') });
    services.push(knowledge);
    await waitForHttp(`http://127.0.0.1:${port}/api/health`);
    realModules.knowledge.endpoint = `http://127.0.0.1:${port}`;
  }
  if (realModules.sop?.enabled) {
    const port = 19991;
    const sop = start(python, ['-m', 'uvicorn', 'staffdeck_sop_runtime.api:app', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'warning'], baseEnv, { cwd: staffRoot });
    services.push(sop);
    await waitForHttp(`http://127.0.0.1:${port}/healthz`);
    realModules.sop.endpoint = `http://127.0.0.1:${port}`;
  }
  return services;
}

async function runState(state, index, browser) {
  const stateRoot = resolve(artifactRoot, state.id);
  const distDir = resolve(stateRoot, 'dist');
  await rm(stateRoot, { recursive: true, force: true });
  await mkdir(stateRoot, { recursive: true });
  const source = renderGeneratedEntrypoint(
    { modules: state.modules, frontend: state.frontend },
    generatedPath,
  );
  await writeFile(generatedPath, source, 'utf8');
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);

  const build = start('pnpm', ['exec', 'vite', 'build', '--outDir', distDir, '--logLevel', 'error'], {
    ...process.env,
    NODE_OPTIONS: '',
    PILOTDECK_DISABLE_LOCAL_AUTH: '1',
  });
  const buildExit = await new Promise((resolveBuild, rejectBuild) => {
    build.child.once('exit', (code) => code === 0 ? resolveBuild() : rejectBuild(new Error(`Vite build failed for ${state.id}: ${build.getOutput()}`)));
    build.child.once('error', rejectBuild);
  });
  void buildExit;
  const port = 15400 + index;
  const serverPort = 16400 + index;
  const gatewayPort = 17400 + index;
  const realRoot = resolve(stateRoot, 'pilot-home');
  await mkdir(realRoot, { recursive: true });
  const profilePath = resolve(stateRoot, 'profile.yaml');
  const auxiliaryServices = [];
  const realModules = JSON.parse(JSON.stringify(state.modules));
  if (realModules.sop?.enabled) {
    realModules.sop.endpoint = 'http://127.0.0.1:19991';
    realModules.sop.definitionsPath = resolve(stateRoot, 'sops.yaml');
    realModules.sop.defaultSopId = 'g3_probe';
    await writeFile(realModules.sop.definitionsPath, 'sops:\n  - id: g3_probe\n    version: "1"\n    name: G3 probe\n    content:\n      start_node_id: done\n      nodes:\n        - node_id: done\n      terminal_node_ids: [done]\n', 'utf8');
  }
  if (realModules.knowledge?.enabled) {
    realModules.knowledge.tenantId = 'tenant_demo';
    realModules.knowledge.actorUserId = 'admin';
  }
  auxiliaryServices.push(...await startStaffDeckServices(state, stateRoot, realModules));
  await writeFile(profilePath, stringifyYaml({
    schemaVersion: 1,
    agent: { model: 'smoke/operator' },
    model: { providers: { smoke: { protocol: 'openai', url: 'http://127.0.0.1:19992/v1', apiKey: 'local-only', models: { operator: { capabilities: { supportsToolUse: true } } } } } },
    webui: { runtime: { serverPort, vitePort: port, databasePath: resolve(realRoot, 'auth.db'), workspacesRoot: resolve(realRoot, 'workspaces') } },
    modules: realModules,
    router: { enabled: state.routingEnabled },
    frontend: state.frontend,
  }), 'utf8');
  const service = mode === 'real'
    ? start(process.execPath, [resolve(root, 'scripts/dev-launcher.mjs')], {
      ...process.env,
      NODE_OPTIONS: '',
      PILOT_HOME: realRoot,
      PILOTDECK_CONFIG_PATH: profilePath,
      PILOTDECK_FRONTEND_PROFILE: profilePath,
      PILOTDECK_DISABLE_LOCAL_AUTH: '0',
      SERVER_PORT: String(serverPort),
      VITE_PORT: String(port),
      PILOTDECK_GATEWAY_PORT: String(gatewayPort),
      PILOTDECK_GATEWAY_URL: `ws://127.0.0.1:${gatewayPort}/ws`,
    }, { detached: true })
    : start('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--outDir', distDir], {
      ...process.env,
      NODE_OPTIONS: '',
      PILOTDECK_DISABLE_LOCAL_AUTH: '1',
    });
  const baseURL = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(`${baseURL}/`);
    if (mode === 'real') await waitForHttp(`${baseURL}/api/auth/status`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const requests = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) requests.push({ path: url.pathname, method: request.method(), body: request.postDataJSON?.() ?? null });
    });
    if (mode === 'mock') {
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        if (path === '/api/modules/runtime') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runtimeFor(state.modules)) });
        }
        if (path === '/api/auth/status') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authDisabled: true }) });
        }
        if (path === '/api/user/onboarding-status' || path === '/api/user/runtime-status') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configuration: { state: 'empty', modelRef: '', configPath: null, revision: '' }, gateway: { state: 'ready' } }) });
        }
        if (path === '/api/projects') {
          return route.fulfill({ status: 200, headers: { 'X-Projects-Revision': '1' }, contentType: 'application/json', body: JSON.stringify([{ name: 'general', displayName: 'General', fullPath: '/tmp/general', kind: 'general', sessions: [], sessionMeta: { total: 0, hasMore: false }, capabilities: { files: true, explore: true } }]) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
      });
    } else {
      const credentials = { username: `g3-${state.id}`, password: 'g3-browser-evidence-password' };
      const registration = await context.request.post(`${baseURL}/api/auth/register`, { data: credentials });
      const account = registration.ok()
        ? await registration.json()
        : await (await context.request.post(`${baseURL}/api/auth/login`, { data: credentials })).json();
      assert.equal(typeof account.token, 'string', `${state.id}: real authentication did not return JWT`);
      await context.request.post(`${baseURL}/api/user/complete-onboarding`, { headers: { authorization: `Bearer ${account.token}` } });
      await page.addInitScript((token) => localStorage.setItem('auth-token', token), account.token);
    }

    await page.addInitScript(() => localStorage.setItem('userLanguage', 'zh-CN'));
    const runtimeResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/modules/runtime', { timeout: 15_000 });
    await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' });
    const runtimeResult = await runtimeResponse;
    assert.equal(runtimeResult.status(), 200, `${state.id}: runtime projection failed`);
    await page.waitForTimeout(600);
    const chatSurface = await page.locator('textarea').count() > 0 || await page.locator('[data-chat-composer-slot]').count() > 0;
    if (!chatSurface && state.replacement) {
      throw new Error(`${state.id}: replacement profile did not render chat surface at ${page.url()}\n${(await page.locator('body').innerText().catch(() => '')).slice(0, 2000)}`);
    }
    assert.equal(chatSurface, true, `${state.id}: chat surface not rendered`);

    await page.goto(`${baseURL}/settings/module/agent-route`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    const routingSettings = await page.locator('[data-testid="module-settings-agent-route"]').count();
    const routingUnavailable = await page.locator('[data-testid="module-settings-unavailable-agent-route"]').count();
    assert.equal(routingSettings > 0, state.expectedRoutingSettings, `${state.id}: agent route settings mismatch`);
    assert.equal(routingUnavailable > 0, !state.expectedRoutingSettings, `${state.id}: agent route unavailable mismatch`);
    if (state.routingInstalled && mode === 'real') {
      const routingSwitch = page.getByRole('switch', { name: /智能路由|smart routing/i });
      await routingSwitch.waitFor({ state: 'visible' });
      assert.equal(await routingSwitch.getAttribute('aria-checked'), String(state.routingEnabled), `${state.id}: routing runtime switch mismatch`);
    }

    await page.goto(`${baseURL}/settings/module/tools-permissions`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    const permissionSettings = await page.locator('[data-testid="module-settings-tools-permissions"]').count();
    const permissionUnavailable = await page.locator('[data-testid="module-settings-unavailable-tools-permissions"]').count();
    assert.equal(permissionSettings > 0, state.expectedPermissions, `${state.id}: permission settings mismatch`);
    assert.equal(permissionUnavailable > 0, !state.expectedPermissions, `${state.id}: permission unavailable mismatch`);

    for (const [path, placeholder, enabled] of [
      ...(state.replacement ? [['/knowledge-search', 'Search the replacement knowledge service', true]] : []),
      ['/sop', '搜索 SOP 名称、ID、业务域', Boolean(state.modules.sop?.enabled)],
      ['/knowledge', '输入知识问题', Boolean(state.modules.knowledge?.enabled && !state.replacement)],
    ]) {
      await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' });
      // A replacement module is selected asynchronously by the runtime
      // projection; retry the deep link once after the shell has hydrated.
      if (mode === 'real' && state.replacement && new URL(page.url()).pathname !== path) {
        await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' });
      }
      if (mode === 'real' && enabled) {
        try {
          await page.getByPlaceholder(placeholder).first().waitFor({ state: 'visible', timeout: 15_000 });
        } catch (error) {
          const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 1600);
          const serviceOutput = auxiliaryServices.map((item) => item.getOutput()).join('\n').slice(-4000);
          throw new Error(`${state.id}: ${path} did not mount (url=${page.url()})\n${bodyText}\nservices:\n${serviceOutput}`, { cause: error });
        }
      } else {
        await page.waitForTimeout(300);
      }
      const present = await page.getByPlaceholder(placeholder).count() > 0;
      const routeVisible = new URL(page.url()).pathname === path;
      if (mode === 'real' && enabled) assert.equal(routeVisible, true, `${state.id}: ${path} route did not mount`);
      else if (mode === 'real') assert.equal(present, false, `${state.id}: disabled ${path} route exposed its page`);
      else if (enabled) assert.equal(routeVisible, true, `${state.id}: ${path} route did not mount in mock mode`);
      else assert.ok(['/','/p/general'].includes(new URL(page.url()).pathname), `${state.id}: disabled ${path} route leaked in mock mode`);
    }

    const legacy = {};
    for (const path of ['/always-on', '/cron', '/memory']) {
      await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(250);
      legacy[path] = new URL(page.url()).pathname;
      assert.ok(['/','/p/general'].includes(legacy[path]), `${state.id}: legacy route ${path} was not redirected`);
    }

    const forbiddenOptionalPaths = state.modules.sop?.enabled || state.modules.knowledge?.enabled
      ? []
      : ['/api/modules/sop/', '/api/modules/knowledge/'];
    for (const forbiddenPrefix of forbiddenOptionalPaths) {
      assert.equal(requests.some((item) => item.path.startsWith(forbiddenPrefix)), false, `${state.id}: unloaded module request leaked: ${forbiddenPrefix}`);
    }

    const report = {
      id: state.id,
      result: 'passed',
      mode,
      mockBoundary: mode === 'mock'
        ? 'Only the shell API and runtime projection are mocked; browser routing, composition, Settings, legacy redirects, and request observation are real.'
        : null,
      build: { outDir: distDir, selectedImports: imports },
      browser: { baseURL, chatSurface, settings: { routingSettings, routingUnavailable, permissionSettings, permissionUnavailable }, legacy },
      requests,
      requestPaths: [...new Set(requests.map((item) => item.path))].sort(),
      runtime: runtimeFor(state.modules),
    };
    await page.screenshot({ path: resolve(stateRoot, 'g3-browser.png'), fullPage: true });
    await writeFile(resolve(stateRoot, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
    await context.close();
    await stop(service);
    for (const auxiliary of auxiliaryServices.reverse()) await stop(auxiliary);
    return report;
  } catch (error) {
    await stop(service);
    for (const auxiliary of auxiliaryServices.reverse()) await stop(auxiliary);
    throw error;
  }
}

const original = await readFile(generatedPath, 'utf8');
await rm(artifactRoot, { recursive: true, force: true });
await mkdir(artifactRoot, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
});
const reports = [];
try {
  for (let index = 0; index < matrixStates.length; index += 1) {
    reports.push(await runState(matrixStates[index], index, browser));
    console.log(`G3 browser state ${index + 1}/${matrixStates.length} (${mode}): ${matrixStates[index].id} PASS`);
  }
  await writeFile(resolve(artifactRoot, 'report.json'), `${JSON.stringify({ stateCount: reports.length, states: reports }, null, 2)}\n`);
  console.log(`G3 browser matrix (${mode}): ${reports.length}/${matrixStates.length} PASS`);
} finally {
  await browser.close();
  await writeFile(generatedPath, original, 'utf8');
}
