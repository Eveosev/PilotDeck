// Page-world installer for Wayland File-click diagnostics. Idempotent.
// source is 'preload' or 'page.evaluate'. The first caller wins.
function installWaylandDiag(source) {
  if (globalThis.__waylandDiag) return;
  const installSource = source === 'preload' || source === 'page.evaluate' ? source : 'unknown';
  const started = Date.now();
  const events = [];
  const bboxes = [];
  const rafMarks = [];
  let rafCount = 0;
  let lastBboxTs = 0;
  const record = (type, extra = {}) => {
    events.push({
      t: Date.now() - started, type, rafCount,
      visibility: document.visibilityState, hasFocus: document.hasFocus(), ...extra,
    });
  };
  const fileBbox = () => {
    const host = document.getElementById('pilotdeck-window-caption');
    const btn = host?.shadowRoot?.querySelector('button[data-menu="menu-file"]');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  };
  const tick = ts => {
    rafCount += 1;
    const t = Date.now() - started;
    rafMarks.push({ t, rafCount });
    while (rafMarks.length && t - rafMarks[0].t > 2000) rafMarks.shift();
    if (ts - lastBboxTs >= 50) {
      lastBboxTs = ts;
      bboxes.push({
        t, rafCount,
        visibility: document.visibilityState, hasFocus: document.hasFocus(), box: fileBbox(),
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  record('install', { installSource });
  document.addEventListener('visibilitychange', () => record('visibilitychange'));
  window.addEventListener('focus', () => record('focus'));
  window.addEventListener('blur', () => record('blur'));
  const rafWindow = (ms = 1000) => {
    const t = Date.now() - started;
    const from = t - ms;
    let mark = rafMarks[0] || { t: 0, rafCount: 0 };
    for (const sample of rafMarks) {
      if (sample.t <= from) mark = sample;
      else break;
    }
    const rafDelta1s = rafCount - mark.rafCount;
    const rafWindowMs = Math.max(1, t - mark.t);
    return {
      rafCount,
      rafDelta1s,
      rafRate: rafDelta1s / (rafWindowMs / 1000),
      rafWindowMs,
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
      box: fileBbox(),
    };
  };
  const mark = type => record(type);
  globalThis.__waylandDiag = {
    installSource,
    mark,
    snapshot: () => ({
      installSource,
      ...rafWindow(1000),
      events: events.slice(),
      bboxes: bboxes.slice(),
    }),
    rafWindow,
  };
}

module.exports = { installWaylandDiag };
