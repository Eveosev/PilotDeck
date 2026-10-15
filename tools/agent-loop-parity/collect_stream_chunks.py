#!/usr/bin/env python3
"""Collect T-P1-04/05 stream-chunk artifacts for 1 / 50 / 500 Unicode chars.

Parameter entry is only `scenarios[].streamChunkChars` (not env, not tokens).
Planned mode writes `evidence/p1/stream-chunks-{1,50,500}.json`. Live
`--run-gateway` writes `stream-chunks-live-{transport}-{chars}.json` with
`source=sidecar|native` (never `gateway`) and net-of-delay intervals.
This helper does not write a go-nogo decision.
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
VALID_TRANSPORTS = ("native", "ts-tcp", "rust-tcp", "stdio")


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


def sidecar_trace_path(raw: Path, scenario_id: str) -> Path:
    return raw / f"{scenario_id}.pilotdeck-current-sidecar.jsonl"


def native_trace_path(raw: Path, scenario_id: str) -> Path:
    return raw / f"{scenario_id}.pilotdeck-current-native.jsonl"


def perf_path_for(trace: Path) -> Path:
    return Path(str(trace) + ".perf.json")


def select_run_gateway_trace(
    raw: Path,
    scenario_id: str,
    *,
    prefer: str = "sidecar",
) -> dict[str, Any]:
    """Pick the trace that actually exists. Sidecar traces are `source=sidecar`.

    Native-only traces are kept (source=native) with their own perf snapshot.
    Missing the preferred trace is an error: do not mislabel sidecar as native
    (or the reverse). Missing both is also an error.
    """
    if prefer not in {"sidecar", "native"}:
        raise ValueError(f"prefer must be sidecar or native, got {prefer!r}")
    sidecar = sidecar_trace_path(raw, scenario_id)
    native = native_trace_path(raw, scenario_id)
    if prefer == "sidecar":
        if sidecar.is_file():
            return {
                "trace_summary": summarize_trace(sidecar),
                "perf": load_perf_snapshot(perf_path_for(sidecar)),
                "source": "sidecar",
            }
        if native.is_file():
            raise FileNotFoundError(
                f"no sidecar trace for {scenario_id} under {raw} "
                f"(native-only {native.name}; pass --trace-source native)"
            )
        raise FileNotFoundError(
            f"no sidecar or native trace for {scenario_id} under {raw}: "
            f"missing {sidecar.name} and {native.name}"
        )
    if native.is_file():
        return {
            "trace_summary": summarize_trace(native),
            "perf": load_perf_snapshot(perf_path_for(native)),
            "source": "native",
        }
    if sidecar.is_file():
        raise FileNotFoundError(
            f"no native trace for {scenario_id} under {raw} "
            f"(sidecar-only {sidecar.name}; pass --trace-source sidecar)"
        )
    raise FileNotFoundError(
        f"no native or sidecar trace for {scenario_id} under {raw}: "
        f"missing {native.name} and {sidecar.name}"
    )


def build_run_gateway_extra_args(
    *,
    sidecar_transport: str | None = None,
    tcp_host: str | None = None,
    tcp_port: int | None = None,
    tcp_sidecar_cmd: str | None = None,
    stdio_sidecar_cmd: str | None = None,
    extra: list[str] | None = None,
) -> list[str]:
    args: list[str] = []
    if sidecar_transport:
        args.extend(["--sidecar-transport", sidecar_transport])
    if tcp_host:
        args.extend(["--pilotdeck-tcp-host", tcp_host])
    if tcp_port is not None:
        args.extend(["--pilotdeck-tcp-port", str(tcp_port)])
    if tcp_sidecar_cmd:
        args.extend(["--pilotdeck-tcp-sidecar-cmd", tcp_sidecar_cmd])
    if stdio_sidecar_cmd:
        args.extend(["--pilotdeck-stdio-sidecar-cmd", stdio_sidecar_cmd])
    if extra:
        args.extend(extra)
    return args


def looks_like_rust_tcp_sidecar(command: str | None) -> bool:
    if not command:
        return False
    lowered = command.lower()
    if "node " in lowered or lowered.endswith(".js"):
        return False
    return any(token in lowered for token in ("/target/", "pilotdeck-agent-loop-sidecar", "rust-tcp-sidecar", "rust"))


def configured_model_ms(scenario: dict[str, Any]) -> float:
    delays = scenario.get("delays")
    if not isinstance(delays, dict):
        return 0.0
    try:
        return float(delays.get("modelMs") or 0)
    except (TypeError, ValueError):
        return 0.0


def net_stream_chunk_ms(intervals: list[Any], model_ms: float) -> list[float]:
    """Subtract configured modelMs from interval[0] only (C4)."""
    raw = [
        float(item)
        for item in intervals
        if isinstance(item, (int, float)) and not isinstance(item, bool)
    ]
    if not raw:
        return []
    return [round(raw[0] - float(model_ms), 3), *[round(item, 3) for item in raw[1:]]]


def live_artifact_path(output: Path, chars: int, transport: str | None) -> Path:
    label = transport or "unknown"
    return output / f"stream-chunks-live-{label}-{chars}.json"


def infer_transport(
    *,
    explicit: str | None,
    source: str,
    sidecar_transport: str | None = None,
    tcp_sidecar_cmd: str | None = None,
) -> str | None:
    if explicit:
        return explicit
    if source == "planned-from-scenario":
        return None
    if source == "native":
        return "native"
    transport = sidecar_transport or "stdio"
    if transport == "tcp":
        return "rust-tcp" if looks_like_rust_tcp_sidecar(tcp_sidecar_cmd) else "ts-tcp"
    return "stdio"


def artifact_notes() -> dict[str, str]:
    return {
        "one": "streamChunkChars=1 means one Unicode code point per post-prefix chunk, not the whole body.",
        "fiveHundredShortBody": (
            "If mock body length < 500, chars=500 yields STREAM_PREFIX + one remainder "
            "(same shape as the default omitted-field path). Variants pad q so body > 500."
        ),
        "defaultPath": (
            "sidecar_live_model_stream omits streamChunkChars: STREAM_PREFIX + one whole-body "
            "remainder (2 deltas), including when the body is an empty string."
        ),
        "firstChunkInterval": (
            "stream_chunk_ms[0] (prefix → first body chunk) includes mock model latency "
            "(live-stream modelMs: 200). Exclude interval[0] when attributing harness / "
            "Gateway / sidecar forwarding."
        ),
        "nChunksSources": (
            "n_chunks is the harness yield count (model.stream state=chunks, or planned "
            "prefix+body slices). perf_n_chunks is the Gateway-observed assistant_text_delta "
            "count from the perf snapshot; observed n_text_deltas is user.output count. "
            "They may differ if Gateway/sidecar coalesces deltas."
        ),
        "sourceLabels": (
            "source=sidecar is a sidecar trace (Rust-tcp / TS-tcp / stdio). "
            "source=native is the native Gateway adapter. source=planned-from-scenario "
            "is fixture-derived and not a live run. Sidecar traces are never labelled gateway."
        ),
        "netOfDelay": (
            "stream_chunk_ms is raw Gateway-observed intervals. "
            "stream_chunk_ms_net_of_model_ms subtracts configured delays.modelMs "
            "from interval[0] only (later intervals are forwarding). "
            "T-P1-05 D4 is judged on the net-of-delay number."
        ),
        "plannedOracle": (
            "In planned mode firstDeltaBeforeProviderCompletion and "
            "outputContainsSTREAM_PREFIX are null (not evaluated). Live --run-gateway "
            "fills them from the trace."
        ),
    }


def artifact_for(
    chars: int,
    *,
    scenario: dict[str, Any],
    trace_summary: dict[str, Any] | None = None,
    perf: dict[str, Any] | None = None,
    source: str,
    transport: str | None = None,
) -> dict[str, Any]:
    deltas = planned_deltas(scenario)
    body = mock_answer(scenario)
    raw_intervals = list((perf or {}).get("stream_chunk_ms") or [])
    model_ms = configured_model_ms(scenario)
    payload = {
        "task": "T-P1-05" if source != "planned-from-scenario" else "T-P1-04",
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
        "stream_chunk_ms": raw_intervals,
        "stream_chunk_ms_net_of_model_ms": net_stream_chunk_ms(raw_intervals, model_ms),
        "configuredModelMs": model_ms,
        "perf_n_chunks": (perf or {}).get("n_chunks"),
        "source": source,
        "transport": transport,
        "t_p1_05": (
            "T-P1-05 consumes this artifact for Rust-tcp vs native / vs TS-tcp "
            "turn / model-iter / stream-chunk attribution. This PR does not write go-nogo."
        ),
        "notes": artifact_notes(),
    }
    if trace_summary:
        payload["observed"] = trace_summary
        payload["n_chunks"] = trace_summary.get("n_chunks", payload["n_chunks"])
        payload["n_text_deltas"] = trace_summary.get("n_text_deltas", payload["n_text_deltas"])
        payload["firstDeltaBeforeProviderCompletion"] = trace_summary.get("firstDeltaBeforeProviderCompletion")
        payload["outputContainsSTREAM_PREFIX"] = trace_summary.get("outputContainsSTREAM_PREFIX")
    else:
        payload["firstDeltaBeforeProviderCompletion"] = None
        payload["outputContainsSTREAM_PREFIX"] = None
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
    completed = subprocess.run(command, check=False, env=env)
    sidecar = sidecar_trace_path(dest, scenario_id)
    native = native_trace_path(dest, scenario_id)
    if not sidecar.is_file() and not native.is_file():
        raise FileNotFoundError(
            f"run.py exited {completed.returncode} without sidecar or native traces "
            f"for {scenario_id} under {dest}"
        )
    if completed.returncode != 0:
        print(
            json.dumps({
                "event": "run-gateway-nonzero",
                "scenarioId": scenario_id,
                "returncode": completed.returncode,
                "note": "traces exist; comparison/oracle failure does not block live collect",
            }, ensure_ascii=False),
            file=sys.stderr,
        )
    return dest


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pilotdeck-root", type=Path, default=ROOT.parent.parent)
    parser.add_argument("--output", type=Path, default=ROOT.parent.parent / "evidence" / "p1")
    parser.add_argument(
        "--run-gateway",
        action="store_true",
        help="Invoke run.py with PARITY_PERF=1 for each variant (requires dist/).",
    )
    parser.add_argument(
        "--sidecar-transport",
        choices=("stdio", "tcp"),
        help="Forwarded to run.py when --run-gateway is set.",
    )
    parser.add_argument("--pilotdeck-tcp-host", help="Forwarded to run.py (Rust/TS TCP reuse).")
    parser.add_argument("--pilotdeck-tcp-port", type=int, help="Forwarded to run.py (Rust/TS TCP reuse).")
    parser.add_argument(
        "--pilotdeck-tcp-sidecar-cmd",
        help="Forwarded to run.py so harness can spawn a Rust TCP sidecar.",
    )
    parser.add_argument(
        "--pilotdeck-stdio-sidecar-cmd",
        help="Forwarded to run.py for a stdio sidecar binary.",
    )
    parser.add_argument(
        "--transport",
        choices=VALID_TRANSPORTS,
        default=None,
        help=(
            "Label written to each artifact (native | ts-tcp | rust-tcp | stdio). "
            "Invalid values exit with code 2. Inferred from sidecar flags when omitted."
        ),
    )
    parser.add_argument(
        "--run-gateway-arg",
        action="append",
        default=[],
        dest="run_gateway_args",
        help="Extra raw arg forwarded to run.py (repeatable).",
    )
    parser.add_argument(
        "--trace-source",
        choices=("sidecar", "native"),
        default="sidecar",
        help=(
            "Which --run-gateway trace to label. sidecar traces are source=sidecar "
            "(never gateway). native traces are source=native. Missing the chosen "
            "trace exits 1 without writing artifacts."
        ),
    )
    return parser.parse_args(argv)


def extra_args_from_namespace(args: argparse.Namespace) -> list[str]:
    return build_run_gateway_extra_args(
        sidecar_transport=args.sidecar_transport,
        tcp_host=args.pilotdeck_tcp_host,
        tcp_port=args.pilotdeck_tcp_port,
        tcp_sidecar_cmd=args.pilotdeck_tcp_sidecar_cmd,
        stdio_sidecar_cmd=args.pilotdeck_stdio_sidecar_cmd,
        extra=args.run_gateway_args,
    )


def collect_prepared(args: argparse.Namespace) -> list[tuple[int, dict[str, Any], dict[str, Any] | None]]:
    extra_args = extra_args_from_namespace(args)
    prepared: list[tuple[int, dict[str, Any], dict[str, Any] | None]] = []
    for chars in STREAM_CHUNK_CHARS:
        scenario = load_variant(chars)
        selected: dict[str, Any] | None = None
        if args.run_gateway:
            raw = run_gateway(chars, args.output, args.pilotdeck_root, extra_args)
            selected = select_run_gateway_trace(
                raw,
                scenario["scenarioId"],
                prefer=args.trace_source,
            )
        prepared.append((chars, scenario, selected))
    return prepared


def write_collected(
    args: argparse.Namespace,
    prepared: list[tuple[int, dict[str, Any], dict[str, Any] | None]],
) -> None:
    live = any(selected is not None for _, _, selected in prepared)
    collected: dict[str, Any] = {
        "task": "T-P1-05" if live else "T-P1-04",
        "fieldPath": STREAM_CHUNK_FIELD_PATH,
        "unit": "chars",
        "collectedAt": datetime.now(timezone.utc).isoformat(),
        "t_p1_05": (
            "T-P1-05 consumes live stream-chunks-live-*.json plus turn/model JSON. "
            "This collector does not write a go-nogo decision."
        ),
        "variants": {},
    }
    for chars, scenario, selected in prepared:
        if selected is not None:
            source = selected["source"]
            trace_summary = selected["trace_summary"]
            perf = selected["perf"]
        else:
            source = "planned-from-scenario"
            trace_summary = None
            perf = None
        transport = infer_transport(
            explicit=args.transport,
            source=source,
            sidecar_transport=args.sidecar_transport,
            tcp_sidecar_cmd=args.pilotdeck_tcp_sidecar_cmd,
        )
        artifact = artifact_for(
            chars,
            scenario=scenario,
            trace_summary=trace_summary,
            perf=perf,
            source=source,
            transport=transport,
        )
        dest = (
            live_artifact_path(args.output, chars, transport)
            if live
            else args.output / f"stream-chunks-{chars}.json"
        )
        dest.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        collected["variants"][str(chars)] = str(dest)
        print(json.dumps(
            {"wrote": str(dest), "n_chunks": artifact["n_chunks"], "source": source, "transport": transport},
            ensure_ascii=False,
        ))
    index_name = (
        f"stream-chunks-live-{transport or 'unknown'}-index.json"
        if live
        else "stream-chunks-index.json"
    )
    index = args.output / index_name
    index.write_text(json.dumps(collected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    args.output.mkdir(parents=True, exist_ok=True)
    try:
        prepared = collect_prepared(args)
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    write_collected(args, prepared)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
