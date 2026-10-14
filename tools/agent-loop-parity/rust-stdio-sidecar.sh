#!/bin/sh
# TS host always appends PILOTDECK_AGENT_LOOP_SIDECAR_PATH as argv[1]
# (AgentLoopDeploymentProfile.ts). The Rust binary rejects unknown args, so
# this wrapper execs the binary and drops extras. Used only by the parity
# harness stdio override (PARITY_STDIO_SIDECAR_COMMAND).
set -eu
bin="${PILOTDECK_RUST_SIDECAR_BIN:-}"
if [ -z "$bin" ]; then
  bin="$(cd "$(dirname "$0")/../.." && pwd)/target/release/pilotdeck-agent-loop"
fi
exec "$bin"
