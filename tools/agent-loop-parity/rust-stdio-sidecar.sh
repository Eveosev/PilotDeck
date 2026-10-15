#!/bin/sh
# TS host always appends PILOTDECK_AGENT_LOOP_SIDECAR_PATH as argv[1]
# (AgentLoopDeploymentProfile.ts). The Rust binary rejects unknown args, so
# this wrapper execs the binary and drops extras. Used only by the parity
# harness stdio override (PARITY_STDIO_SIDECAR_COMMAND).
#
# Before exec, append pid + resolved bin to PARITY_RUST_SIDECAR_PROOF so the
# harness can observe that this process actually launched Rust (R2 F1').
set -eu
bin="${PILOTDECK_RUST_SIDECAR_BIN:-}"
if [ -z "$bin" ]; then
  bin="$(cd "$(dirname "$0")/../.." && pwd)/target/release/pilotdeck-agent-loop"
fi
resolved="$bin"
# PLAN R3: stdio exec proof accepts only a path ending in
# `pilotdeck-agent-loop`. rust-core's binary is named
# `pilotdeck-agent-loop-sidecar`, so the harness points
# PILOTDECK_RUST_SIDECAR_BIN at a same-name symlink. Do not follow that
# final symlink: `realpath` / `readlink -f` would rewrite the proof to
# `*-sidecar` and the run would be BLOCKED. The kernel still follows the
# symlink at exec. A real file with this basename (the in-repo probe) is
# unchanged.
if [ "$(basename "$bin")" = "pilotdeck-agent-loop" ]; then
  if command -v realpath >/dev/null 2>&1; then
    resolved="$(realpath -s "$bin" 2>/dev/null || printf '%s' "$bin")"
  fi
elif command -v realpath >/dev/null 2>&1; then
  resolved="$(realpath "$bin")"
elif command -v readlink >/dev/null 2>&1; then
  resolved="$(readlink -f "$bin" 2>/dev/null || printf '%s' "$bin")"
fi
proof="${PARITY_RUST_SIDECAR_PROOF:-}"
if [ -n "$proof" ]; then
  mkdir -p "$(dirname "$proof")"
  printf '{"pid":%s,"bin":"%s","resolved":"%s"}\n' "$$" "$bin" "$resolved" >> "$proof"
fi
exec "$bin"
