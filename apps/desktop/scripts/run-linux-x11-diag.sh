#!/usr/bin/env bash
# X11 File-click relaunch regression gate, aligned with run-linux-wayland-diag.sh:
# same relaunch loop / N / early-stop / rAF hung semantics, ozone=x11 + xvfb.
# No weston / no wl_surface.frame capture. Hung = FAIL.
set -euo pipefail
node_binary="${PILOTDECK_CHROME_NODE_BINARY:-node}"
group="${PILOTDECK_WAYLAND_DIAG_GROUP:-C}"
if [[ "$group" != A && "$group" != B && "$group" != C ]]; then
  echo "Unsupported diag group: $group" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"
export PILOTDECK_CHROME_OZONE=x11
export PILOTDECK_CHROME_DISABLE_SANDBOX=1
export PILOTDECK_WAYLAND_DIAG=1
export PILOTDECK_WAYLAND_DIAG_GATE=1
export PILOTDECK_WAYLAND_DIAG_GROUP="$group"
export PILOTDECK_WAYLAND_DIAG_RELAUNCH_ONLY=1
export PILOTDECK_WAYLAND_DIAG_N="${PILOTDECK_WAYLAND_DIAG_N:-100}"
export PILOTDECK_WAYLAND_DIAG_EARLY_STOP="${PILOTDECK_WAYLAND_DIAG_EARLY_STOP:-1}"
export PILOTDECK_WAYLAND_DIAG_GPU="${PILOTDECK_WAYLAND_DIAG_GPU:-default}"
unset WAYLAND_DISPLAY
unset PILOTDECK_WESTON_LOG
gpu="$PILOTDECK_WAYLAND_DIAG_GPU"
if [[ "$gpu" != default && "$gpu" != off && "$gpu" != swiftshader ]]; then
  echo "Unsupported PILOTDECK_WAYLAND_DIAG_GPU: $gpu" >&2
  exit 1
fi
export PILOTDECK_CHROME_ARTIFACTS="$repo_root/outputs/desktop-chrome-review/linux-x11-diag-$group"
mkdir -p "$PILOTDECK_CHROME_ARTIFACTS"
if ! "$node_binary" -e "require('./apps/desktop/node_modules/electron')" >/dev/null 2>&1; then
  "$node_binary" apps/desktop/node_modules/electron/install.js
fi
if [[ ! -f apps/desktop/dist/preload.js || ! -f apps/desktop/dist/waylandWindow.js ]]; then
  (cd apps/desktop && exec "$node_binary" node_modules/typescript/bin/tsc -p tsconfig.json)
fi

(cd ui && exec "$node_binary" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5187 --strictPort) \
  >"${TMPDIR:-/tmp}/pilotdeck-chrome-vite-x11-diag-$group.log" 2>&1 &
vite_pid=$!
cleanup() {
  kill "$vite_pid" 2>/dev/null || true
  wait "$vite_pid" 2>/dev/null || true
}
trap cleanup EXIT

for ((attempt = 0; attempt < 200; attempt++)); do
  if curl --silent --fail http://127.0.0.1:5187/ >/dev/null; then break; fi
  if ! kill -0 "$vite_pid" 2>/dev/null; then
    cat "${TMPDIR:-/tmp}/pilotdeck-chrome-vite-x11-diag-$group.log" >&2
    exit 1
  fi
  sleep 0.1
done
curl --silent --fail http://127.0.0.1:5187/ >/dev/null

{
  echo "X11_LAUNCH ozone=x11 xvfb='-screen 0 1440x900x24' group=$group gpu=$gpu"
  echo "N=${PILOTDECK_WAYLAND_DIAG_N} early_stop=${PILOTDECK_WAYLAND_DIAG_EARLY_STOP} WAYLAND_DISPLAY=unset gate=1"
} | tee "$PILOTDECK_CHROME_ARTIFACTS/x11-launch.txt"

dbus-run-session -- xvfb-run -a -s '-screen 0 1440x900x24' \
  "$node_binary" ui/e2e/desktop-chrome.relaunch-gate.mjs
