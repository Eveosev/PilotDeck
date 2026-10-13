import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateFileClickGate } from './file-click-gate.mjs';

const ok = (i, extra = {}) => ({
  i, ok: true, kind: null, keepLogs: i <= 3, rafDelta1s: 28, rafRate: 30,
  afterRafDelta1s: 29, afterRafRate: 30, timeline: { frameCount: 70 }, ...extra,
});

test('Wayland pass requires zero hung, every click OK, rAF delta, and OK frame samples', () => {
  const rounds = [ok(1), ok(2), ok(3)];
  const verdict = evaluateFileClickGate(rounds, { ozone: 'wayland', waylandFrameDiag: true, nRequested: 3 });
  assert.equal(verdict.pass, true);
  assert.deepEqual(verdict.reasons, []);
});

test('early-stop hung is a fail even if later rounds never ran', () => {
  const rounds = [ok(1), { i: 2, ok: false, kind: 'truly hung', rafRate: 0, rafDelta1s: 0 }];
  const verdict = evaluateFileClickGate(rounds, { ozone: 'wayland', waylandFrameDiag: true, nRequested: 300, earlyStop: true });
  assert.equal(verdict.pass, false);
  assert.match(verdict.reasons.join(' '), /trulyHung=1/);
});

test('X11 does not require wl_surface.frame and still fails on a hung round', () => {
  const pass = evaluateFileClickGate(
    Array.from({ length: 3 }, (_, i) => ok(i + 1, { timeline: undefined })),
    { ozone: 'x11', waylandFrameDiag: false, nRequested: 3 },
  );
  assert.equal(pass.pass, true);
  assert.equal(pass.okFrameSamples, null);
  const fail = evaluateFileClickGate(
    [{ i: 1, ok: false, kind: 'truly hung', rafRate: 0 }],
    { ozone: 'x11', waylandFrameDiag: false, nRequested: 100 },
  );
  assert.equal(fail.pass, false);
});

test('OK spot-check accepts hungSurfaceTable.windowFrameCount when timeline dropped unstamped frames', () => {
  const rounds = [1, 2, 3].map(i => ok(i, {
    timeline: { frameCount: 0, firstFrameT: null },
    hungSurfaceTable: { windowFrameCount: 70 + i },
  }));
  const verdict = evaluateFileClickGate(rounds, { ozone: 'wayland', waylandFrameDiag: true, nRequested: 3 });
  assert.equal(verdict.pass, true);
  assert.equal(verdict.okFrameSamples, 3);
});

test('OK clicks with frozen rAF fail the gate', () => {
  const verdict = evaluateFileClickGate(
    [ok(1, { rafDelta1s: 0, rafRate: 0, afterRafDelta1s: 0, afterRafRate: 0 })],
    { ozone: 'wayland', waylandFrameDiag: true, nRequested: 1 },
  );
  assert.equal(verdict.pass, false);
  assert.match(verdict.reasons.join(' '), /rafKeep/);
});
