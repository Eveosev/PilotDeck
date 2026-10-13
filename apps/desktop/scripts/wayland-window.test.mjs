import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(name) {
  const source = fs.readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', compiled)(mod, mod.exports, id => id.startsWith('./') ? load(id.slice(2)) : require(id));
  return mod.exports;
}

const { isLinuxWaylandSession, linuxOzonePlatform, presentLinuxWaylandWindow, scheduleLinuxWaylandPresent } = load('waylandWindow');

function fakeWindow({ destroyed = false, minimized = false, visible = false, focused = false, paintAfter = 1 } = {}) {
  let shows = 0;
  const window = {
    shows: 0,
    focuses: 0,
    restores: 0,
    invalidates: 0,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    isVisible: () => visible,
    isFocused: () => focused,
    restore() { minimized = false; this.restores += 1; },
    show() {
      shows += 1;
      this.shows = shows;
      if (shows >= paintAfter) visible = true;
    },
    focus() {
      this.focuses += 1;
      if (visible) focused = true;
    },
    webContents: { invalidate: () => { window.invalidates += 1; } },
  };
  return window;
}

test('Linux Wayland is ozone=wayland or WAYLAND_DISPLAY; ozone=x11 wins', () => {
  assert.equal(isLinuxWaylandSession('darwin', { WAYLAND_DISPLAY: 'wayland-0' }, []), false);
  assert.equal(isLinuxWaylandSession('win32', { WAYLAND_DISPLAY: 'wayland-0' }, []), false);
  assert.equal(isLinuxWaylandSession('linux', {}, []), false);
  assert.equal(isLinuxWaylandSession('linux', { WAYLAND_DISPLAY: 'wayland-pilotdeck-chrome' }, []), true);
  assert.equal(isLinuxWaylandSession('linux', { PILOTDECK_CHROME_OZONE: 'wayland' }, []), true);
  assert.equal(isLinuxWaylandSession('linux', {}, ['--ozone-platform=wayland']), true);
  assert.equal(isLinuxWaylandSession('linux', { WAYLAND_DISPLAY: 'wayland-0', PILOTDECK_CHROME_OZONE: 'x11' }, []), false);
  assert.equal(isLinuxWaylandSession('linux', { WAYLAND_DISPLAY: 'wayland-0' }, ['--ozone-platform=x11']), false);
  assert.equal(linuxOzonePlatform({ PILOTDECK_CHROME_OZONE: 'x11' }, ['--ozone-platform=wayland']), 'x11');
});

test('present maps a hidden Wayland window with show+focus and schedules a frame', () => {
  const window = fakeWindow();
  assert.equal(presentLinuxWaylandWindow(window), true);
  assert.equal(window.shows, 1);
  assert.equal(window.focuses, 1);
  assert.equal(window.invalidates, 1);
  assert.equal(window.isVisible(), true);
  assert.equal(window.isFocused(), true);
});

test('present reports unmapped when the first show does not map the toplevel', () => {
  const window = fakeWindow({ paintAfter: 2 });
  assert.equal(presentLinuxWaylandWindow(window), false);
  assert.equal(window.shows, 1);
  assert.equal(window.isVisible(), false);
});

test('present restores a minimized window and skips a destroyed one', () => {
  const minimized = fakeWindow({ minimized: true });
  assert.equal(presentLinuxWaylandWindow(minimized), true);
  assert.equal(minimized.restores, 1);
  const destroyed = fakeWindow({ destroyed: true });
  assert.equal(presentLinuxWaylandWindow(destroyed), false);
  assert.equal(destroyed.shows, 0);
});

test('schedule presents now and remaps on the later tick if still hidden', () => {
  const hidden = fakeWindow({ paintAfter: 2 });
  const deferred = [];
  scheduleLinuxWaylandPresent(hidden, fn => deferred.push(fn));
  assert.equal(hidden.shows, 1);
  assert.equal(hidden.isVisible(), false);
  deferred[0]();
  assert.equal(hidden.shows, 2);
  assert.equal(hidden.isVisible(), true);
  assert.equal(hidden.isFocused(), true);

  const mapped = fakeWindow();
  const later = [];
  scheduleLinuxWaylandPresent(mapped, fn => later.push(fn));
  later[0]();
  assert.equal(mapped.shows, 1);
  assert.equal(mapped.invalidates, 2);
});
