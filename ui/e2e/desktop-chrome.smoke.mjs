// Run with Vite on 127.0.0.1:5187 and compiled apps/desktop/dist.
// All app network traffic is synthetic; no real runtime or model is contacted.
import { _electron as electron, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const generatedFrontendProfile = JSON.parse((
  /export const generatedFrontendProfile = (\{[\s\S]*\})\s+as const;/.exec(
    await fs.readFile(path.join(root, 'ui/src/composition/generated/frontend-modules.ts'), 'utf8'),
  ) ?? []
)[1] ?? '');
if (!generatedFrontendProfile?.modules) throw new Error('generatedFrontendProfile.modules is required for the /api/modules/runtime mock');
const mac = process.platform === 'darwin';
const platformName = mac ? 'mac' : process.platform === 'linux' ? 'linux' : 'windows';
const artifactDir = process.env.PILOTDECK_CHROME_ARTIFACTS || path.join(root, 'outputs/desktop-chrome-review');
await fs.mkdir(artifactDir, { recursive: true });
const { installWaylandDiag } = createRequire(import.meta.url)(
  path.join(root, 'apps/desktop/scripts/fixtures/wayland-file-diag.cjs'),
);
const diagGroup = process.env.PILOTDECK_WAYLAND_DIAG_GROUP || '';
const diagGpu = process.env.PILOTDECK_WAYLAND_DIAG_GPU || 'default';
const ozone = process.env.PILOTDECK_CHROME_OZONE || null;
const relaunchOnly = process.env.PILOTDECK_WAYLAND_DIAG_RELAUNCH_ONLY === '1';
const waylandFrameDiag = relaunchOnly && ozone === 'wayland';
const dumpStem = relaunchOnly && ozone === 'x11' ? 'linux-x11-diag' : 'linux-wayland-diag';
const gpuLaunchArgs = diagGpu === 'off' ? ['--disable-gpu']
  : diagGpu === 'swiftshader' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : [];
const electronLaunchArgs = [
  path.join(root, 'apps/desktop/scripts/fixtures/desktop-chrome.cjs'),
  ...(process.env.PILOTDECK_CHROME_SCALE ? [`--force-device-scale-factor=${process.env.PILOTDECK_CHROME_SCALE}`] : []),
  ...(process.env.PILOTDECK_CHROME_OZONE ? [`--ozone-platform=${process.env.PILOTDECK_CHROME_OZONE}`] : []),
  ...(process.env.PILOTDECK_CHROME_DISABLE_SANDBOX ? ['--no-sandbox'] : []),
  ...(diagGroup === 'B' ? ['--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] : []),
  ...gpuLaunchArgs,
];
const snapshotWaylandDiag = async page => {
  try { return await page.evaluate(() => window.__waylandDiag?.snapshot() ?? null); }
  catch (evalError) { return { evalError: String(evalError) }; }
};
const dumpWaylandDiag = async (page, label, error, extra = {}) => {
  const snapshot = await snapshotWaylandDiag(page);
  const png = path.join(artifactDir, `${dumpStem}-${label}.png`);
  const json = path.join(artifactDir, `${dumpStem}-${label}.json`);
  const payload = {
    label, error: error ? { name: error.name, message: error.message } : null,
    ozone: process.env.PILOTDECK_CHROME_OZONE || null,
    waylandDisplay: process.env.WAYLAND_DISPLAY || null,
    snapshot,
    installSource: snapshot?.installSource ?? extra.installSource ?? null,
    group: diagGroup || extra.group || null,
    gpu: diagGpu,
    png, json,
    ...extra,
  };
  await fs.writeFile(json, `${JSON.stringify(payload, null, 2)}\n`);
  try { await page.screenshot({ path: png, fullPage: true, timeout: 5000 }); }
  catch (screenshotError) { payload.screenshotError = String(screenshotError); }
  console.log('WAYLAND_FILE_DIAG_DUMP', JSON.stringify({
    label, png, json,
    kind: extra.kind ?? null,
    group: diagGroup || null,
    gpu: diagGpu,
    installSource: snapshot?.installSource ?? extra.installSource ?? null,
    rafCount: snapshot?.rafCount, rafDelta1s: snapshot?.rafDelta1s, rafRate: snapshot?.rafRate,
    visibility: snapshot?.visibility, hasFocus: snapshot?.hasFocus, box: snapshot?.box,
    eventCount: snapshot?.events?.length, bboxCount: snapshot?.bboxes?.length,
    error: payload.error, screenshotError: payload.screenshotError ?? null,
  }));
  return payload;
};
const clickFileOrDump = async (page, locator, label, options) => {
  const before = await snapshotWaylandDiag(page);
  try {
    await locator.click(options);
    return { ok: true, before, after: await snapshotWaylandDiag(page) };
  } catch (error) {
    await dumpWaylandDiag(page, label, error, { before });
    if (options?.timeout !== undefined) return { ok: false, error, before };
    throw error;
  }
};
const attachChromeFixtureRoutes = async (page, ctx) => {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname === '/api/projects') body = ctx.projects;
    else if (url.pathname.includes('onboarding-status')) body = { hasCompletedOnboarding: ctx.completedOnboarding() };
    else if (url.pathname === '/api/settings/permissions') body = { success: true, permissions: { skipPermissions: false, allowedTools: [], deniedTools: [] } };
    else if (url.pathname.includes('/messages')) body = { messages: [], hasMore: false, total: 0 };
    else if (url.pathname.includes('/sessions')) body = { sessions: ctx.projects[1].sessions, hasMore: false, total: 1 };
    else if (url.pathname.includes('/files')) body = [];
    else if (url.pathname.includes('models')) body = { models: [] };
    else if (url.pathname.includes('/skills')) body = { skills: [] };
    else if (url.pathname.includes('/plugins')) body = { plugins: [] };
    else if (url.pathname.includes('/config')) body = { config: { models: {}, agents: {}, tools: {} } };
    else if (url.pathname.includes('/tasks')) body = { tasks: [] };
    else if (url.pathname.includes('/cron')) body = { jobs: [] };
    else ctx.missing.add(url.pathname);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route(url => url.pathname === '/api/modules/runtime', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        modules: generatedFrontendProfile.modules,
        gatewayCapabilities: [],
        runtime: { gatewayState: 'ready', unavailableSlots: [] },
      }),
    });
  });
  await page.route('**/sw.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.routeWebSocket('**/ws**', socket => {
    socket.onMessage(message => {
      try {
        const parsed = JSON.parse(String(message));
        if (parsed.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
      } catch {}
    });
  });
};
const electronExecutable = createRequire(import.meta.url)(path.join(root, 'apps/desktop/node_modules/electron'));
const waylandStderrWrapper = path.join(root, 'apps/desktop/scripts/electron-wayland-stderr.sh');
const lastMatchingLine = (text, re) => {
  let last = null;
  for (const line of text.split('\n')) {
    if (re.test(line)) last = line.slice(0, 300);
  }
  return last;
};
const lastNonEmptyLine = text => {
  const lines = text.split('\n').map(line => line.trimEnd()).filter(Boolean);
  return lines.at(-1) ?? null;
};
const westonPreBytes = Number(process.env.PILOTDECK_WAYLAND_DIAG_PRE_BYTES || 131072);
const westonPostMs = Number(process.env.PILOTDECK_WAYLAND_DIAG_POST_MS || 15000);
const readWestonLive = async () => {
  const live = process.env.PILOTDECK_WESTON_LOG;
  if (!live) return { live: null, buf: Buffer.alloc(0) };
  try {
    try {
      const handle = await fs.open(live, 'r+');
      await handle.sync();
      await handle.close();
    } catch {}
    return { live, buf: await fs.readFile(live) };
  } catch {
    return { live, buf: Buffer.alloc(0) };
  }
};
const writeRange = async (buf, start, end, dest) => {
  const from = Math.max(0, Math.min(start, buf.length));
  const to = Math.max(from, Math.min(end, buf.length));
  const slice = buf.subarray(from, to);
  await fs.writeFile(dest, slice);
  return { dest, bytes: slice.length, start: from, end: to };
};
const sliceWestonLog = async (startSize, dest) => {
  const { live, buf } = await readWestonLive();
  if (!live) return { dest: null, liveBytes: 0, sliceBytes: 0, startSize, tailFallback: false };
  const start = Math.min(startSize, buf.length);
  const written = await writeRange(buf, start, buf.length, dest);
  let tailFallback = false;
  if (written.bytes === 0 && buf.length > 0) {
    await writeRange(buf, Math.max(0, buf.length - 65536), buf.length, `${dest.replace(/\.log$/, '')}-tail.log`);
    tailFallback = true;
  }
  return { dest, liveBytes: buf.length, sliceBytes: written.bytes, startSize: start, tailFallback };
};
const summarizeFrameLogs = async (...files) => {
  const count = (text, re) => (text.match(re) || []).length;
  const parts = [];
  for (const file of files.filter(Boolean)) {
    let text = '';
    try { text = await fs.readFile(file, 'utf8'); } catch { continue; }
    const nonEmpty = text.split('\n').map(line => line.trimEnd()).filter(Boolean);
    parts.push({
      file,
      bytes: Buffer.byteLength(text),
      wlCallback: count(text, /wl_callback/g),
      surfaceFrame: count(text, /wl_surface[#@][0-9]+\.frame/g),
      callbackDone: count(text, /wl_callback[#@][0-9]+\.done/g),
      callbackNew: count(text, /new id wl_callback[#@]/g),
      lastSurfaceFrame: lastMatchingLine(text, /wl_surface[#@][0-9]+\.frame/),
      lastCallbackDone: lastMatchingLine(text, /wl_callback[#@][0-9]+\.done/),
      lastProtocolLine: lastNonEmptyLine(text),
      tailLines: nonEmpty.slice(-20),
      frame: count(text, /\bframe\b/gi),
      repaint: count(text, /repaint/gi),
    });
  }
  return parts;
};
const interpretFrameLogs = parts => {
  const surfaceFrame = parts.reduce((n, part) => n + (part.surfaceFrame || 0), 0);
  const callbackDone = parts.reduce((n, part) => n + (part.callbackDone || 0), 0);
  const callbackNew = parts.reduce((n, part) => n + (part.callbackNew || 0), 0);
  const bytes = parts.reduce((n, part) => n + (part.bytes || 0), 0);
  const lastSurfaceFrame = [...parts].reverse().find(part => part.lastSurfaceFrame)?.lastSurfaceFrame ?? null;
  const lastCallbackDone = [...parts].reverse().find(part => part.lastCallbackDone)?.lastCallbackDone ?? null;
  const lastProtocolLine = [...parts].reverse().find(part => part.lastProtocolLine)?.lastProtocolLine ?? null;
  const tail = parts.flatMap(part => part.tailLines || []);
  const tailHasDone = tail.some(line => /wl_callback[#@][0-9]+\.done/.test(line));
  const tailHasFrame = tail.some(line => /wl_surface[#@][0-9]+\.frame/.test(line));
  let status = 'inconclusive';
  let reason = 'no wl_surface.frame / wl_callback.done in captured logs; compositor not ruled out';
  if (bytes === 0) reason = 'empty logs; compositor not ruled out';
  else if (surfaceFrame === 0 && callbackDone === 0) reason = 'logs have no frame/callback lines; compositor not ruled out';
  else if (surfaceFrame > 0 && callbackDone === 0) {
    status = 'frame callbacks did not complete';
    reason = 'wl_surface.frame seen, no wl_callback.done';
  } else if (surfaceFrame > 0 && callbackDone > 0 && tailHasDone) {
    status = 'frame callbacks still firing';
    reason = 'wl_callback.done still appears in the hang-snapshot tail';
  } else if (surfaceFrame > 0 && callbackDone > 0 && !tailHasDone) {
    status = 'frame callbacks stopped';
    reason = tailHasFrame
      ? 'tail still has wl_surface.frame but no wl_callback.done'
      : 'earlier frame/callback traffic exists; hang-snapshot tail has no wl_callback.done';
  }
  return {
    status, reason, canTell: status !== 'inconclusive',
    surfaceFrame, callbackDone, callbackNew, bytes, tailHasDone, tailHasFrame,
    lastSurfaceFrame, lastCallbackDone, lastProtocolLine,
  };
};
const surfaceStats = (text, id) => {
  const frames = [...(text || '').matchAll(new RegExp(`wl_surface[#@]${id}\\.frame\\(new id wl_callback[#@](\\d+)\\)`, 'g'))];
  const callbackIds = [...new Set(frames.map(match => match[1]))];
  const matchingDone = callbackIds.filter(callbackId =>
    new RegExp(`wl_callback[#@]${callbackId}\\.done`).test(text || ''));
  return {
    emittedFrame: frames.length > 0,
    frameCount: frames.length,
    matchingDone: frames.length ? matchingDone.length > 0 : null,
    callbackIds,
    lastFrame: frames.at(-1)?.[0] ?? null,
  };
};
const discoverSurfaceIds = text => [...new Set([
  ...[...(text || '').matchAll(/wl_surface[#@](\d+)\.frame/g)].map(match => match[1]),
  ...[...(text || '').matchAll(/create_surface\(new id wl_surface[#@](\d+)\)/g)].map(match => match[1]),
])];
const readText = async file => {
  try { return await fs.readFile(file, 'utf8'); } catch { return ''; }
};
const parseWaylandTs = line => {
  const match = line.match(/^\[(\d+(?:\.\d+)?)\]/);
  return match ? Number(match[1]) : null;
};
const resolveMainSurface = text => {
  const regionSize = new Map();
  const candidates = [];
  for (const line of (text || '').split('\n')) {
    const add = line.match(/wl_region[#@](\d+)\.add\(0,\s*0,\s*(\d+),\s*(\d+)\)/);
    if (add) regionSize.set(add[1], { w: Number(add[2]), h: Number(add[3]) });
    const opaque = line.match(/wl_surface[#@](\d+)\.set_opaque_region\(wl_region[#@](\d+)\)/);
    if (opaque) {
      const size = regionSize.get(opaque[2]);
      if (size && size.w === 1320 && size.h === 900) {
        candidates.push({ id: opaque[1], how: 'set_opaque_region 1320x900', size: '1320x900' });
      }
    }
  }
  if (candidates[0]) return candidates[0];
  return { id: null, how: 'unresolved-no-1320x900-opaque', size: null };
};
const mainSurfaceTimeline = (text, id) => {
  if (!id) {
    return { frameCount: 0, firstFrameT: null, lastFrameT: null, createT: null, firstFrameAfterCreateMs: null, lastFrameAfterCreateMs: null, frames: [] };
  }
  const frames = [];
  let createT = null;
  for (const line of (text || '').split('\n')) {
    const t = parseWaylandTs(line);
    if (t != null && new RegExp(`create_surface\\(new id wl_surface[#@]${id}\\)`).test(line)) createT = t;
    const frame = line.match(new RegExp(`wl_surface[#@]${id}\\.frame\\(new id wl_callback[#@](\\d+)\\)`));
    if (frame && t != null) frames.push({ t, callback: frame[1], line: line.slice(0, 240) });
  }
  return {
    frameCount: frames.length,
    firstFrameT: frames[0]?.t ?? null,
    lastFrameT: frames.at(-1)?.t ?? null,
    createT,
    firstFrameAfterCreateMs: frames[0] && createT != null ? frames[0].t - createT : null,
    lastFrameAfterCreateMs: frames.at(-1) && createT != null ? frames.at(-1).t - createT : null,
    frames: frames.length <= 12 ? frames : [...frames.slice(0, 6), ...frames.slice(-4)],
  };
};
const analyzeHungSurfaces = ({ client = '', pre = '', core = '', post = '', widened = '' } = {}) => {
  const resolved = resolveMainSurface([client, core, post].join('\n'));
  const windowId = resolved.id;
  const window = windowId ? surfaceStats([client, core, post].join('\n'), windowId) : {
    emittedFrame: false, frameCount: 0, matchingDone: null, callbackIds: [], lastFrame: null,
  };
  const helperIds = [...new Set(
    discoverSurfaceIds([pre, core, post, client, widened].join('\n')).filter(id => id !== windowId),
  )].sort((a, b) => Number(a) - Number(b));
  const helpers = helperIds.map(id => {
    const regions = {
      pre: surfaceStats(pre, id),
      core: surfaceStats(core, id),
      post: surfaceStats(post, id),
      client: surfaceStats(client, id),
    };
    const emittedFrame = Object.values(regions).some(region => region.emittedFrame);
    const matchingDone = Object.values(regions).some(region => region.matchingDone);
    const windowsWithFrame = Object.entries(regions).filter(([, region]) => region.emittedFrame).map(([name]) => name);
    const duringHung = regions.core.emittedFrame || regions.post.emittedFrame || regions.client.emittedFrame;
    return {
      id: `wl_surface#${id}`,
      emittedFrame,
      matchingDone: emittedFrame ? matchingDone : null,
      duringHung,
      windowsWithFrame,
      ...regions,
    };
  });
  const helpersWithFrame = helpers.filter(helper => helper.emittedFrame).map(helper => helper.id);
  const helpersDuringHung = helpers.filter(helper => helper.duringHung).map(helper => helper.id);
  const helpersOnlyPre = helpers.filter(helper => helper.emittedFrame && !helper.duringHung).map(helper => helper.id);
  return {
    mainSurface: resolved,
    windowSurface: windowId ? `wl_surface#${windowId}` : null,
    windowSize: resolved.size,
    windowLooksLikeHungWindow: Boolean(windowId),
    windowEmittedFrame: window.emittedFrame,
    windowFrameCount: window.frameCount,
    windowMatchingDone: window.matchingDone,
    windowCallbackIds: window.callbackIds,
    helperFrameOrDone: helpers.some(helper => helper.emittedFrame || helper.matchingDone),
    helperSurfaces: helperIds,
    helpers,
    helpersWithFrame,
    helpersDuringHung,
    helpersOnlyPre,
    helperSilence: helpersDuringHung.length
      ? `helper frame/done during hung window: ${helpersDuringHung.join(', ')}`
      : helpersOnlyPre.length
        ? `helper frame/done only in pre-slice (${helpersOnlyPre.join(', ')}); core+post silent — not explained by narrow slice`
        : 'no helper frame/done in widened pre/core/post — cannot distinguish true stop vs idle helper',
    interpretation: !windowId
      ? 'main 1320x900 surface id unresolved this launch'
      : !window.emittedFrame
        ? `no wl_surface#${windowId}.frame in widened client/core/post: client did not request frames for the main window; cannot prove callback sent but missed`
        : window.matchingDone
          ? `wl_surface#${windowId}.frame got matching wl_callback.done`
          : `wl_surface#${windowId}.frame seen but no matching wl_callback.done`,
  };
};
const recordFailureLogs = async ({ label, clientLog, westonStart, westonRoundLog, dumpLabel, extra = {} }) => {
  const prePath = westonRoundLog.replace(/\.log$/, '-pre.log');
  const corePath = westonRoundLog.replace(/\.log$/, '-core.log');
  const postPath = westonRoundLog.replace(/\.log$/, '-post.log');
  await new Promise(resolve => setTimeout(resolve, 150));
  await extra.flushClientLog?.();
  const atHang = await readWestonLive();
  const hangEnd = atHang.buf.length;
  const preStart = Math.max(0, Math.min(westonStart, hangEnd) - westonPreBytes);
  await writeRange(atHang.buf, preStart, Math.min(westonStart, hangEnd), prePath);
  await writeRange(atHang.buf, Math.min(westonStart, hangEnd), hangEnd, corePath);
  const postDeadline = Date.now() + westonPostMs;
  let afterWait = atHang;
  while (Date.now() < postDeadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    afterWait = await readWestonLive();
  }
  await extra.flushClientLog?.();
  afterWait = await readWestonLive();
  const pre = atHang.buf.subarray(preStart, Math.min(westonStart, hangEnd));
  const core = atHang.buf.subarray(Math.min(westonStart, hangEnd), hangEnd);
  const post = afterWait.buf.subarray(Math.min(hangEnd, afterWait.buf.length));
  const postHeader = Buffer.from(`POST_CAPTURE ts=${Date.now()} hangEnd=${hangEnd} liveAfter=${afterWait.buf.length} protocolBytes=${post.length} postMs=${westonPostMs}\n`);
  await fs.writeFile(postPath, Buffer.concat([postHeader, post]));
  await fs.writeFile(westonRoundLog, Buffer.concat([pre, core, post]));
  const westonMeta = {
    dest: westonRoundLog, prePath, corePath, postPath,
    liveBytesAtHang: hangEnd, liveBytesAfterPost: afterWait.buf.length,
    preBytes: pre.length, coreBytes: core.length, postProtocolBytes: post.length, postFileBytes: postHeader.length + post.length,
    widenedBytes: pre.length + core.length + post.length,
    startSize: Math.min(westonStart, hangEnd), preStart, postMs: westonPostMs,
  };
  const clientText = await readText(clientLog);
  const preText = pre.toString('utf8');
  const coreText = core.toString('utf8');
  const postText = post.toString('utf8');
  const frameLogs = await summarizeFrameLogs(clientLog, westonRoundLog, prePath, corePath, postPath);
  const frameCallback = interpretFrameLogs(frameLogs);
  const hungSurfaceTable = analyzeHungSurfaces({
    client: clientText, pre: preText, core: coreText, post: postText,
    widened: [preText, coreText, postText].join('\n'),
  });
  const processText = [clientText, coreText, postText].join('\n');
  const mainSurface = hungSurfaceTable.mainSurface;
  const timeline = mainSurfaceTimeline(processText, mainSurface.id);
  const dumpPath = path.join(artifactDir, `${dumpStem}-${dumpLabel}.json`);
  const markers = extra.markers ?? null;
  try {
    const dumped = JSON.parse(await fs.readFile(dumpPath, 'utf8'));
    dumped.frameLogs = frameLogs;
    dumped.frameCallback = frameCallback;
    dumped.hungSurfaceTable = hungSurfaceTable;
    dumped.mainSurface = mainSurface;
    dumped.mainSurfaceTimeline = timeline;
    dumped.markers = markers;
    dumped.gpu = diagGpu;
    dumped.clientLog = clientLog;
    dumped.westonLog = westonRoundLog;
    dumped.westonMeta = westonMeta;
    dumped.installSource = dumped.installSource ?? extra.installSource ?? null;
    await fs.writeFile(dumpPath, `${JSON.stringify(dumped, null, 2)}\n`);
  } catch {}
  console.log('WAYLAND_FILE_DIAG_FRAME', JSON.stringify({
    label, gpu: diagGpu, mainSurface, timeline: {
      frameCount: timeline.frameCount, firstFrameT: timeline.firstFrameT, lastFrameT: timeline.lastFrameT,
      firstFrameAfterCreateMs: timeline.firstFrameAfterCreateMs,
    },
    hungSurfaceTable, westonMeta, markers,
  }));
  return { frameLogs, frameCallback, hungSurfaceTable, westonMeta, mainSurface, timeline };
};
const probeHungRenderer = async (app, page) => {
  const readMain = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const contents = win.webContents;
    return {
      isPainting: typeof contents.isPainting === 'function' ? contents.isPainting() : null,
      isVisible: win.isVisible(),
      isFocused: win.isFocused(),
      bounds: win.getBounds(),
    };
  });
  const before = await snapshotWaylandDiag(page);
  const baseline = await readMain();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.invalidate();
  });
  await new Promise(resolve => setTimeout(resolve, 3000));
  const afterInvalidate = await snapshotWaylandDiag(page);
  const invalidate = {
    recovered: (afterInvalidate?.rafCount ?? 0) > (before?.rafCount ?? 0),
    rafDelta: (afterInvalidate?.rafCount ?? 0) - (before?.rafCount ?? 0),
    rafCount: afterInvalidate?.rafCount ?? null,
  };
  let resize = null;
  if (!invalidate.recovered) {
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const { width, height } = win.getBounds();
      win.setSize(width + 1, height);
    });
    await new Promise(resolve => setTimeout(resolve, 3000));
    const afterResize = await snapshotWaylandDiag(page);
    resize = {
      recovered: (afterResize?.rafCount ?? 0) > (afterInvalidate?.rafCount ?? 0),
      rafDelta: (afterResize?.rafCount ?? 0) - (afterInvalidate?.rafCount ?? 0),
      rafCount: afterResize?.rafCount ?? null,
    };
  }
  return { baseline, invalidate, resize };
};
const launchChromeFixture = async ({ clientLogPath } = {}) => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pilotdeck-chrome-'));
  const clientLivePath = clientLogPath ? `${clientLogPath}.live` : null;
  if (clientLivePath) await fs.writeFile(clientLivePath, '');
  const app = await electron.launch({
    executablePath: clientLogPath ? waylandStderrWrapper : electronExecutable,
    args: electronLaunchArgs,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE')),
      PILOTDECK_CHROME_PROFILE: profile,
      PILOTDECK_WAYLAND_DIAG: '1',
      ...(clientLivePath ? {
        WAYLAND_DEBUG: '1',
        PILOTDECK_ELECTRON_REAL: electronExecutable,
        PILOTDECK_WAYLAND_CLIENT_LOG: clientLivePath,
      } : {}),
    },
  });
  app.process().on('exit', (code, signal) => { if (code) console.error('Electron exited', { code, signal }); });
  const flushClientLog = async () => {
    if (!clientLogPath || !clientLivePath) return null;
    try { await fs.copyFile(clientLivePath, clientLogPath); }
    catch { await fs.writeFile(clientLogPath, ''); }
    return clientLogPath;
  };
  const page = await app.firstWindow();
  await page.addInitScript(installWaylandDiag, 'page.evaluate');
  await page.evaluate(installWaylandDiag, 'page.evaluate');
  return { app, page, profile, flushClientLog, clientLivePath };
};
const waitFixtureReady = async (page, app) => {
  await page.goto('http://127.0.0.1:5187');
  await page.evaluate(installWaylandDiag, 'page.evaluate');
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 60000 });
  await expect.poll(() => app.evaluate(() => global.chromeTest.state().ready)).toBe(true);
};
const classifyRelaunchFailure = async (app, page, locator, label, before) => {
  const after10 = await snapshotWaylandDiag(page);
  const rafAdvanced = typeof after10?.rafCount === 'number' && typeof before?.rafCount === 'number'
    && after10.rafCount > before.rafCount;
  if (!rafAdvanced) {
    const probe = await probeHungRenderer(app, page).catch(error => ({ probeError: String(error) }));
    await dumpWaylandDiag(page, label, before.error, {
      kind: 'truly hung', installSource: after10?.installSource ?? before?.installSource ?? null,
      before, after10, probe, group: diagGroup,
    });
    return { ok: false, kind: 'truly hung', before, after10, probe };
  }
  try {
    await locator.click({ timeout: 20000 });
    await dumpWaylandDiag(page, label, before.error, {
      kind: 'not clicked within 10s', recoveredAfter30s: true,
      installSource: after10?.installSource ?? before?.installSource ?? null,
      before, after10, group: diagGroup,
    });
    return { ok: false, kind: 'not clicked within 10s', recoveredAfter30s: true, before, after10 };
  } catch (error30) {
    const after30 = await snapshotWaylandDiag(page);
    const stillNoRaf = typeof after30?.rafCount === 'number' && after30.rafCount === after10.rafCount;
    const kind = stillNoRaf ? 'truly hung' : 'not clicked within 10s';
    const probe = kind === 'truly hung'
      ? await probeHungRenderer(app, page).catch(error => ({ probeError: String(error) }))
      : null;
    await dumpWaylandDiag(page, label, error30, {
      kind, stillFailingAfter30s: true,
      installSource: after30?.installSource ?? after10?.installSource ?? null,
      before, after10, after30, probe, group: diagGroup,
    });
    return { ok: false, kind, stillFailingAfter30s: true, before, after10, after30, probe, error: error30 };
  }
};
const clickFileClassified = async (app, page, locator, label) => {
  try { await page.evaluate(() => window.__waylandDiag?.mark?.('file-click')); } catch {}
  const fileClickAt = Date.now();
  const before = await snapshotWaylandDiag(page);
  try {
    await locator.click({ timeout: 10000 });
    return { ok: true, kind: null, before, after: await snapshotWaylandDiag(page), fileClickAt };
  } catch (error) {
    const classified = await classifyRelaunchFailure(app, page, locator, label, { ...before, error });
    return { ...classified, fileClickAt };
  }
};
const runRelaunchFileLoop = async (n = 100) => {
  const projects = [
    { name: 'general', displayName: 'General conversation', kind: 'general', fullPath: '/fixture/general', sessions: [], capabilities: { files: false } },
    { name: 'demo', displayName: 'Desktop design review', kind: 'workspace', fullPath: '/fixture/demo', sessions: [{ id: 'chrome-review', title: 'Native title review', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], capabilities: { files: true } },
  ];
  const earlyStopAt = Number(process.env.PILOTDECK_WAYLAND_DIAG_EARLY_STOP || 3);
  const okKeep = Number(process.env.PILOTDECK_WAYLAND_DIAG_OK_KEEP || 3);
  const rounds = [];
  let okKept = 0;
  for (let i = 1; i <= n; i += 1) {
    const label = `relaunch-${String(i).padStart(3, '0')}`;
    const clientLog = waylandFrameDiag
      ? path.join(artifactDir, `${dumpStem}-${label}-wayland-client.log`) : null;
    const westonRoundLog = waylandFrameDiag
      ? path.join(artifactDir, `${dumpStem}-${label}-weston.log`) : null;
    let westonStart = 0;
    if (waylandFrameDiag && process.env.PILOTDECK_WESTON_LOG) {
      try { westonStart = (await fs.stat(process.env.PILOTDECK_WESTON_LOG)).size; } catch { westonStart = 0; }
    }
    const launched = await launchChromeFixture({ clientLogPath: clientLog });
    try {
      const missing = new Set();
      await attachChromeFixtureRoutes(launched.page, { projects, completedOnboarding: () => true, missing });
      await waitFixtureReady(launched.page, launched.app);
      const caption = launched.page.locator('#pilotdeck-window-caption');
      await expect(caption.locator('button')).toHaveCount(5);
      const fileBtn = caption.getByRole('button', { name: 'File', exact: true });
      const result = await clickFileClassified(launched.app, launched.page, fileBtn, label);
      const keepLogs = !result.ok || okKept < okKeep;
      if (keepLogs) {
        if (result.ok) {
          await dumpWaylandDiag(launched.page, label, null, {
            kind: 'ok', group: diagGroup, installSource: result.after?.installSource ?? result.before?.installSource ?? null,
            before: result.before, after: result.after,
          }).catch(() => {});
          okKept += 1;
        }
        if (waylandFrameDiag) {
          const recorded = await recordFailureLogs({
            label, clientLog, westonStart, westonRoundLog, dumpLabel: label,
            extra: {
              flushClientLog: launched.flushClientLog,
              installSource: result.after?.installSource ?? result.after10?.installSource ?? result.before?.installSource ?? null,
              markers: { fileClickAt: result.fileClickAt ?? null, kind: result.kind, ok: result.ok },
            },
          });
          result.frameCallback = recorded.frameCallback;
          result.hungSurfaceTable = recorded.hungSurfaceTable;
          result.mainSurface = recorded.mainSurface;
          result.timeline = recorded.timeline;
          result.westonMeta = recorded.westonMeta;
        }
      }
      rounds.push({
        i, ok: result.ok, kind: result.kind, keepLogs,
        installSource: result.after?.installSource ?? result.after10?.installSource ?? result.before?.installSource ?? null,
        rafDelta1s: result.before?.rafDelta1s, rafRate: result.before?.rafRate,
        afterRafDelta1s: result.after10?.rafDelta1s ?? result.after?.rafDelta1s ?? null,
        afterRafRate: result.after10?.rafRate ?? result.after?.rafRate ?? null,
        visibility: result.before?.visibility, hasFocus: result.before?.hasFocus, box: result.before?.box,
        probe: result.probe ?? null,
        frameCallback: result.frameCallback ?? null,
        hungSurfaceTable: result.hungSurfaceTable ?? null,
        mainSurface: result.mainSurface ?? null,
        timeline: result.timeline ?? null,
        westonMeta: result.westonMeta ?? null,
        error: result.error?.message ?? result.before?.error?.message ?? null,
      });
    } catch (error) {
      await dumpWaylandDiag(launched.page, `${label}-setup`, error, { kind: 'setup-failed', group: diagGroup }).catch(() => {});
      if (waylandFrameDiag) {
        await recordFailureLogs({
          label, clientLog, westonStart, westonRoundLog, dumpLabel: `${label}-setup`,
          extra: { flushClientLog: launched.flushClientLog },
        }).catch(() => {});
      }
      rounds.push({ i, ok: false, kind: 'setup-failed', error: error.message });
    } finally {
      await launched.app.close().catch(() => {});
      await fs.rm(launched.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      if (rounds.at(-1)?.ok && !rounds.at(-1)?.keepLogs && clientLog && westonRoundLog) {
        await fs.rm(clientLog, { force: true });
        await fs.rm(`${clientLog}.live`, { force: true });
        await fs.rm(westonRoundLog, { force: true });
        await fs.rm(westonRoundLog.replace(/\.log$/, '-pre.log'), { force: true });
        await fs.rm(westonRoundLog.replace(/\.log$/, '-core.log'), { force: true });
        await fs.rm(westonRoundLog.replace(/\.log$/, '-post.log'), { force: true });
      }
    }
    const trulyHung = rounds.filter(round => round.kind === 'truly hung').length;
    if (diagGroup === 'C' && trulyHung >= earlyStopAt) {
      console.log('WAYLAND_FILE_DIAG_EARLY_STOP', JSON.stringify({
        ozone, group: diagGroup, gpu: diagGpu, i, trulyHung, earlyStopAt,
      }));
      break;
    }
  }
  const rates = rounds.map(round => round.rafRate).filter(value => typeof value === 'number');
  const hung = rounds.filter(round => round.kind === 'truly hung');
  const okSamples = rounds.filter(round => round.ok && round.keepLogs);
  const hungNoMainFrame = hung.filter(round => round.timeline && round.timeline.frameCount === 0);
  const okHaveMainFrame = okSamples.filter(round => round.timeline && round.timeline.frameCount > 0);
  let judgment = { code: '本轮没抓到', reason: 'no truly hung this N; do not claim client-stop-frame' };
  if (ozone === 'x11') {
    judgment = {
      code: hung.length ? 'x11-has-truly-hung' : 'x11-0-truly-hung',
      reason: 'X11 contrast uses File-click timeout + rAF stop only; no wl_surface.frame',
    };
  } else if (hung.length) {
    if (hungNoMainFrame.length === hung.length && okSamples.length && okHaveMainFrame.length === okSamples.length) {
      judgment = {
        code: 'client-stop-frame 坐实',
        reason: 'every hung main surface had 0 frames; every kept OK sample had main-surface frames',
      };
    } else if (hungNoMainFrame.length === hung.length && okSamples.length && okHaveMainFrame.length < okSamples.length) {
      judgment = {
        code: '观测缺口',
        reason: 'hung main surfaces had 0 frames but OK samples also often lack main-surface frames',
      };
    } else {
      judgment = {
        code: '观测缺口',
        reason: 'hung vs OK main-surface frame pattern is mixed; not compositor this round',
      };
    }
  }
  console.log('WAYLAND_FILE_DIAG_RELAUNCH_STATS', JSON.stringify({
    ozone,
    waylandFrameDiag,
    group: diagGroup || null,
    gpu: diagGpu,
    gpuLaunchArgs,
    nRequested: n,
    n: rounds.length,
    earlyStop: diagGroup === 'C' && hung.length >= earlyStopAt,
    clickOk: rounds.filter(round => round.ok).length,
    rafStopHung: hung.filter(round => (round.afterRafRate ?? round.rafRate) === 0).length,
    failures: rounds.filter(round => !round.ok).length,
    notClickedWithin10s: rounds.filter(round => round.kind === 'not clicked within 10s').length,
    trulyHung: hung.length,
    setupFailed: rounds.filter(round => round.kind === 'setup-failed').length,
    rafRateMin: rates.length ? Math.min(...rates) : null,
    rafRateMax: rates.length ? Math.max(...rates) : null,
    rafRates: rates,
    visibility: rounds.map(round => round.visibility),
    fails: rounds.filter(round => !round.ok),
    okSamples: okSamples.map(round => ({
      i: round.i, mainSurface: waylandFrameDiag ? round.mainSurface : null,
      frameCount: waylandFrameDiag ? (round.timeline?.frameCount ?? null) : null,
      firstFrameAfterCreateMs: waylandFrameDiag ? (round.timeline?.firstFrameAfterCreateMs ?? null) : null,
      rafRate: round.rafRate, afterRafRate: round.afterRafRate,
      rafDelta1s: round.rafDelta1s, afterRafDelta1s: round.afterRafDelta1s,
      visibility: round.visibility, hasFocus: round.hasFocus,
    })),
    hungTimelines: hung.map(round => ({
      i: round.i, mainSurface: waylandFrameDiag ? round.mainSurface : null,
      frameCount: waylandFrameDiag ? (round.timeline?.frameCount ?? null) : null,
      firstFrameT: waylandFrameDiag ? (round.timeline?.firstFrameT ?? null) : null,
      lastFrameT: waylandFrameDiag ? (round.timeline?.lastFrameT ?? null) : null,
      firstFrameAfterCreateMs: waylandFrameDiag ? (round.timeline?.firstFrameAfterCreateMs ?? null) : null,
      rafRate: round.rafRate, afterRafRate: round.afterRafRate,
      rafDelta1s: round.rafDelta1s, afterRafDelta1s: round.afterRafDelta1s,
      visibility: round.visibility, hasFocus: round.hasFocus, box: round.box,
      postProtocolBytes: waylandFrameDiag ? (round.westonMeta?.postProtocolBytes ?? null) : null,
    })),
    judgment,
    frameCallbacks: rounds.filter(round => !round.ok).map(round => ({
      i: round.i, kind: round.kind, frameCallback: round.frameCallback, hungSurfaceTable: round.hungSurfaceTable,
    })),
  }));
  return rounds;
};
if (process.env.PILOTDECK_WAYLAND_DIAG_RELAUNCH_ONLY === '1') {
  try {
    await runRelaunchFileLoop(Number(process.env.PILOTDECK_WAYLAND_DIAG_N || 100));
  } catch (relaunchError) {
    console.log('WAYLAND_FILE_DIAG_RELAUNCH_ERROR', JSON.stringify({ message: relaunchError.message }));
  }
} else {
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pilotdeck-chrome-'));
const app = await electron.launch({
  executablePath: createRequire(import.meta.url)(path.join(root, 'apps/desktop/node_modules/electron')),
  args: electronLaunchArgs,
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE')),
    PILOTDECK_CHROME_PROFILE: profile,
    PILOTDECK_WAYLAND_DIAG: '1',
  },
});
app.process().on('exit', (code, signal) => { if (code) console.error('Electron exited', { code, signal }); });
let mainError;
try {
  const page = await app.firstWindow();
  await page.addInitScript(installWaylandDiag, 'page.evaluate');
  await page.evaluate(installWaylandDiag, 'page.evaluate');
  const projects = [
    { name: 'general', displayName: 'General conversation', kind: 'general', fullPath: '/fixture/general', sessions: [], capabilities: { files: false } },
    { name: 'demo', displayName: 'Desktop design review', kind: 'workspace', fullPath: '/fixture/demo', sessions: [{ id: 'chrome-review', title: 'Native title review', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], capabilities: { files: true } },
  ];
  let completedOnboarding = true;
  const missing = new Set();
  await attachChromeFixtureRoutes(page, { projects, completedOnboarding: () => completedOnboarding, missing });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5187');
  await page.evaluate(installWaylandDiag, 'page.evaluate');
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 60000 });
  await expect.poll(() => app.evaluate(() => global.chromeTest.state().ready)).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-desktop-platform', process.platform);
  if (mac) await expect(page.locator('html')).toHaveAttribute('data-desktop-integrated', '');
  const geometry = await page.locator('.app-shell').evaluate(el => ({
    x: el.getBoundingClientRect().x, border: getComputedStyle(el).borderTopWidth,
    radius: getComputedStyle(el).borderTopLeftRadius,
  }));
  if (mac) expect(geometry).toEqual({ x: 0, border: '0px', radius: '0px' });
  else {
    expect(geometry.x).toBeCloseTo(6);
    expect(parseFloat(geometry.border)).toBeGreaterThan(0);
    expect(geometry.radius).toBe('14px');
  }
  const headerGeometry = () => page.locator('.workspace-header').evaluate(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom }));
  const mainHeader = await headerGeometry();
  if (mac) {
    expect(mainHeader).toEqual({ top: 0, bottom: 52 });
    await expect(page.locator('html')).toHaveAttribute('data-desktop-toolbar', '');
    await expect(page.locator('#pilotdeck-window-caption')).toHaveCSS('width', '100px');
    const verifyToolbarHitTargets = async () => {
      const targets = await page.locator('.workspace-header button, .workspace-header input, .compact-brand').evaluateAll(elements =>
        elements.filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height).map(el => {
          const rect = el.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return { label: el.getAttribute('aria-label'), safe: rect.y + rect.height / 2 >= 52 || rect.x >= 100, hit: hit === el || el.contains(hit), region: getComputedStyle(el).webkitAppRegion };
        }));
      for (const target of targets) expect(target, JSON.stringify(target)).toMatchObject({ safe: true, hit: true, region: 'no-drag' });
    };
    for (const width of [76, 119, 120, 172, 173, 174, 200, 220, 360, 220]) {
      const resizer = await page.locator('.sidebar-resizer').boundingBox();
      const currentWidth = await page.locator('.project-sidebar').evaluate(el => el.getBoundingClientRect().width);
      await page.mouse.move(resizer.x + resizer.width / 2, resizer.y + 180);
      await page.mouse.down(); await page.mouse.move(resizer.x + resizer.width / 2 + width - currentWidth, resizer.y + 180); await page.mouse.up();
      await expect.poll(() => page.locator('.project-sidebar').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(width);
      expect(await headerGeometry()).toEqual(mainHeader);
      expect(await page.locator('.sidebar-brand-row, .compact-brand').evaluate(el => el.getBoundingClientRect().bottom)).toBe(110);
      expect(await page.locator('.workspace-title').evaluate(el => el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(100);
      await verifyToolbarHitTargets();
      if (width === 76) await page.screenshot({ path: path.join(artifactDir, 'mac-compact-sidebar.png') });
    }
    await expect(page.locator('#pilotdeck-window-caption')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    // The original compact logo still expands the sidebar below the controls.
    const resizer = await page.locator('.sidebar-resizer').boundingBox();
    await page.mouse.move(resizer.x, resizer.y + 180); await page.mouse.down();
    await page.mouse.move(resizer.x - 144, resizer.y + 180); await page.mouse.up();
    await page.locator('.compact-brand').click();
    await expect(page.locator('.project-sidebar')).not.toHaveClass(/compact/);
    for (const factor of [0.8, 1.1, 1]) {
      await app.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), factor);
      await expect.poll(() => page.locator('.workspace-header').evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(52);
      await verifyToolbarHitTargets();
    }
    console.log('PASS: toolbar actions remain unobscured at 80%, 110% and 100% zoom');
    console.log('PASS: Mac header alignment remains stable at 10 sidebar widths');
  }
  const verifyOriginalContentStyle = async () => {
    const styles = await page.evaluate(() => {
      const root = document.documentElement;
      const platform = root.dataset.desktopPlatform;
      const read = () => ['.app-root', '.app-shell', '.project-sidebar', '.workspace-header', '.sidebar-brand-row'].map(selector => {
        const style = getComputedStyle(document.querySelector(selector));
        return [selector, style.backgroundImage, style.backgroundColor, style.borderTopWidth, style.borderRightWidth,
          style.borderColor, style.borderRadius, style.boxShadow, style.gridTemplateColumns, style.paddingLeft, style.paddingRight];
      });
      const desktop = read();
      delete root.dataset.desktopPlatform;
      const original = read();
      root.dataset.desktopPlatform = platform;
      return { desktop, original };
    });
    expect(styles.desktop).toEqual(styles.original);
  };
  if (!mac) await verifyOriginalContentStyle();
  if (!mac) {
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible())).toBe(false);
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(true);
    const caption = page.locator('#pilotdeck-window-caption');
    await expect(caption.locator('button')).toHaveCount(5);
    await expect(caption).toHaveCSS('background-color', 'rgb(23, 23, 23)');
    await expect(page.locator('.project-sidebar')).toHaveCSS('background-color', 'rgb(10, 10, 10)');
    const beforeMainClick = await snapshotWaylandDiag(page);
    console.log('WAYLAND_FILE_DIAG_MAIN_CLICK', JSON.stringify({
      rafDelta1s: beforeMainClick?.rafDelta1s, rafRate: beforeMainClick?.rafRate,
      rafWindowMs: beforeMainClick?.rafWindowMs, rafCount: beforeMainClick?.rafCount,
      visibility: beforeMainClick?.visibility, hasFocus: beforeMainClick?.hasFocus, box: beforeMainClick?.box,
    }));
    // original first File click (desktop-chrome.smoke.mjs:161)
    await clickFileOrDump(page, caption.getByRole('button', { name: 'File', exact: true }), 'main-161');
    const livePrefs = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const contents = win.webContents;
      return {
        backgroundThrottling: contents.backgroundThrottling,
        lastWebPreferences: typeof contents.getLastWebPreferences === 'function' ? contents.getLastWebPreferences() : null,
      };
    });
    console.log('WAYLAND_FILE_DIAG_ENV', JSON.stringify({
      electronLaunchArgs,
      ozone: process.env.PILOTDECK_CHROME_OZONE || null,
      waylandDisplay: process.env.WAYLAND_DISPLAY || null,
      westonLaunch: 'weston --backend=headless-backend.so --socket=$WAYLAND_DISPLAY --no-config --idle-time=0 --width=1440 --height=900',
      fixtureWindow: {
        file: 'apps/desktop/scripts/fixtures/desktop-chrome.cjs:101',
        webPreferencesFile: 'apps/desktop/scripts/fixtures/desktop-chrome.cjs:103',
        preload: process.env.PILOTDECK_WAYLAND_DIAG === '1'
          ? 'apps/desktop/scripts/fixtures/desktop-chrome-preload.cjs'
          : 'apps/desktop/dist/preload.js',
        webPreferences: {
          contextIsolation: true,
          sandbox: false,
          nodeIntegration: false,
          backgroundThrottling: 'unset (Electron default true)',
        },
        live: livePrefs,
      },
      productWindow: {
        file: 'apps/desktop/src/main.ts:525',
        webPreferencesFile: 'apps/desktop/src/main.ts:536',
        webPreferences: {
          preload: 'apps/desktop/dist/preload.js',
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          backgroundThrottling: 'unset (Electron default true)',
        },
      },
    }));
    await expect.poll(() => app.evaluate(() => global.chromeTest.menuRequests().at(-1)?.id)).toBe('menu-file');
    const linuxPopup = page.locator('#pilotdeck-linux-popup');
    if (process.platform === 'linux') {
      await expect(linuxPopup).toBeVisible();
      await expect(linuxPopup.locator('.panel')).toHaveCSS('background-color', 'rgb(37, 37, 37)');
      await expect(linuxPopup.locator('[data-action="new-project"]')).toContainText('New Project');
      await page.screenshot({ path: path.join(artifactDir, `${platformName}-dark-popup.png`) });
      for (const [key, selector, label] of [
        ['f', '[data-action="new-project"]', 'New Project'],
        ['e', '[data-index="0"]', 'Undo'],
        ['v', '[data-action="toggle-sidebar"]', 'Show Sidebar'],
        ['g', '[data-action="chat"]', 'Conversation'],
        ['h', '[data-action="help-docs"]', 'Documentation'],
      ]) {
        await page.keyboard.press('Escape');
        await page.keyboard.press(`Alt+${key}`);
        await expect(linuxPopup).toBeVisible();
        await expect(linuxPopup.locator('.panel')).toHaveCSS('background-color', 'rgb(37, 37, 37)');
        await expect(linuxPopup.locator(selector)).toContainText(label);
        expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible())).toBe(false);
      }
    }
    await caption.getByRole('button', { name: 'Edit', exact: true }).hover();
    await expect(caption.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute('aria-expanded', 'true');
    if (process.platform === 'linux') await expect(linuxPopup.locator('.entry')).toContainText(['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Select All', 'Find…']);
    await caption.getByRole('button', { name: 'View', exact: true }).click();
    await expect(caption.getByRole('button', { name: 'View', exact: true })).toHaveAttribute('aria-expanded', 'true');
    // Product state can rebuild the application menu while its popup is open.
    await app.evaluate(() => global.chromeTest.refreshMenu());
    if (process.platform === 'linux') {
      await expect(linuxPopup.locator('[data-action="toggle-sidebar"]')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(linuxPopup).toBeHidden();
    } else await app.evaluate(() => global.chromeTest.closeMenu());
    await expect(caption.getByRole('button', { name: 'File', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('F10');
    await expect.poll(() => app.evaluate(() => global.chromeTest.menuRequests().at(-1)?.id)).toBe(process.platform === 'linux' ? 'menu-file' : 'all');
    if (process.platform === 'linux') {
      await expect(linuxPopup.locator('.entry:not(:disabled)').first()).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(linuxPopup.locator('.panel')).toHaveAttribute('aria-label', 'Edit');
      await page.keyboard.press('Escape');
      await caption.getByRole('button', { name: 'View', exact: true }).click();
      await linuxPopup.getByRole('menuitem', { name: 'Zoom In' }).click();
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel())).toBe(1);
      await caption.getByRole('button', { name: 'View', exact: true }).click();
      await linuxPopup.getByRole('menuitem', { name: 'Actual Size' }).click();
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel())).toBe(0);
    } else await app.evaluate(() => global.chromeTest.closeMenu());
  }
  const command = async id => {
    await expect.poll(() => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id)?.enabled, id)).toBe(true);
    await app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), id);
  };
  if (!mac) {
    const caption = page.locator('#pilotdeck-window-caption');
    await expect(caption).toHaveCSS('height', '32px');
    await command('help-about');
    const firstAbout = await app.evaluate(() => global.chromeTest.about().dialogs.at(-1));
    expect(firstAbout.detail).toContain('AGPL-3.0-only');
    expect(firstAbout.detail).toContain('2026.930.0-test');
    expect(firstAbout.detail).toContain('abc123fixtur');
    await app.evaluate(() => { global.aboutResponse = 1; });
    await command('help-about');
    await expect.poll(() => app.evaluate(() => global.chromeTest.about().copiedVersion)).toContain('Commit: abc123fixture');
    await app.evaluate(() => { global.aboutResponse = 2; });
    await command('help-about');
    await expect.poll(() => app.evaluate(() => global.chromeTest.about().openedWebsite)).toBe('https://github.com/OpenBMB/PilotDeck');
    console.log('PASS: compact caption and rich About dialog, version copy and project link');
  }
  if (process.env.PILOTDECK_CHROME_MANUAL === '1') {
    await page.evaluate(() => window.pilotdeckDesktop.setAppearance({ language: 'zh-CN', themeMode: 'light' }));
    await page.reload();
    await page.goto('http://127.0.0.1:5187/p/demo/c/chrome-review');
    await expect(page.locator('.workspace-header h1')).toHaveAttribute('data-desktop-no-drag', '');
    console.log('Native review window ready; waiting for manual inspection.');
    await new Promise(resolve => setTimeout(resolve, Number(process.env.PILOTDECK_CHROME_MANUAL_WAIT_MS) || 120000));
    await page.evaluate(() => window.pilotdeckDesktop.setAppearance({ language: 'en', themeMode: 'dark' }));
    await page.reload();
  }
  if (process.platform === 'linux') {
    await clickFileOrDump(page, page.locator('#pilotdeck-window-caption').getByRole('button', { name: 'File', exact: true }), 'new-project-243');
    await page.locator('#pilotdeck-linux-popup').locator('[data-action="new-project"]').click();
  } else await command('new-project');
  await expect(page.locator('.create-workspace-dialog')).toBeVisible();
  await expect.poll(() => app.evaluate(() => global.chromeTest.state().blocked)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.create-workspace-dialog')).toHaveCount(0);
  await expect.poll(() => app.evaluate(() => global.chromeTest.state().blocked)).toBe(false);
  await page.goto('http://127.0.0.1:5187/p/demo/c/chrome-review');
  const title = page.locator('.workspace-header h1');
  await expect(title).toHaveAttribute('data-desktop-no-drag', '');
  // DOM dblclick alone cannot detect Electron's native hit-test interception.
  expect(await title.evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
  expect(await page.locator('.workspace-header').evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('drag');
  await title.dblclick();
  await expect(page.getByRole('textbox', { name: 'Rename Session' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('http://127.0.0.1:5187/p/demo');
  await expect.poll(() => app.evaluate(() => global.chromeTest.state().hasProject)).toBe(true);
  await page.locator('.workspace-actions').getByRole('button', { name: 'Files', exact: true }).click();
  await expect.poll(() => app.evaluate(() => global.chromeTest.state().canFind)).toBe(false);
  expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('find').enabled)).toBe(false);
  await command('chat');
  await page.goto('http://127.0.0.1:5187/p/demo/c/chrome-review');
  await page.locator('.workspace-actions').getByRole('button', { name: 'Search current conversation', exact: true }).click();
  await expect(page.locator('[data-chat-history-search]')).toBeVisible();
  await page.keyboard.press('Escape');
  await command('new-conversation');
  await expect(page).toHaveURL(/\/p\/demo$/);
  await command('toggle-sidebar');
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-hidden/);
  await expect(page.locator('html')).not.toHaveAttribute('data-desktop-integrated');
  if (mac) {
    expect(await headerGeometry()).toEqual(mainHeader);
    expect(await page.locator('.workspace-header > button').first().evaluate(el => el.getBoundingClientRect().left)).toBe(100);
    await page.locator('.workspace-header > button').first().click();
    await expect(page.locator('.project-sidebar')).toBeVisible();
    await command('toggle-sidebar');
  }
  await command('toggle-sidebar');
  if (mac) await expect(page.locator('html')).toHaveAttribute('data-desktop-integrated', '');
  await command('check-updates');
  await expect(page).toHaveURL(/\/settings\/about$/);
  await expect(page.locator('.pilotdeck-settings-app')).toBeVisible();
  await expect.poll(() => app.evaluate(() => global.chromeTest.checks())).toBeGreaterThan(0);
  if (mac) await expect(page.locator('.pilotdeck-settings-app')).toHaveCSS('border-top-left-radius', '0px');
  if (mac) {
    const settingsHeader = await page.locator('.settings-main > .topbar').evaluate(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom }));
    expect(settingsHeader).toEqual(mainHeader);
    await expect(page.getByText('abc123fixtur', { exact: true })).toBeVisible();
    await expect(page.getByText('AGPL-3.0-only', { exact: true })).toBeVisible();
    const logoGeometry = selector => page.locator(selector).evaluate(el => {
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const settingsLogo = await logoGeometry('.sidebar-brand-logo:visible');
    expect(settingsLogo).toEqual({ x: 12, y: 60.5, width: 165, height: 36 });
    await page.goto('http://127.0.0.1:5187/p/demo');
    await expect(page.locator('.sidebar-brand-row')).toBeVisible();
    expect(await logoGeometry('.brand-lockup')).toEqual(settingsLogo);
    await page.goto('http://127.0.0.1:5187/settings/about');
    await expect(page.getByText('AGPL-3.0-only', { exact: true })).toBeVisible();
    console.log('PASS: workspace/settings logos share original 165x36 size and x/y alignment');
  }
  const previousChecks = await app.evaluate(() => global.chromeTest.checks());
  await command('check-updates');
  await expect.poll(() => app.evaluate(() => global.chromeTest.checks())).toBeGreaterThan(previousChecks);
  await page.screenshot({ path: path.join(artifactDir, `${platformName}-settings.png`) });
  await command('chat');
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.goto('http://127.0.0.1:5187/p/demo');
  await expect(page.locator('.workspace-header h1')).toHaveText('Desktop design review');
  const pageIdentity = () => page.evaluate(() => ({
    path: location.pathname,
    title: document.querySelector('.workspace-header h1')?.textContent?.trim(),
    hasShell: Boolean(document.querySelector('.app-shell')),
    hasSidebar: Boolean(document.querySelector('.project-sidebar')),
  }));
  const darkPageIdentity = await pageIdentity();
  await page.screenshot({ path: path.join(artifactDir, `${platformName}-dark.png`) });
  await page.evaluate(() => window.pilotdeckDesktop.setAppearance({ language: 'en', themeMode: 'light' }));
  await expect(page.locator('html')).not.toHaveAttribute('data-desktop-dark');
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(false);
  // ThemeContext consumes the persisted desktop appearance on reload.
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(page.locator('.workspace-header h1')).toHaveText('Desktop design review');
  expect(await pageIdentity()).toEqual(darkPageIdentity);
  await page.screenshot({ path: path.join(artifactDir, `${platformName}-light.png`) });
  if (!mac) {
    await expect(page.locator('#pilotdeck-window-caption')).toHaveCSS('background-color', 'rgb(244, 244, 245)');
    await verifyOriginalContentStyle();
    await expect(page.locator('.project-sidebar')).toHaveCSS('background-image', 'linear-gradient(rgb(251, 250, 255), rgb(244, 243, 255) 58%, rgb(240, 244, 255))');
    if (process.platform === 'linux') {
      const popup = page.locator('#pilotdeck-linux-popup');
      const caption = page.locator('#pilotdeck-window-caption');
      await clickFileOrDump(page, caption.getByRole('button', { name: 'File', exact: true }), 'light-339');
      await expect(popup.locator('.panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await page.screenshot({ path: path.join(artifactDir, `${platformName}-light-popup.png`) });
      await page.evaluate(() => window.pilotdeckDesktop.setAppearance({ language: 'en', themeMode: 'dark' }));
      await expect(popup.locator('.panel')).toHaveCSS('background-color', 'rgb(37, 37, 37)');
      await page.evaluate(() => window.pilotdeckDesktop.setAppearance({ language: 'en', themeMode: 'light' }));
      await expect(popup.locator('.panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    }
    // Exercise the actual i18n instance, including persistence across reload.
    await page.evaluate(async () => { const { default: i18n } = await import('/src/i18n/config.js'); await i18n.changeLanguage('zh-CN'); });
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('#pilotdeck-window-caption button')).toHaveText(['文件', '编辑', '查看', '前往', '帮助']);
    await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('menu-file').label)).toBe('文件');
    expect(await app.evaluate(({ Menu }) => [
      Menu.getApplicationMenu().getMenuItemById('new-conversation').label,
      Menu.getApplicationMenu().getMenuItemById('help-docs').label,
    ])).toEqual(['新对话', '使用文档']);
    if (process.platform === 'linux') {
      const popup = page.locator('#pilotdeck-linux-popup');
      for (const [id, selector, label] of [
        ['menu-file', '[data-action="new-project"]', '新建项目'],
        ['menu-edit', '[data-index="0"]', '撤销'],
        ['menu-view', '[data-action="toggle-sidebar"]', '显示侧栏'],
        ['menu-go', '[data-action="chat"]', '对话'],
        ['menu-help', '[data-action="help-docs"]', '使用文档'],
      ]) {
        await page.keyboard.press('Escape');
        if (id === 'menu-file') await clickFileOrDump(page, page.locator(`#pilotdeck-window-caption button[data-menu="${id}"]`), `zh-${id}`);
        else await page.locator(`#pilotdeck-window-caption button[data-menu="${id}"]`).click();
        await expect(popup.locator('.panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await expect(popup.locator(selector)).toContainText(label);
      }
      await page.screenshot({ path: path.join(artifactDir, `${platformName}-light-zh-popup.png`) });
      await page.keyboard.press('Escape');
      await expect(popup).toBeHidden();
    }
    await page.reload();
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('#pilotdeck-window-caption button')).toHaveText(['文件', '编辑', '查看', '前往', '帮助']);
    await page.screenshot({ path: path.join(artifactDir, `${platformName}-light-zh.png`) });
    await page.evaluate(async () => { const { default: i18n } = await import('/src/i18n/config.js'); await i18n.changeLanguage('en'); });
    await expect(page.locator('#pilotdeck-window-caption button')).toHaveText(['File', 'Edit', 'View', 'Go', 'Help']);
    await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('menu-file').label)).toBe('&File');
    expect(await app.evaluate(({ Menu }) => [
      Menu.getApplicationMenu().getMenuItemById('new-conversation').label,
      Menu.getApplicationMenu().getMenuItemById('help-docs').label,
    ])).toEqual(['New Conversation', 'Documentation']);
    const safeArea = await page.locator('#pilotdeck-window-caption').evaluate(el => ({
      left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: innerWidth,
    }));
    expect(safeArea.left > 80 || safeArea.right < safeArea.width - 80).toBe(true);
    if (process.platform === 'win32') {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
    }
  }
  const simulateFullscreen = process.env.PILOTDECK_CHROME_SIMULATE_FULLSCREEN === '1';
  if (simulateFullscreen) {
    console.log('INFO: fullscreen IPC simulation requested; this run does not validate a native fullscreen transition');
    await app.evaluate(({ BrowserWindow, nativeTheme }) => BrowserWindow.getAllWindows()[0].webContents.send('pilotdeck:window-state', { fullscreen: true, dark: nativeTheme.shouldUseDarkColors }));
  } else {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()), { timeout: 15000 }).toBe(true);
  }
  await expect(page.locator('html')).toHaveAttribute('data-desktop-fullscreen', '');
  await expect(page.locator('#pilotdeck-window-caption')).toBeHidden();
  await expect(page.locator('.app-root')).toHaveCSS('padding-top', mac ? '0px' : '6px');
  if (mac) expect(await headerGeometry()).toEqual({ top: 0, bottom: 52 });
  if (simulateFullscreen) await app.evaluate(({ BrowserWindow, nativeTheme }) => BrowserWindow.getAllWindows()[0].webContents.send('pilotdeck:window-state', { fullscreen: false, dark: nativeTheme.shouldUseDarkColors }));
  else await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(false));
  await expect(page.locator('html')).not.toHaveAttribute('data-desktop-fullscreen');
  if (!mac) await expect(page.locator('.app-root')).toHaveCSS('padding-top', '38px');
  if (mac) expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getWindowButtonPosition())).toEqual({ x: 16, y: 18 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  await expect(page.locator('.app-shell')).toBeVisible();
  completedOnboarding = false;
  await page.reload();
  await expect(page.locator('.desktop-prototype-shell')).toBeVisible();
  if (mac) {
    await expect(page.locator('html')).not.toHaveAttribute('data-desktop-toolbar');
    await expect(page.locator('#pilotdeck-window-caption')).toHaveCSS('width', `${await page.evaluate(() => innerWidth)}px`);
  }
  await expect.poll(() => page.locator('.content-page').evaluate(page =>
    page.getAnimations().some(animation => animation.playState === 'running'))).toBe(false);
  const onboardingGeometry = await page.evaluate(() => {
    const shell = document.querySelector('.desktop-prototype-shell');
    const content = document.querySelector('.setup-content');
    return {
      scrollHeight: document.scrollingElement.scrollHeight,
      viewportHeight: window.innerHeight,
      shellBottom: shell.getBoundingClientRect().bottom,
      shellHeight: shell.getBoundingClientRect().height,
      contentScrollHeight: content.scrollHeight,
      contentClientHeight: content.clientHeight,
    };
  });
  expect(onboardingGeometry.scrollHeight).toBeLessThanOrEqual(onboardingGeometry.viewportHeight + 1);
  expect(onboardingGeometry.shellBottom).toBeLessThanOrEqual(onboardingGeometry.viewportHeight + 1);
  expect(onboardingGeometry.contentScrollHeight).toBeLessThanOrEqual(onboardingGeometry.contentClientHeight + 1);
  if (!mac) {
    expect(onboardingGeometry.shellHeight).toBeLessThan(onboardingGeometry.viewportHeight);
  }
  if (mac) {
    for (const selector of ['.onboarding-frame', '.setup-sidebar', '.setup-content']) {
      expect(await page.locator(selector).evaluate(el => el.getBoundingClientRect().top)).toBe(0);
    }
  }
  await page.screenshot({ path: path.join(artifactDir, `${platformName}-onboarding.png`) });
  await page.setViewportSize({ width: 960, height: 640 });
  const compactOnboardingGeometry = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement.scrollHeight,
    viewportHeight: innerHeight,
    frameBottom: document.querySelector('.onboarding-frame').getBoundingClientRect().bottom,
  }));
  expect(compactOnboardingGeometry.scrollHeight).toBeLessThanOrEqual(compactOnboardingGeometry.viewportHeight + 1);
  expect(compactOnboardingGeometry.frameBottom).toBeLessThanOrEqual(compactOnboardingGeometry.viewportHeight + 1);
  await page.screenshot({ path: path.join(artifactDir, `${platformName}-onboarding-compact.png`) });
  await page.locator('.welcome-action button').click();
  await page.locator('.provider-card.custom-provider').click();
  await page.locator('.content-page').getByRole('button', { name: /continue|继续/i }).click();
  const addModel = page.locator('.add-model-button');
  for (const { width, height, zoom } of [
    { width: 960, height: 740, zoom: 1 },
    { width: 960, height: 640, zoom: 1 },
    { width: 960, height: 640, zoom: 1.1 },
  ]) {
    await page.setViewportSize({ width, height });
    await app.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom);
    await expect(addModel).toBeVisible();
    await addModel.scrollIntoViewIfNeeded();
    await expect(addModel).toBeInViewport();
    const layout = await page.evaluate(() => {
      const frame = document.querySelector('.onboarding-frame').getBoundingClientRect();
      const form = document.querySelector('.connection-form');
      return {
        width: innerWidth,
        viewportHeight: innerHeight,
        documentHeight: document.scrollingElement.scrollHeight,
        frameTop: frame.top,
        frameBottom: frame.bottom,
        formScrollTop: form.scrollTop,
        formScrollable: form.scrollHeight > form.clientHeight,
      };
    });
    expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
    expect(layout.frameTop).toBeGreaterThanOrEqual(-1);
    expect(layout.frameBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
    if (height === 640 && zoom === 1) {
      expect(layout.formScrollable).toBe(true);
      expect(layout.formScrollTop).toBeGreaterThan(0);
    }
    if (zoom > 1) expect(layout.width).toBeLessThanOrEqual(900);
  }
  await addModel.click();
  await expect(page.locator('.model-chip-input')).toBeVisible();
  await page.locator('.model-chip-input').fill('example-model');
  await page.locator('.model-chip-input').press('Enter');
  await expect(page.locator('.selected-model-name', { hasText: 'example-model' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-desktop-platform', process.platform);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, geometry, unmappedFixtureEndpoints: [...missing], artifactDir }));
} catch (error) {
  mainError = error;
} finally {
  await app.close();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
if (mainError) throw mainError;
}
