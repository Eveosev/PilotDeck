#!/bin/sh
# Parity quick gate: stdio pure_text + single_tool against rust-core.
# Identity follows T-P2-02: PILOTDECK_RUST_SIDECAR_BIN is a symlink whose
# basename is pilotdeck-agent-loop, and rust-stdio-sidecar.sh records the
# exec proof without resolving that final symlink.
#
# Missing default release binary => explicit skip (exit 0).
# PARITY_QUICK_RESULT=skip is not a scenario pass.
# A present binary that cannot run, or either scenario failing, exits non-zero.
# This script never passes --scenario all.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"

default_bin="$root/rust-core/target/release/pilotdeck-agent-loop-sidecar"
explicit=0
if [ -n "${PILOTDECK_RUST_SIDECAR_BIN:-}" ]; then
  explicit=1
  bin=$PILOTDECK_RUST_SIDECAR_BIN
else
  bin=$default_bin
fi

say() {
  printf '%s\n' "$*"
}

if [ ! -e "$bin" ]; then
  if [ "$explicit" -eq 1 ]; then
    say "FAIL parity-quick: PILOTDECK_RUST_SIDECAR_BIN is set but missing: $bin"
    say "PARITY_QUICK_RESULT=fail"
    exit 1
  fi
  say "SKIP parity-quick: rust-core release binary missing at $bin"
  say "Scenarios not executed: pure_text single_tool"
  say "This is an explicit skip, not a scenario pass."
  say "Full 53-scenario gate is not part of this job."
  say "PARITY_QUICK_RESULT=skip"
  exit 0
fi

base=$(basename "$bin")
case "$base" in
  pilotdeck-agent-loop)
    proof=$bin
    ;;
  pilotdeck-agent-loop-sidecar)
    if [ "$bin" != "$default_bin" ]; then
      say "FAIL parity-quick: sidecar binary must be $default_bin so the proof symlink is ../release/pilotdeck-agent-loop-sidecar"
      say "PARITY_QUICK_RESULT=fail"
      exit 1
    fi
    proof_dir="$root/rust-core/target/rust-core-proof"
    mkdir -p "$proof_dir"
    ln -sfn ../release/pilotdeck-agent-loop-sidecar "$proof_dir/pilotdeck-agent-loop"
    proof="$proof_dir/pilotdeck-agent-loop"
    ;;
  *)
    say "FAIL parity-quick: exec-proof basename must be pilotdeck-agent-loop (got $base)"
    say "PARITY_QUICK_RESULT=fail"
    exit 1
    ;;
esac

if [ "$(basename "$proof")" != "pilotdeck-agent-loop" ]; then
  say "FAIL parity-quick: proof path does not end in pilotdeck-agent-loop: $proof"
  say "PARITY_QUICK_RESULT=fail"
  exit 1
fi

export PILOTDECK_RUST_SIDECAR_BIN=$proof
say "PILOTDECK_RUST_SIDECAR_BIN=$PILOTDECK_RUST_SIDECAR_BIN"

if ! command -v python3 >/dev/null 2>&1; then
  say "FAIL parity-quick: python3 missing; binary is present, so this is not a skip"
  say "PARITY_QUICK_RESULT=fail"
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  say "FAIL parity-quick: node missing; binary is present, so this is not a skip"
  say "PARITY_QUICK_RESULT=fail"
  exit 1
fi
if [ ! -f "$root/dist/src/cli/createLocalGateway.js" ]; then
  say "FAIL parity-quick: dist/src/cli/createLocalGateway.js missing (pnpm build). Binary is present, so this is not a skip."
  say "PARITY_QUICK_RESULT=fail"
  exit 1
fi

for scenario in pure_text single_tool; do
  out="/tmp/pilotdeck-parity-quick-$scenario"
  rm -rf "$out"
  say "RUN scenario=$scenario output=$out"
  python3 tools/agent-loop-parity/run.py \
    --pilotdeck-root "$root" \
    --comparison same-version \
    --surface gateway \
    --sidecar-transport stdio \
    --pilotdeck-stdio-sidecar-cmd tools/agent-loop-parity/rust-stdio-sidecar.sh \
    --scenario "$scenario" \
    --output "$out"
  python3 - "$out/summary.json" "$scenario" <<'PY'
import json, sys
path, scenario = sys.argv[1], sys.argv[2]
summary = json.load(open(path, encoding="utf-8"))
blocked = summary.get("blocked") or []
failed = summary.get("failed") or []
oracle = summary.get("oracleFailures") or []
print("scenario", scenario)
print("scenarios", summary.get("scenarios"), "gateScenarioCount", summary.get("gateScenarioCount"))
print("sidecarImplementation", summary.get("sidecarImplementation"))
print("blocked", blocked)
print("failed", failed)
print("oracleFailures", oracle)
if summary.get("scenarios") == 53:
    print("FAIL parity-quick: full 53 ran inside the quick gate")
    sys.exit(1)
ok = (
    summary.get("scenarios") == 1
    and summary.get("sidecarImplementation") == "rust"
    and not blocked
    and not failed
    and not oracle
)
sys.exit(0 if ok else 1)
PY
done

say "PASS parity-quick: pure_text single_tool"
say "PARITY_QUICK_RESULT=pass"
