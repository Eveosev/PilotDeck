#!/usr/bin/env bash
# F-3 scheme 2 (moved in PR-B): regenerate the live sidecar corpus and compare
# it to the committed sample after path-precise masking of unstable ID /
# timestamp fields. Never masks a whole line or a whole message.
#
# PR-B decision: MOVE (do not delete). Test-mode stable IDs
# (`PILOTDECK_AGENT_LOOP_STABLE_IDS=1`) make messageId / streamId /
# moduleInstanceId / connectionGeneration deterministic, but status
# `updatedAt` and F-5 `startedAt`/`completedAt` still vary, so the mask
# script remains the F-3 comparator.
#
# Usage:
#   mask_f3.sh [--committed PATH] [--live PATH]
# Defaults:
#   --committed  evidence/t-p1-01/emitted-messages.json
#   --live       regenerate via cargo test + T_P1_01_EMITTED_OUT
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
COMMITTED="${F3_COMMITTED:-$ROOT/evidence/t-p1-01/emitted-messages.json}"
LIVE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --committed) COMMITTED="$2"; shift 2 ;;
    --live) LIVE="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

if [[ ! -f "$COMMITTED" ]]; then
  echo "committed sample not found: $COMMITTED" >&2
  exit 2
fi

if [[ -z "$LIVE" ]]; then
  LIVE="$tmpdir/live.json"
  echo "regenerating F-3 corpus via cargo test (T_P1_01_EMITTED_OUT)" >&2
  if ! T_P1_01_EMITTED_OUT="$LIVE" PILOTDECK_AGENT_LOOP_STABLE_IDS=1 \
    cargo test -p pilotdeck-agent-loop \
    --manifest-path "$ROOT/Cargo.toml" \
    --test roundtrip rust_emitted_messages_roundtrip_schema_and_ts \
    -- --test-threads=1 >"$tmpdir/cargo-test.log" 2>&1; then
    echo "cargo test failed; last lines:" >&2
    tail -20 "$tmpdir/cargo-test.log" >&2
    exit 1
  fi
fi
if [[ ! -f "$LIVE" ]]; then
  echo "live sample not found: $LIVE" >&2
  exit 2
fi

python3 - "$COMMITTED" "$LIVE" <<'PY'
import json, re, sys, difflib

committed_path, live_path = sys.argv[1], sys.argv[2]

# Path-precise value replacements only. streamId uses the same next_id
# generator as messageId; without it a fresh run cannot match the commit.
MASK_KEYS = {
    "messageId",
    "moduleInstanceId",
    "connectionGeneration",
    "streamId",
    "updatedAt",
    "startedAt",
    "completedAt",
    "createdAt",
}
PLACEHOLDER = "<MASKED>"
ISO_AT = re.compile(r"^\d{4}-\d{2}-\d{2}T")


def load(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    rows = data.get("messages")
    if not isinstance(rows, list):
        raise SystemExit(f"{path}: expected {{messages: [...]}}")
    return data, rows


def field_paths(obj, prefix="$"):
    paths = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            path = f"{prefix}.{key}"
            paths.append(path)
            paths.extend(field_paths(value, path))
    elif isinstance(obj, list):
        for index, value in enumerate(obj):
            paths.extend(field_paths(value, f"{prefix}[{index}]"))
    return paths


def mask(obj):
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            if key in MASK_KEYS:
                out[key] = PLACEHOLDER
            elif (
                isinstance(value, str)
                and key.endswith("At")
                and ISO_AT.match(value)
            ):
                out[key] = PLACEHOLDER
            else:
                out[key] = mask(value)
        return out
    if isinstance(obj, list):
        return [mask(item) for item in obj]
    return obj


def dump(obj):
    return json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def require_f3_shape(label, rows):
    ok = True
    if len(rows) != 19:
        print(f"{label}: expected 19 messages, got {len(rows)}", file=sys.stderr)
        ok = False
    types = [row.get("message", {}).get("eventType") for row in rows]
    if "agent.execute.completed" not in types or "agent.execute.cancelled" not in types:
        print(f"{label}: corpus must include completed and cancelled finals", file=sys.stderr)
        ok = False
    completed = next(
        (
            row.get("message", {})
            for row in rows
            if row.get("message", {}).get("eventType") == "agent.execute.completed"
        ),
        {},
    )
    cancelled = next(
        (
            row.get("message", {})
            for row in rows
            if row.get("message", {}).get("eventType") == "agent.execute.cancelled"
        ),
        {},
    )
    result = completed.get("payload", {}).get("result", {})
    if not result.get("sessionId") or not result.get("turnId"):
        print(f"{label}: completed final must include sessionId/turnId (F-5)", file=sys.stderr)
        ok = False
    aborted = cancelled.get("payload", {}).get("result", {})
    if aborted.get("type") != "aborted":
        print(f"{label}: cancelled final must use type:aborted shape (F-5)", file=sys.stderr)
        ok = False
    return ok


_, committed_rows = load(committed_path)
_, live_rows = load(live_path)
ok = True
ok &= require_f3_shape("committed", committed_rows)
ok &= require_f3_shape("live", live_rows)
if len(committed_rows) != len(live_rows):
    print(f"count mismatch: committed={len(committed_rows)} live={len(live_rows)}", file=sys.stderr)
    ok = False

n = min(len(committed_rows), len(live_rows))
for index in range(n):
    left = sorted(field_paths(committed_rows[index]))
    right = sorted(field_paths(live_rows[index]))
    if left != right:
        print(f"field-set mismatch at messages[{index}]", file=sys.stderr)
        print("  only committed:", [p for p in left if p not in right], file=sys.stderr)
        print("  only live:", [p for p in right if p not in left], file=sys.stderr)
        ok = False

masked_committed = dump(mask({"messages": committed_rows}))
masked_live = dump(mask({"messages": live_rows}))
if masked_committed != masked_live:
    print("masked byte mismatch:", file=sys.stderr)
    sys.stderr.writelines(
        line + "\n"
        for line in difflib.unified_diff(
            masked_committed.splitlines(),
            masked_live.splitlines(),
            fromfile="committed.masked.json",
            tofile="live.masked.json",
            lineterm="",
        )
    )
    ok = False

if not ok:
    sys.exit(1)
print("F-3 mask compare: 19 messages, F-5 shape, field sets match, masked bytes identical")
PY
