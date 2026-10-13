// Acceptance C File-click relaunch gate. Round5 semantics from PR #14 tip 7f880251:
// RELAUNCH_ONLY, truly hung = click timeout + rAF stop; Wayland main-surface frame
// via 1320×900; never claim X11 has wl_surface.frame. Official chrome smoke is unchanged.
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
    if ((diagGroup === 'C' || process.env.PILOTDECK_WAYLAND_DIAG_GATE === '1') && trulyHung >= earlyStopAt) {
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
    earlyStop: (diagGroup === 'C' || process.env.PILOTDECK_WAYLAND_DIAG_GATE === '1') && hung.length >= earlyStopAt,
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

const { evaluateFileClickGate } = await import(
  path.join(root, 'apps/desktop/scripts/file-click-gate.mjs'),
);
const nRequested = Number(process.env.PILOTDECK_WAYLAND_DIAG_N || 300);
const earlyStopAt = Number(process.env.PILOTDECK_WAYLAND_DIAG_EARLY_STOP || 1);
try {
  const rounds = await runRelaunchFileLoop(nRequested);
  const hung = rounds.filter(round => round.kind === 'truly hung');
  const verdict = evaluateFileClickGate(rounds, {
    ozone,
    waylandFrameDiag,
    nRequested,
    earlyStop: hung.length >= earlyStopAt && rounds.length < nRequested,
  });
  console.log('WAYLAND_FILE_CLICK_GATE', JSON.stringify(verdict));
  if (!verdict.pass) process.exitCode = 1;
} catch (relaunchError) {
  console.log('WAYLAND_FILE_DIAG_RELAUNCH_ERROR', JSON.stringify({ message: relaunchError.message }));
  console.log('WAYLAND_FILE_CLICK_GATE', JSON.stringify({ pass: false, reasons: [relaunchError.message] }));
  process.exitCode = 1;
}
