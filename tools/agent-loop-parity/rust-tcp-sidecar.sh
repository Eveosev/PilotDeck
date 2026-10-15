#!/bin/sh
# Harness TCP spawn injects PILOTDECK_AGENT_LOOP_TCP_HOST/PORT. The Rust binary
# does not read those env vars; it requires `--listen HOST:PORT`. This wrapper
# is the T-P1-05 `--pilotdeck-tcp-sidecar-cmd` for Rust-tcp.
set -eu
bin="${PILOTDECK_RUST_SIDECAR_BIN:-}"
if [ -z "$bin" ]; then
  bin="$(cd "$(dirname "$0")/../.." && pwd)/target/release/pilotdeck-agent-loop"
fi
host="${PILOTDECK_AGENT_LOOP_TCP_HOST:-127.0.0.1}"
port="${PILOTDECK_AGENT_LOOP_TCP_PORT:?PILOTDECK_AGENT_LOOP_TCP_PORT is required}"
exec "$bin" --listen "${host}:${port}"
