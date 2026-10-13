#!/usr/bin/env bash
# Diag-only Electron wrapper: persist stderr (WAYLAND_DEBUG / child GPU) from byte 0
# while leaving Playwright's stderr pipe intact (it waits for Debugger/DevTools lines).
set -euo pipefail
real="${PILOTDECK_ELECTRON_REAL:?PILOTDECK_ELECTRON_REAL is the real Electron binary}"
log="${PILOTDECK_WAYLAND_CLIENT_LOG:?PILOTDECK_WAYLAND_CLIENT_LOG is the live client log}"
mkdir -p "$(dirname "$log")"
{
  printf 'WAYLAND_CLIENT_LOG_OPEN ts=%s real=%s\n' "$(date +%s.%N)" "$real"
} >>"$log"
if command -v stdbuf >/dev/null 2>&1; then
  exec "$real" "$@" 2> >(stdbuf -oL -eL tee -a "$log" >&2)
fi
exec "$real" "$@" 2> >(tee -a "$log" >&2)
