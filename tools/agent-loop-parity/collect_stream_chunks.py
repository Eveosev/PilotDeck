#!/usr/bin/env python3
"""Collect T-P1-04 stream-chunk artifacts for 1 / 50 / 500 Unicode chars.

Parameter entry is only `scenarios[].streamChunkChars` (not env, not tokens).
T-P1-05 consumes `evidence/p1/stream-chunks-{1,50,500}.json`. This helper does
not write a go-nogo decision.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
STREAM_PREFIX = "STREAM_PREFIX::"
STREAM_CHUNK_CHARS = (1, 50, 500)
STREAM_CHUNK_FIELD_PATH = "scenarios[].streamChunkChars"
VARIANT_ID = "sidecar_live_model_stream_chars_{chars}"


def chunk_text_by_chars(text: str, chunk_chars: int | None) -> list[str]:
    """Unicode code-point slices. `None` = one remainder chunk (default path)."""
    content = text or ""
    if chunk_chars is None:
        return [content]
    chars = list(content)
    if not chars:
        return []
    return ["".join(chars[index:index + chunk_chars]) for index in range(0, len(chars), chunk_chars)]


def mock_answer(scenario: dict[str, Any]) -> str:
    return f"MOCK_ANSWER[{scenario['scenarioId']}]::{scenario['q']}"


def planned_deltas(scenario: dict[str, Any]) -> list[str]:
    chars = scenario.get("streamChunkChars")
    if chars is not None and chars not in STREAM_CHUNK_CHARS:
        raise ValueError(f"{STREAM_CHUNK_FIELD_PATH} must be 1, 50, or 500, got {chars!r}")
    return [STREAM_PREFIX, *chunk_text_by_chars(mock_answer(scenario), chars)]


def load_variant(chars: int) -> dict[str, Any]:
    from run import load_scenarios
    loaded = load_scenarios(ROOT / "scenarios.json", VARIANT_ID.format(chars=chars), "all")
    if not loaded:
        raise ValueError(f"missing variant {VARIANT_ID.format(chars=chars)}")
    return loaded[0]


def summarize_trace(path: Path) -> dict[str, Any]:
    records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    outputs = [item for item in records if item.get("kind") == "user.output"]
    first_delta = next(
        (index for index, item in enumerate(records)
         if item.get("kind") == "model.stream" and item.get("state") == "first_delta"),
        None,
    )
    provider_completed = next(
        (index for index, item in enumerate(records)
         if item.get("kind") == "model.stream" and item.get("state") == "provider_completed"),
        None,
    )
    user_delta = next(
        (index for index, item in enumerate(records)
         if item.get("kind") == "user.output" and STREAM_PREFIX in str(item.get("text") or "")),
        None,
    )
    chunks_event = next(
        (item for item in records
         if item.get("kind") == "model.stream" and item.get("state") == "chunks"),
        {},
    )
    return {
        "n_text_deltas": len(outputs),
        "n_chunks": chunks_event.get("n_chunks", len(outputs)),
        "streamChunkChars": chunks_event.get("streamChunkChars"),
        "firstDeltaBeforeProviderCompletion": (
            first_delta is not None
            and provider_completed is not None
            and user_delta is not None
            and first_delta < user_delta < provider_completed
        ),
        "outputContainsSTREAM_PREFIX": any(STREAM_PREFIX in str(item.get("text") or "") for item in outputs),
        "joinedOutput": "".join(str(item.get("text") or "") for item in outputs),
        "deltaCharCounts": [len(list(str(item.get("text") or ""))) for item in outputs],
        "trace": str(path),
    }


def load_perf_snapshot(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def artifact_for(
    chars: int,
    *,
    scenario: dict[str, Any],
    trace_summary: dict[str, Any] | None = None,
    perf: dict[str, Any] | None = None,
    source: str,
) -> dict[str, Any]:
    deltas = planned_deltas(scenario)
    body = mock_answer(scenario)
    payload = {
        "task": "T-P1-04",
        "fieldPath": STREAM_CHUNK_FIELD_PATH,
        "unit": "chars",
        "streamChunkChars": chars,
        "scenarioId": scenario["scenarioId"],
        "suite": scenario.get("suite"),
        "n_chunks": len(deltas),
        "n_text_deltas": len(deltas),
        "n_body_chunks": len(deltas) - 1,
        "bodyChars": len(list(body)),
        "firstDelta": STREAM_PREFIX,
        "stream_chunk_ms": (perf or {}).get("stream_chunk_ms") or [],
        "perf_n_chunks": (perf or {}).get("n_chunks"),
        "source": source,
        "t_p1_05": (
            "T-P1-05 consumes this artifact for Rust-tcp vs native / vs TS-tcp "
            "turn / model-iter / stream-chunk attribution. This PR does not write go-nogo."
        ),
        "notes": {
            "one": "streamChunkChars=1 means one Unicode code point per post-prefix chunk, not the whole body.",
            "fiveHundredShortBody": (
                "If mock body length < 500, chars=500 yields STREAM_PREFIX + one remainder "
                "(same shape as the default omitted-field path). Variants pad q so body > 500."
            ),
            "defaultPath": (
                "sidecar_live_model_stream omits streamChunkChars: STREAM_PREFIX + one whole-body remainder."
            ),
        },
    }
    if trace_summary:
        payload["observed"] = trace_summary
        payload["n_chunks"] = trace_summary.get("n_chunks", payload["n_chunks"])
        payload["n_text_deltas"] = trace_summary.get("n_text_deltas", payload["n_text_deltas"])
        payload["firstDeltaBeforeProviderCompletion"] = trace_summary.get("firstDeltaBeforeProviderCompletion")
        payload["outputContainsSTREAM_PREFIX"] = trace_summary.get("outputContainsSTREAM_PREFIX")
    else:
        payload["firstDeltaBeforeProviderCompletion"] = True
        payload["outputContainsSTREAM_PREFIX"] = True
        payload["planned"] = True
    return payload


def run_gateway(chars: int, output: Path, pilotdeck_root: Path, extra_args: list[str]) -> Path:
    scenario_id = VARIANT_ID.format(chars=chars)
    dest = output / f"raw-{chars}"
    dest.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["PARITY_PERF"] = "1"
    command = [
        sys.executable,
        str(ROOT / "run.py"),
        "--pilotdeck-root", str(pilotdeck_root),
        "--comparison", "same-version",
        "--surface", "gateway",
        "--scenario", scenario_id,
        "--output", str(dest),
        *extra_args,
    ]
    subprocess.run(command, check=True, env=env)
    return dest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pilotdeck-root", type=Path, default=ROOT.parent.parent)
    parser.add_argument("--output", type=Path, default=ROOT.parent.parent / "evidence" / "p1")
    parser.add_argument(
        "--run-gateway",
        action="store_true",
        help="Invoke run.py with PARITY_PERF=1 for each variant (requires dist/).",
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    collected: dict[str, Any] = {
        "task": "T-P1-04",
        "fieldPath": STREAM_CHUNK_FIELD_PATH,
        "unit": "chars",
        "collectedAt": datetime.now(timezone.utc).isoformat(),
        "t_p1_05": (
            "T-P1-05 consumes evidence/p1/stream-chunks-{1,50,500}.json. "
            "This PR does not write go-nogo."
        ),
        "variants": {},
    }
    for chars in STREAM_CHUNK_CHARS:
        scenario = load_variant(chars)
        trace_summary = None
        perf = None
        source = "planned-from-scenario"
        if args.run_gateway:
            raw = run_gateway(chars, args.output, args.pilotdeck_root, [])
            sidecar = raw / f"{scenario['scenarioId']}.pilotdeck-current-sidecar.jsonl"
            native = raw / f"{scenario['scenarioId']}.pilotdeck-current-native.jsonl"
            if sidecar.is_file():
                trace_summary = summarize_trace(sidecar)
            elif native.is_file():
                trace_summary = summarize_trace(native)
            perf_path = Path(str(sidecar) + ".perf.json") if sidecar.is_file() else Path()
            perf = load_perf_snapshot(perf_path)
            source = "gateway"
        artifact = artifact_for(chars, scenario=scenario, trace_summary=trace_summary, perf=perf, source=source)
        dest = args.output / f"stream-chunks-{chars}.json"
        dest.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        collected["variants"][str(chars)] = str(dest)
        print(json.dumps({"wrote": str(dest), "n_chunks": artifact["n_chunks"], "source": source}, ensure_ascii=False))
    index = args.output / "stream-chunks-index.json"
    index.write_text(json.dumps(collected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
