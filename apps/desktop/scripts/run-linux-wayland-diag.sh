#!/usr/bin/env bash
# Wayland-only File-click relaunch diag. Group A/B/C comes from the environment.
set -euo pipefail
node_binary="${PILOTDECK_CHROME_NODE_BINARY:-node}"
group="${PILOTDECK_WAYLAND_DIAG_GROUP:?Set PILOTDECK_WAYLAND_DIAG_GROUP to A, B, or C}"
if [[ "$group" != A && "$group" != B && "$group" != C ]]; then
  echo "Unsupported diag group: $group" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"
export PILOTDECK_CHROME_OZONE=wayland
export PILOTDECK_CHROME_DISABLE_SANDBOX=1
export PILOTDECK_WAYLAND_DIAG=1
export PILOTDECK_WAYLAND_DIAG_RELAUNCH_ONLY=1
export PILOTDECK_WAYLAND_DIAG_N="${PILOTDECK_WAYLAND_DIAG_N:-100}"
export PILOTDECK_WAYLAND_DIAG_EARLY_STOP="${PILOTDECK_WAYLAND_DIAG_EARLY_STOP:-3}"
export PILOTDECK_CHROME_ARTIFACTS="$repo_root/outputs/desktop-chrome-review/linux-wayland-diag-$group"
mkdir -p "$PILOTDECK_CHROME_ARTIFACTS"
if ! "$node_binary" -e "require('./apps/desktop/node_modules/electron')" >/dev/null 2>&1; then
  "$node_binary" apps/desktop/node_modules/electron/install.js
fi
if [[ ! -f apps/desktop/dist/preload.js ]]; then
  (cd apps/desktop && exec "$node_binary" node_modules/typescript/bin/tsc -p tsconfig.json)
fi

(cd ui && exec "$node_binary" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5187 --strictPort) \
  >"${TMPDIR:-/tmp}/pilotdeck-chrome-vite-wayland-diag-$group.log" 2>&1 &
vite_pid=$!
runtime_dir=""
weston_pid=""
cleanup() {
  if [[ -n "$weston_pid" ]]; then
    kill "$weston_pid" 2>/dev/null || true
    wait "$weston_pid" 2>/dev/null || true
  fi
  kill "$vite_pid" 2>/dev/null || true
  wait "$vite_pid" 2>/dev/null || true
  if [[ -n "$runtime_dir" ]]; then rm -rf -- "$runtime_dir"; fi
}
trap cleanup EXIT

for ((attempt = 0; attempt < 200; attempt++)); do
  if curl --silent --fail http://127.0.0.1:5187/ >/dev/null; then break; fi
  if ! kill -0 "$vite_pid" 2>/dev/null; then
    cat "${TMPDIR:-/tmp}/pilotdeck-chrome-vite-wayland-diag-$group.log" >&2
    exit 1
  fi
  sleep 0.1
done
curl --silent --fail http://127.0.0.1:5187/ >/dev/null

runtime_dir="$(mktemp -d)"
chmod 700 "$runtime_dir"
export XDG_RUNTIME_DIR="$runtime_dir"
export WAYLAND_DISPLAY=wayland-pilotdeck-chrome
unset DISPLAY
export PILOTDECK_WESTON_LOG="$PILOTDECK_CHROME_ARTIFACTS/weston-live.log"
weston_cmd=(weston --backend=headless-backend.so --socket="$WAYLAND_DISPLAY" --no-config --idle-time=0 --width=1440 --height=900)
weston_debug=0
if weston --help 2>&1 | grep -q -- '--debug'; then
  weston_cmd+=(--debug)
  weston_debug=1
fi
if command -v stdbuf >/dev/null 2>&1; then
  weston_cmd=(env WAYLAND_DEBUG=1 stdbuf -oL -eL "${weston_cmd[@]}")
else
  weston_cmd=(env WAYLAND_DEBUG=1 "${weston_cmd[@]}")
fi
{
  echo "WESTON_LAUNCH ${weston_cmd[*]}"
  echo "XDG_RUNTIME_DIR=$runtime_dir DISPLAY=unset group=$group wayland_debug=1 weston_debug=$weston_debug"
} | tee "$PILOTDECK_CHROME_ARTIFACTS/weston-launch.txt"
: >"$PILOTDECK_WESTON_LOG"
"${weston_cmd[@]}" >>"$PILOTDECK_WESTON_LOG" 2>&1 &
weston_pid=$!
for ((attempt = 0; attempt < 100; attempt++)); do
  if [[ -S "$runtime_dir/$WAYLAND_DISPLAY" ]]; then break; fi
  if ! kill -0 "$weston_pid" 2>/dev/null; then
    cat "$PILOTDECK_WESTON_LOG" >&2
    exit 1
  fi
  sleep 0.1
done
test -S "$runtime_dir/$WAYLAND_DISPLAY"

dbus-run-session -- "$node_binary" ui/e2e/desktop-chrome.smoke.mjs
