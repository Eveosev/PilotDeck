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
if command -v realpath >/dev/null 2>&1; then
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
