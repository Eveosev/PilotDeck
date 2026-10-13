/** Acceptance C verdict for the File-click relaunch gate. */

export function okSampleMainFrameCount(round) {
  return Math.max(Number(round.timeline?.frameCount ?? 0), Number(round.hungSurfaceTable?.windowFrameCount ?? 0));
}

export function evaluateFileClickGate(rounds, {
  ozone = null,
  waylandFrameDiag = ozone === 'wayland',
  nRequested = 0,
  earlyStop = false,
} = {}) {
  const hung = rounds.filter(round => round.kind === 'truly hung');
  const clickOk = rounds.filter(round => round.ok);
  const rafKeep = clickOk.filter(round => {
    const before = Number(round.rafDelta1s ?? 0) > 0 || Number(round.rafRate ?? 0) > 0;
    const after = Number(round.afterRafDelta1s ?? 0) > 0 || Number(round.afterRafRate ?? 0) > 0;
    return before || after;
  });
  const okSamples = rounds.filter(round => round.ok && round.keepLogs && round.timeline);
  const okHaveMainFrame = okSamples.filter(round => okSampleMainFrameCount(round) > 0);
  const reasons = [];
  if (hung.length > 0 || earlyStop) reasons.push(`trulyHung=${hung.length} early-stop=${earlyStop}`);
  if (clickOk.length !== rounds.length) reasons.push(`clickOk=${clickOk.length}/${rounds.length}`);
  if (rafKeep.length !== clickOk.length) reasons.push(`rafKeep=${rafKeep.length}/${clickOk.length}`);
  if (waylandFrameDiag && okSamples.length && okHaveMainFrame.length !== okSamples.length) {
    reasons.push(`ok frameCount>0 ${okHaveMainFrame.length}/${okSamples.length}`);
  }
  if (nRequested > 0 && rounds.length < nRequested && !earlyStop) {
    reasons.push(`incomplete n=${rounds.length}<${nRequested}`);
  }
  return {
    pass: reasons.length === 0 && hung.length === 0 && rounds.length > 0,
    ozone,
    waylandFrameDiag,
    n: rounds.length,
    nRequested,
    earlyStop,
    trulyHung: hung.length,
    clickOk: clickOk.length,
    rafKeep: rafKeep.length,
    okFrameSamples: waylandFrameDiag ? okHaveMainFrame.length : null,
    reasons,
  };
}
