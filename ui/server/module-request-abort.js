export function bindModuleRequestAbort(req, res) {
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException('Browser request disconnected', 'AbortError'));
  const cleanup = () => {
    req.off('aborted', abort);
    res.off('close', close);
    res.off('finish', cleanup);
  };
  const close = () => {
    if (!res.writableFinished) abort();
    cleanup();
  };
  req.once('aborted', abort);
  res.once('close', close);
  res.once('finish', cleanup);
  if (req.aborted || res.destroyed) abort();
  return controller.signal;
}

export function moduleUpstreamSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
