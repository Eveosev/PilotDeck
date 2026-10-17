"""Performance baseline harness for PilotDeck AgentLoop transports.

Reuses tools/agent-loop-parity adapters, mock backend, and TCP sidecar
bootstrap. Product default transport stays native; this harness only
selects stdio/tcp for measurement.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import subprocess
import sys
import tempfile
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PERF_ROOT = Path(__file__).resolve().parent
PARITY_DIR = PERF_ROOT.parent / "agent-loop-parity"
PARITY_ROOT = PARITY_DIR


def _load_parity_run() -> Any:
    """Load tools/agent-loop-parity/run.py without colliding with this file."""
    if str(PARITY_DIR) not in sys.path:
        sys.path.insert(0, str(PARITY_DIR))
    name = "agent_loop_parity_run"
    cached = sys.modules.get(name)
    if cached is not None:
        return cached
    spec = importlib.util.spec_from_file_location(name, PARITY_DIR / "run.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load tools/agent-loop-parity/run.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_parity = _load_parity_run()
load_scenarios = _parity.load_scenarios
resolve_ref = _parity.resolve_ref
resolve_sidecar_transport = _parity.resolve_sidecar_transport
resolve_tcp_sidecar_target = _parity.resolve_tcp_sidecar_target
run_adapter = _parity.run_adapter
start_mock = _parity.start_mock
start_tcp_sidecar = _parity.start_tcp_sidecar
stop_process = _parity.stop_process
tcp_sidecar_log_path = _parity.tcp_sidecar_log_path

DEFAULT_SCENARIOS = ("pure_text", "single_tool")
DEFAULT_TRANSPORTS = ("native", "stdio", "tcp")
DELAY_MAP_KEYS = ("delays", "toolDelays")
HOST_OVERHEAD_DEFINITION = (
    "native has no sidecar/module_call. This gate treats turn_ms(native) as "
    "the in-process host baseline. P1 relative overhead is "
    "(candidate_P95 - native_P95) compared with max(native_P95 * 10%, 5ms)."
)


def apply_delay_policy(
    scenario: dict[str, Any],
    *,
    zero: bool = True,
    model_ms: float | None = None,
) -> tuple[dict[str, Any], bool]:
    """Zero scenario mock delays unless the caller keeps them.

    Returns the (possibly copied) scenario and delay_injected. After the
    default zeroing policy, delay_injected is true only when a positive delay
    remains. `--model-ms` overlays `delays.modelMs` after zeroing (T-P1-05
    uses 200 on every transport).
    """
    prepared = deepcopy(scenario)
    if zero:
        for key in DELAY_MAP_KEYS:
            value = prepared.get(key)
            if isinstance(value, dict):
                prepared[key] = {name: 0 for name in value}
    if model_ms is not None:
        delays = dict(prepared.get("delays") or {})
        delays["modelMs"] = float(model_ms)
        prepared["delays"] = delays
    return prepared, has_nonzero_delay(prepared)


def has_nonzero_delay(scenario: dict[str, Any]) -> bool:
    for key in DELAY_MAP_KEYS:
        value = scenario.get(key)
        if not isinstance(value, dict):
            continue
        for raw in value.values():
            try:
                if float(raw) > 0:
                    return True
            except (TypeError, ValueError):
                if raw:
                    return True
    return False


def percentile(samples: list[float], p: float) -> float | None:
    """Inclusive-rank percentile with linear interpolation.

    P50/P95 use rank = p/100 * (n-1). Empty input returns None.
    """
    if not samples:
        return None
    if p < 0 or p > 100:
        raise ValueError(f"percentile must be in [0, 100], got {p}")
    ordered = sorted(float(item) for item in samples)
    if len(ordered) == 1:
        return _round_ms(ordered[0])
    rank = (p / 100.0) * (len(ordered) - 1)
    low = int(math.floor(rank))
    high = int(math.ceil(rank))
    if low == high:
        return _round_ms(ordered[low])
    frac = rank - low
    return _round_ms(ordered[low] * (1.0 - frac) + ordered[high] * frac)


def summarize(samples: list[float]) -> dict[str, Any]:
    return {
        "n": len(samples),
        "p50": percentile(samples, 50),
        "p95": percentile(samples, 95),
        "raw": [_round_ms(item) for item in samples],
    }


def net_of_configured_delay(
    values: list[float],
    delay_ms: float,
    *,
    times: int | list[int] = 1,
) -> list[float]:
    """Raw total minus configured modelMs (times = applications per sample)."""
    if isinstance(times, int):
        return [_round_ms(item - delay_ms * times) for item in values]
    return [_round_ms(item - delay_ms * count) for item, count in zip(values, times)]


def net_stream_chunk_ms(intervals: list[float], delay_ms: float) -> list[float]:
    """C4: subtract configured modelMs from interval[0] only."""
    if not intervals:
        return []
    return [_round_ms(intervals[0] - delay_ms), *[_round_ms(item) for item in intervals[1:]]]


def d4_threshold(native_p95: float | None) -> float | None:
    """D4 = max(native P95 × 10%, 5ms). Judged on net-of-delay P95."""
    if native_p95 is None:
        return None
    return _round_ms(max(float(native_p95) * 0.10, 5.0))


def _net_turn_p95(headline: Any) -> float | None:
    if not isinstance(headline, dict):
        return None
    block = headline.get("turn_ms_net_of_model_ms")
    if not isinstance(block, dict):
        return None
    value = block.get("p95")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None


def annotate_d4(report: dict[str, Any], native_report: dict[str, Any] | None) -> None:
    """Write D4 and (candidate net P95 − native net P95) / D4 into comparisonBaseline."""
    native_base: dict[str, Any] = {}
    if isinstance(native_report, dict) and isinstance(native_report.get("comparisonBaseline"), dict):
        native_base = native_report["comparisonBaseline"]
    comparison = report.get("comparisonBaseline")
    if not isinstance(comparison, dict):
        return
    for sid, headline in comparison.items():
        if not isinstance(headline, dict):
            continue
        native_p95 = _net_turn_p95(native_base.get(sid))
        candidate_p95 = _net_turn_p95(headline)
        threshold = d4_threshold(native_p95)
        diff: float | None = None
        ratio: float | None = None
        if threshold is not None and candidate_p95 is not None and native_p95 is not None and threshold != 0:
            diff = _round_ms(candidate_p95 - native_p95)
            ratio = _round_ms(diff / threshold)
        headline["d4"] = threshold
        headline["netP95DiffMs"] = diff
        headline["diffOverD4"] = ratio


def _round_ms(value: float) -> float:
    return round(float(value), 3)


def capture_versions() -> dict[str, str]:
    node = subprocess.run(["node", "--version"], text=True, capture_output=True, check=False)
    return {
        "python": sys.version.split()[0],
        "pythonFull": sys.version,
        "node": (node.stdout or node.stderr or "").strip(),
    }


def git_dirty(root: Path) -> bool:
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    return bool((result.stdout or "").strip())


def resolve_base(root: Path, branch: str, base_sha: str | None = None) -> tuple[str, str]:
    """Resolve (branch, sha) for provenance.baseSha.

    An explicit ``base_sha`` wins. Otherwise prefer ``origin/<branch>`` so a
    stale local branch cannot supply the merge-base. This function does not
    fetch; refresh ``origin/<branch>`` before the run when that ref is old,
    or pass ``--base-sha``.
    """
    explicit = (base_sha or "").strip()
    if explicit:
        verified = subprocess.run(
            ["git", "rev-parse", "--verify", f"{explicit}^{{commit}}"],
            cwd=root,
            text=True,
            capture_output=True,
            check=False,
        )
        resolved = (verified.stdout or "").strip()
        if verified.returncode != 0 or not resolved:
            raise RuntimeError(f"--base-sha does not resolve to a commit: {explicit}")
        return branch, resolved
    for candidate in (f"origin/{branch}", branch):
        probe = subprocess.run(
            ["git", "rev-parse", "--verify", candidate],
            cwd=root,
            text=True,
            capture_output=True,
            check=False,
        )
        if probe.returncode != 0:
            continue
        merged = subprocess.run(
            ["git", "merge-base", "HEAD", candidate],
            cwd=root,
            text=True,
            capture_output=True,
            check=False,
        )
        if merged.returncode == 0 and merged.stdout.strip():
            return branch, merged.stdout.strip()
    return branch, resolve_ref(root, "HEAD")


def resolve_collect_sha(root: Path, *, allow_dirty: bool) -> tuple[str, bool]:
    """Return (HEAD, dirty). Refuse a dirty tree unless allow_dirty."""
    collect_sha = resolve_ref(root, "HEAD")
    dirty = git_dirty(root)
    if dirty and not allow_dirty:
        raise RuntimeError(
            "working tree is dirty; collect on a clean HEAD so provenance.gitSha "
            "matches the commit, or pass --allow-dirty"
        )
    return collect_sha, dirty


def refuse_tcp_with_stdio_sidecar(
    transports: list[str],
    stdio_cmd: str | None,
    tcp_cmd: str | None,
) -> None:
    """rust-core exits 2 when a TCP port or factory is set. Never mix them."""
    if not (stdio_cmd or "").strip():
        return
    if "tcp" in transports or (tcp_cmd or "").strip():
        raise ValueError(
            "refusing TCP sidecar flags while --pilotdeck-stdio-sidecar-cmd is set; "
            "the rust-core binary exits 2 on TCP"
        )


def stdio_rust_intended(command: str | None) -> bool:
    return _parity.rust_sidecar_intended(
        sidecar_transport="stdio",
        stdio_sidecar_command=command,
        tcp_target=None,
    )


def label_perf_transport(
    transport: str,
    *,
    tcp_sidecar_cmd: str | None = None,
    stdio_sidecar_command: str | None = None,
) -> str:
    """Public perf JSON transport: native / ts-tcp / rust-tcp / rust-stdio.

    The harness CLI still says native|stdio|tcp. Product default stays native.
    """
    if transport == "native":
        return "native"
    if transport == "tcp":
        if _parity.command_names_rust_sidecar(tcp_sidecar_cmd):
            return "rust-tcp"
        return "ts-tcp"
    if transport == "stdio" and _parity.command_names_rust_sidecar(stdio_sidecar_command):
        return "rust-stdio"
    return transport


def rust_core_identity(rust_bin: str | None) -> dict[str, Any] | None:
    """Identity of the rust-core proof symlink, when PILOTDECK_RUST_SIDECAR_BIN is set."""
    text = (rust_bin or "").strip()
    if not text:
        return None
    link = Path(text)
    identity: dict[str, Any] = {
        "bin": text,
        "proofBasename": "pilotdeck-agent-loop",
        "target": None,
        "sha256": None,
    }
    if link.name != "pilotdeck-agent-loop" or not link.is_symlink():
        return identity
    target = Path(os.path.realpath(link))
    identity["target"] = str(target)
    if not target.is_file():
        return identity
    digest = hashlib.sha256()
    with target.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    identity["sha256"] = digest.hexdigest()
    return identity


def prepare_rust_stdio_identity(command: str | None, rust_bin: str | None) -> dict[str, Any] | None:
    """Fail before a long run if a Rust stdio command would measure the wrong binary.

    The wrapper's exec proof accepts only a path ending in ``pilotdeck-agent-loop``.
    rust-core's binary is ``pilotdeck-agent-loop-sidecar``, so the bin must be the
    same-name symlink. ``realpath`` (which follows links) is used only to record
    the target; the proof itself must keep the symlink path.
    """
    cmd = (command or "").strip()
    if not cmd or not stdio_rust_intended(cmd):
        return None
    if "rust-stdio-sidecar" not in cmd:
        raise RuntimeError(
            "Rust stdio measurement must use tools/agent-loop-parity/rust-stdio-sidecar.sh "
            "so the wrapper can write PARITY_RUST_SIDECAR_PROOF"
        )
    bin_text = (rust_bin or "").strip()
    if not bin_text:
        raise RuntimeError(
            "PILOTDECK_RUST_SIDECAR_BIN is required with rust-stdio-sidecar.sh; "
            "the wrapper otherwise falls back to the in-repo probe binary"
        )
    link = Path(bin_text)
    if link.name != "pilotdeck-agent-loop" or not link.is_symlink():
        raise RuntimeError(
            "PILOTDECK_RUST_SIDECAR_BIN must be a symlink whose basename is "
            f"pilotdeck-agent-loop, got {bin_text}"
        )
    target = Path(os.path.realpath(link))
    if target.name != "pilotdeck-agent-loop-sidecar" or not target.is_file():
        raise RuntimeError(
            "symlink target must be the file pilotdeck-agent-loop-sidecar, "
            f"got {target}"
        )
    digest = hashlib.sha256()
    with target.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {
        "command": cmd,
        "bin": bin_text,
        "target": str(target),
        "sha256": digest.hexdigest(),
        "proofEnv": "PARITY_RUST_SIDECAR_PROOF",
        "proofPathPattern": "<trace>.rust-exec.jsonl",
    }


def exec_proof_path(trace_path: Path) -> Path:
    return Path(str(trace_path) + ".rust-exec.jsonl")


def _compact_exec_record(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "pid": payload.get("pid"),
        "bin": payload.get("bin"),
        "resolved": payload.get("resolved"),
    }


def load_wrapper_exec_proof(trace_path: Path) -> list[dict[str, Any]]:
    path = exec_proof_path(trace_path)
    if not path.is_file():
        return []
    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if isinstance(payload, dict):
            records.append(_compact_exec_record(payload))
    return records


def load_trace_exec_proof(trace_path: Path) -> list[dict[str, Any]]:
    if not trace_path.is_file():
        return []
    records: list[dict[str, Any]] = []
    for line in trace_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if (
            isinstance(payload, dict)
            and payload.get("kind") == "harness.proof"
            and payload.get("state") == "rust_sidecar_exec"
        ):
            records.append(_compact_exec_record(payload))
    return records


def proof_resolves_to_agent_loop(records: list[dict[str, Any]], expected_bin: str) -> bool:
    for record in records:
        resolved = str(record.get("resolved") or "")
        if not resolved.rstrip("/").endswith("pilotdeck-agent-loop"):
            continue
        if str(record.get("bin") or "") != expected_bin:
            continue
        try:
            if int(record.get("pid")) > 0:
                return True
        except (TypeError, ValueError):
            continue
    return False


def record_command(argv: list[str], root: Path) -> str:
    """Record the invocation without leaking an absolute --pilotdeck-root."""
    recorded = ["python3", "tools/agent-loop-perf/run.py"]
    resolved_root = root.resolve()
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--pilotdeck-root" and index + 1 < len(argv):
            recorded.extend(["--pilotdeck-root", "$PWD"])
            index += 2
            continue
        try:
            if Path(arg).resolve() == resolved_root:
                recorded.append("$PWD")
                index += 1
                continue
        except OSError:
            pass
        recorded.append(arg)
        index += 1
    return " ".join(recorded)


def load_perf_snapshot(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"adapter did not write perf snapshot: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise TypeError(f"perf snapshot must be an object: {path}")
    return payload


def run_one(
    *,
    transport: str,
    source: Path,
    scenario: dict[str, Any],
    mock: str,
    output: Path,
    timeout_seconds: float,
    tcp_target: Any,
    stdio_sidecar_command: str | None = None,
    rust_sidecar_bin: str | None = None,
) -> dict[str, Any]:
    mode = "native" if transport == "native" else "sidecar"
    sidecar_transport = "stdio" if transport == "native" else transport
    trace_path = output
    if trace_path.exists():
        trace_path.unlink()
    perf_path = Path(f"{trace_path}.perf.json")
    if perf_path.exists():
        perf_path.unlink()
    env_was = os.environ.get("PARITY_PERF")
    out_was = os.environ.get("PARITY_PERF_OUT")
    os.environ["PARITY_PERF"] = "1"
    os.environ["PARITY_PERF_OUT"] = str(perf_path)
    wall_started = time.perf_counter()
    try:
        status = run_adapter(
            mode,
            source,
            "working-tree",
            scenario,
            mock,
            trace_path,
            "gateway",
            timeout_seconds,
            None,
            sidecar_transport=sidecar_transport,
            tcp_target=tcp_target,
            stdio_sidecar_command=stdio_sidecar_command if transport == "stdio" else None,
        )
    finally:
        if env_was is None:
            os.environ.pop("PARITY_PERF", None)
        else:
            os.environ["PARITY_PERF"] = env_was
        if out_was is None:
            os.environ.pop("PARITY_PERF_OUT", None)
        else:
            os.environ["PARITY_PERF_OUT"] = out_was
    adapter_wall_ms = _round_ms((time.perf_counter() - wall_started) * 1000)
    if status != "PASS":
        raise RuntimeError(status)
    snapshot = load_perf_snapshot(perf_path)
    turn_ms = snapshot.get("turn_ms")
    if not isinstance(turn_ms, (int, float)) or isinstance(turn_ms, bool):
        raise RuntimeError("perf snapshot is missing turn_ms")
    model_iter_ms = _float_list(snapshot.get("model_iter_ms"))
    stream_chunk_ms = _float_list(snapshot.get("stream_chunk_ms"))
    n_chunks = snapshot.get("n_chunks")
    if not isinstance(n_chunks, (int, float)) or isinstance(n_chunks, bool):
        n_chunks = None
    else:
        n_chunks = int(n_chunks)
    rss_kb = snapshot.get("rss_kb")
    non_model_ms = snapshot.get("non_model_ms")
    if not isinstance(non_model_ms, (int, float)) or isinstance(non_model_ms, bool):
        non_model_ms = _round_ms(float(turn_ms) - sum(model_iter_ms))
    segments = snapshot.get("segments") if isinstance(snapshot.get("segments"), dict) else {}
    result = {
        "turn_ms": _round_ms(float(turn_ms)),
        "model_iter_ms": model_iter_ms,
        "stream_chunk_ms": stream_chunk_ms,
        "n_chunks": n_chunks,
        "non_model_ms": _round_ms(float(non_model_ms)),
        "segments": {
            "first_gateway_event_ms": _optional_ms(segments.get("first_gateway_event_ms")),
            "pre_model_ms": _optional_ms(segments.get("pre_model_ms")),
            "model_sum_ms": _optional_ms(segments.get("model_sum_ms")) or _round_ms(sum(model_iter_ms)),
            "between_model_ms": _float_list(segments.get("between_model_ms")),
            "tool_ms": _optional_ms(segments.get("tool_ms")),
            "tool_iter_ms": _float_list(segments.get("tool_iter_ms")),
            "post_model_ms": _optional_ms(segments.get("post_model_ms")),
            "handshake_ms": _optional_ms(segments.get("handshake_ms")),
            "stream_accepted_ms": _optional_ms(segments.get("stream_accepted_ms")),
        },
        "rss_kb": int(rss_kb) if isinstance(rss_kb, (int, float)) and not isinstance(rss_kb, bool) else None,
        "adapter_wall_ms": adapter_wall_ms,
        "gateway_outside_turn_ms": _round_ms(adapter_wall_ms - float(turn_ms)),
        "metrics_source": "adapter_submit_turn",
        "harness_await_inside_turn": False,
        "marks": snapshot.get("marks") if isinstance(snapshot.get("marks"), list) else [],
    }
    if transport == "stdio" and stdio_sidecar_command and stdio_rust_intended(stdio_sidecar_command):
        expected_bin = rust_sidecar_bin or ""
        wrapper_proof = load_wrapper_exec_proof(trace_path)
        trace_proof = load_trace_exec_proof(trace_path)
        if not proof_resolves_to_agent_loop(wrapper_proof, expected_bin) or not proof_resolves_to_agent_loop(trace_proof, expected_bin):
            raise RuntimeError(
                "stdio Rust exec proof missing or does not match PILOTDECK_RUST_SIDECAR_BIN "
                f"(expected bin {expected_bin}; wrapper={wrapper_proof!r} trace={trace_proof!r})"
            )
        result["execProof"] = {"wrapper": wrapper_proof, "trace": trace_proof}
    return result


def _optional_ms(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return _round_ms(float(value))
    return None


def _float_list(value: Any) -> list[float]:
    if not isinstance(value, list):
        return []
    result: list[float] = []
    for item in value:
        if isinstance(item, (int, float)) and not isinstance(item, bool):
            result.append(_round_ms(float(item)))
    return result


def flatten(values: list[list[float]]) -> list[float]:
    return [item for group in values for item in group]


def build_scenario_report(
    scenario_id: str,
    *,
    delay_injected: bool,
    samples: list[dict[str, Any]],
    configured_model_ms: float = 0.0,
) -> dict[str, Any]:
    turn = [float(item["turn_ms"]) for item in samples]
    model = flatten([list(item.get("model_iter_ms") or []) for item in samples])
    chunks = flatten([list(item.get("stream_chunk_ms") or []) for item in samples])
    non_model = [
        float(item["non_model_ms"]) if item.get("non_model_ms") is not None
        else _round_ms(float(item["turn_ms"]) - sum(_float_list(item.get("model_iter_ms"))))
        for item in samples
    ]
    pre_model = [
        float(item["segments"]["pre_model_ms"])
        for item in samples
        if isinstance(item.get("segments"), dict) and item["segments"].get("pre_model_ms") is not None
    ]
    post_model = [
        float(item["segments"]["post_model_ms"])
        for item in samples
        if isinstance(item.get("segments"), dict) and item["segments"].get("post_model_ms") is not None
    ]
    between = flatten([
        list(item["segments"]["between_model_ms"])
        for item in samples
        if isinstance(item.get("segments"), dict)
    ])
    tool = [
        float(item["segments"]["tool_ms"])
        for item in samples
        if isinstance(item.get("segments"), dict) and item["segments"].get("tool_ms") is not None
    ]
    handshake = [
        float(item["segments"]["handshake_ms"])
        for item in samples
        if isinstance(item.get("segments"), dict) and item["segments"].get("handshake_ms") is not None
    ]
    first_event = [
        float(item["segments"]["first_gateway_event_ms"])
        for item in samples
        if isinstance(item.get("segments"), dict) and item["segments"].get("first_gateway_event_ms") is not None
    ]
    outside = [float(item["gateway_outside_turn_ms"]) for item in samples if item.get("gateway_outside_turn_ms") is not None]
    rss = [int(item["rss_kb"]) for item in samples if item.get("rss_kb") is not None]
    n_chunks = [
        int(item["n_chunks"])
        for item in samples
        if isinstance(item.get("n_chunks"), (int, float)) and not isinstance(item.get("n_chunks"), bool)
    ]
    model_counts = [len(list(item.get("model_iter_ms") or [])) for item in samples]
    turn_net = net_of_configured_delay(turn, configured_model_ms, times=model_counts)
    model_net = net_of_configured_delay(model, configured_model_ms, times=1)
    chunk_net = flatten([
        net_stream_chunk_ms(list(item.get("stream_chunk_ms") or []), configured_model_ms)
        for item in samples
    ])
    interval0 = [
        float(item["stream_chunk_ms"][0])
        for item in samples
        if item.get("stream_chunk_ms")
    ]
    interval0_net = net_of_configured_delay(interval0, configured_model_ms, times=1)
    later_chunks = flatten([
        list(item.get("stream_chunk_ms") or [])[1:]
        for item in samples
    ])
    return {
        "scenarioId": scenario_id,
        "delay_injected": delay_injected,
        "primaryBaseline": not delay_injected,
        "configuredModelMs": configured_model_ms,
        "iterations": len(samples),
        "samples": samples,
        "turn_ms": summarize(turn),
        "turn_ms_net_of_model_ms": summarize(turn_net),
        "model_iter_ms": summarize(model),
        "model_iter_ms_net_of_model_ms": summarize(model_net),
        "non_model_ms": summarize(non_model),
        "stream_chunk_ms": summarize(chunks),
        "stream_chunk_ms_net_of_model_ms": summarize(chunk_net),
        "stream_chunk_ms_interval0": summarize(interval0),
        "stream_chunk_ms_interval0_net_of_model_ms": summarize(interval0_net),
        "stream_chunk_ms_after_first": summarize(later_chunks),
        "n_chunks": summarize(n_chunks),
        "segments": {
            "first_gateway_event_ms": summarize(first_event),
            "pre_model_ms": summarize(pre_model),
            "post_model_ms": summarize(post_model),
            "between_model_ms": summarize(between),
            "tool_ms": summarize(tool),
            "handshake_ms": summarize(handshake),
            "gateway_outside_turn_ms": summarize(outside),
        },
        "rss_kb_note": {
            "n": len(rss),
            "p50": percentile([float(item) for item in rss], 50) if rss else None,
            "scope": (
                "adapter/host Node process VmRSS at turn end; excludes sidecar "
                "child/listener; macOS is null; optional, not a gate"
            ),
        },
    }


def load_named_scenarios(scenario_file: Path, names: list[str]) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for name in names:
        found = load_scenarios(scenario_file, name, "all")
        if not found:
            raise ValueError(f"unknown PilotDeck scenario: {name}")
        selected.append(found[0])
    return selected


def scenario_headline(report: dict[str, Any]) -> dict[str, Any]:
    def brief(block: dict[str, Any] | None) -> dict[str, Any]:
        payload = block or {}
        return {"n": payload.get("n"), "p50": payload.get("p50"), "p95": payload.get("p95")}
    return {
        "delay_injected": report["delay_injected"],
        "configuredModelMs": report.get("configuredModelMs", 0.0),
        "turn_ms": brief(report.get("turn_ms")),
        "turn_ms_net_of_model_ms": brief(report.get("turn_ms_net_of_model_ms")),
        "model_iter_ms": brief(report.get("model_iter_ms")),
        "model_iter_ms_net_of_model_ms": brief(report.get("model_iter_ms_net_of_model_ms")),
        "non_model_ms": brief(report.get("non_model_ms")),
        "stream_chunk_ms": brief(report.get("stream_chunk_ms")),
        "stream_chunk_ms_net_of_model_ms": brief(report.get("stream_chunk_ms_net_of_model_ms")),
        "stream_chunk_ms_interval0": brief(report.get("stream_chunk_ms_interval0")),
        "stream_chunk_ms_interval0_net_of_model_ms": brief(report.get("stream_chunk_ms_interval0_net_of_model_ms")),
        "stream_chunk_ms_after_first": brief(report.get("stream_chunk_ms_after_first")),
        "segments": {
            key: brief(value)
            for key, value in (report.get("segments") or {}).items()
        },
    }


def delay_policy_label(*, zero_delays: bool, model_ms: float | None) -> str:
    if model_ms is not None:
        prefix = "zero" if zero_delays else "keep"
        return f"{prefix}+modelMs:{model_ms:g}"
    return "zero" if zero_delays else "keep"


def summarize_exec_proofs(reports: dict[str, Any]) -> dict[str, Any]:
    resolved: set[str] = set()
    bins: set[str] = set()
    iterations_with_proof = 0
    for report in reports.values():
        for sample in report.get("samples") or []:
            proof = sample.get("execProof")
            if not isinstance(proof, dict):
                continue
            iterations_with_proof += 1
            for side in ("wrapper", "trace"):
                for record in proof.get(side) or []:
                    if record.get("resolved"):
                        resolved.add(str(record["resolved"]))
                    if record.get("bin"):
                        bins.add(str(record["bin"]))
    return {
        "iterationsWithProof": iterations_with_proof,
        "bin": sorted(bins),
        "resolved": sorted(resolved),
        "acceptedBasename": "pilotdeck-agent-loop",
    }


def run_transport(
    *,
    transport: str,
    source: Path,
    scenarios: list[dict[str, Any]],
    iterations: int,
    timeout_seconds: float,
    work: Path,
    mock: str,
    zero_delays: bool,
    model_ms: float | None,
    tcp_sidecar_cmd: str | None,
    tcp_host: str | None,
    tcp_port: int | None,
    stdio_sidecar_command: str | None = None,
    rust_sidecar_bin: str | None = None,
) -> dict[str, Any]:
    tcp_target = None
    tcp_process = None
    tcp_log = None
    public_transport = label_perf_transport(
        transport,
        tcp_sidecar_cmd=tcp_sidecar_cmd,
        stdio_sidecar_command=stdio_sidecar_command,
    )
    sidecar_transport = None if transport == "native" else resolve_sidecar_transport(transport)
    if transport == "tcp":
        tcp_target = resolve_tcp_sidecar_target(
            host=tcp_host,
            port=tcp_port,
            command=tcp_sidecar_cmd,
            source=source,
        )
        if tcp_target.start_command:
            tcp_log = tcp_sidecar_log_path(work)
            tcp_process = start_tcp_sidecar(tcp_target, source, os.environ.copy(), tcp_log)
    reports: dict[str, Any] = {}
    try:
        for scenario in scenarios:
            prepared, delay_injected = apply_delay_policy(
                scenario,
                zero=zero_delays,
                model_ms=model_ms,
            )
            sid = str(prepared["scenarioId"])
            samples: list[dict[str, Any]] = []
            for iteration in range(1, iterations + 1):
                trace_path = work / f"{sid}.{transport}.{iteration}.jsonl"
                sample = run_one(
                    transport=transport,
                    source=source,
                    scenario=prepared,
                    mock=mock,
                    output=trace_path,
                    timeout_seconds=timeout_seconds,
                    tcp_target=tcp_target,
                    stdio_sidecar_command=stdio_sidecar_command,
                    rust_sidecar_bin=rust_sidecar_bin,
                )
                sample["iteration"] = iteration
                samples.append(sample)
                print(
                    json.dumps({
                        "event": "iteration",
                        "transport": public_transport,
                        "scenarioId": sid,
                        "iteration": iteration,
                        "turn_ms": sample["turn_ms"],
                        "delay_injected": delay_injected,
                    }, ensure_ascii=False),
                    flush=True,
                )
            reports[sid] = build_scenario_report(
                sid,
                delay_injected=delay_injected,
                samples=samples,
                configured_model_ms=float(model_ms or 0.0),
            )
    finally:
        stop_process(tcp_process)
    primary = {
        sid: scenario_headline(report)
        for sid, report in reports.items()
        if not report["delay_injected"]
    }
    comparison = {sid: scenario_headline(report) for sid, report in reports.items()}
    excluded = [sid for sid, report in reports.items() if report["delay_injected"]]
    stdio_active = transport == "stdio" and bool((stdio_sidecar_command or "").strip())
    rust_identity = rust_core_identity(rust_sidecar_bin) if public_transport in {"rust-tcp", "rust-stdio"} else None
    if public_transport in {"rust-tcp", "rust-stdio"} and rust_identity is None:
        rust_identity = {
            "bin": None,
            "proofBasename": "pilotdeck-agent-loop",
            "target": None,
            "sha256": None,
        }
    return {
        "transport": public_transport,
        "harnessTransport": transport,
        "rustCoreIdentity": rust_identity,
        "sidecarTransport": sidecar_transport if transport != "native" else None,
        "tcpSidecarLog": str(tcp_log) if tcp_log is not None else None,
        "stdioSidecarCommand": stdio_sidecar_command if stdio_active else None,
        "stdioSidecarActive": stdio_active,
        "execProof": summarize_exec_proofs(reports) if stdio_active and stdio_rust_intended(stdio_sidecar_command) else None,
        "hostOverheadDefinition": HOST_OVERHEAD_DEFINITION,
        "delayPolicy": delay_policy_label(zero_delays=zero_delays, model_ms=model_ms),
        "configuredModelMs": float(model_ms) if model_ms is not None else 0.0,
        "primaryBaseline": primary,
        "comparisonBaseline": comparison,
        "excludedFromPrimary": excluded,
        "scenarios": reports,
    }


def write_transport_evidence(
    path: Path,
    payload: dict[str, Any],
    *,
    provenance: dict[str, Any],
) -> None:
    document = {
        **payload,
        "provenance": provenance,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_csv(value: str) -> list[str]:
    items = [item.strip() for item in value.split(",")]
    return [item for item in items if item]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pilotdeck-root", type=Path, required=True)
    parser.add_argument("--scenario-file", type=Path, default=PARITY_ROOT / "scenarios.json")
    parser.add_argument("--scenarios", default=",".join(DEFAULT_SCENARIOS))
    parser.add_argument("--transports", default=",".join(DEFAULT_TRANSPORTS))
    parser.add_argument("--iterations", type=int, default=30)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--adapter-timeout-seconds", type=float, default=60)
    parser.add_argument("--keep-delays", action="store_true", help="Do not zero scenario delays.* / toolDelays.*")
    parser.add_argument(
        "--model-ms",
        type=float,
        default=None,
        help=(
            "Overlay delays.modelMs on every scenario after the delay policy. "
            "T-P1-05 uses 200 for native / TS-tcp / Rust-tcp."
        ),
    )
    parser.add_argument("--pilotdeck-tcp-host")
    parser.add_argument("--pilotdeck-tcp-port", type=int)
    parser.add_argument("--pilotdeck-tcp-sidecar-cmd")
    parser.add_argument(
        "--pilotdeck-stdio-sidecar-cmd",
        help=(
            "Stdio sidecar executable. Forwarded only for --transports stdio as "
            "PARITY_STDIO_SIDECAR_COMMAND, and the parity adapter then sets a "
            "per-turn PARITY_RUST_SIDECAR_PROOF. Use "
            "tools/agent-loop-parity/rust-stdio-sidecar.sh with "
            "PILOTDECK_RUST_SIDECAR_BIN pointing at a pilotdeck-agent-loop symlink. "
            "Do not combine with TCP sidecar flags: rust-core exits 2."
        ),
    )
    parser.add_argument(
        "--base-branch",
        default=os.environ.get("PERF_BASE_BRANCH", "rust_standalone_alpha1"),
        help="Branch used for provenance merge-base (default: rust_standalone_alpha1).",
    )
    parser.add_argument(
        "--base-sha",
        default=os.environ.get("PERF_BASE_SHA"),
        help=(
            "Explicit provenance base commit. Wins over origin/<branch> and a stale local branch."
        ),
    )
    parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="Allow collecting evidence on a dirty worktree. Default: refuse.",
    )
    args = parser.parse_args(argv)
    if args.iterations < 1:
        raise ValueError("--iterations must be >= 1")
    transports = parse_csv(args.transports)
    unknown = [item for item in transports if item not in DEFAULT_TRANSPORTS]
    if unknown:
        raise ValueError(f"unsupported transports: {', '.join(unknown)}")
    stdio_sidecar_command = (args.pilotdeck_stdio_sidecar_cmd or "").strip() or None
    refuse_tcp_with_stdio_sidecar(transports, stdio_sidecar_command, args.pilotdeck_tcp_sidecar_cmd)
    rust_bin = (os.environ.get("PILOTDECK_RUST_SIDECAR_BIN") or "").strip() or None
    rust_identity = prepare_rust_stdio_identity(stdio_sidecar_command, rust_bin)
    scenario_names = parse_csv(args.scenarios)
    scenarios = load_named_scenarios(args.scenario_file, scenario_names)
    source = args.pilotdeck_root.resolve()
    output = (args.output or (source / "evidence" / "perf-baseline")).resolve()
    output.mkdir(parents=True, exist_ok=True)
    versions = capture_versions()
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    command = record_command(raw_argv, source)
    base_branch, base_sha = resolve_base(source, args.base_branch, base_sha=args.base_sha)
    collect_sha, dirty = resolve_collect_sha(source, allow_dirty=args.allow_dirty)
    provenance_base = {
        "gitSha": collect_sha,
        "collectSha": collect_sha,
        "gitDirty": dirty,
        "node": versions["node"],
        "python": versions["python"],
        "pythonFull": versions["pythonFull"],
        "command": command,
        "pilotdeckRoot": "$PWD",
        "iterationsRequested": args.iterations,
        "hostOverheadDefinition": HOST_OVERHEAD_DEFINITION,
        "delayPolicy": delay_policy_label(zero_delays=not args.keep_delays, model_ms=args.model_ms),
        "configuredModelMs": args.model_ms,
        "metrics": "tools/agent-loop-perf/METRICS.md",
        "productDefaultTransport": "native",
        "baseBranch": base_branch,
        "baseSha": base_sha,
        "stdioSidecarCommand": stdio_sidecar_command,
        "rustSidecarBin": rust_identity["bin"] if rust_identity else None,
        "rustSidecarTarget": rust_identity["target"] if rust_identity else None,
        "rustSidecarSha256": rust_identity["sha256"] if rust_identity else None,
        "tcpSidecarCommand": (args.pilotdeck_tcp_sidecar_cmd or "").strip() or None,
    }
    mock_process, mock_url = start_mock()
    started = datetime.now(timezone.utc)
    try:
        with tempfile.TemporaryDirectory(prefix="pilotdeck-agent-loop-perf-") as temporary:
            work = Path(temporary)
            pending: list[tuple[str, dict[str, Any], datetime]] = []
            for transport in transports:
                transport_started = datetime.now(timezone.utc)
                report = run_transport(
                    transport=transport,
                    source=source,
                    scenarios=scenarios,
                    iterations=args.iterations,
                    timeout_seconds=args.adapter_timeout_seconds,
                    work=work,
                    mock=mock_url,
                    zero_delays=not args.keep_delays,
                    model_ms=args.model_ms,
                    tcp_sidecar_cmd=args.pilotdeck_tcp_sidecar_cmd,
                    tcp_host=args.pilotdeck_tcp_host,
                    tcp_port=args.pilotdeck_tcp_port,
                    stdio_sidecar_command=stdio_sidecar_command,
                    rust_sidecar_bin=rust_bin,
                )
                pending.append((transport, report, transport_started))
            native_report = next(
                (
                    report
                    for _name, report, _started in pending
                    if report.get("harnessTransport") == "native" or report.get("transport") == "native"
                ),
                None,
            )
            for transport, report, transport_started in pending:
                annotate_d4(report, native_report)
                provenance = {
                    **provenance_base,
                    "startedAt": transport_started.isoformat(),
                    "finishedAt": datetime.now(timezone.utc).isoformat(),
                }
                dest = output / f"{transport}.json"
                write_transport_evidence(dest, report, provenance=provenance)
                print(json.dumps({
                    "event": "wrote",
                    "transport": report["transport"],
                    "path": str(dest),
                    "primaryBaseline": report["primaryBaseline"],
                    "excludedFromPrimary": report["excludedFromPrimary"],
                }, ensure_ascii=False), flush=True)
    finally:
        stop_process(mock_process)
    summary = {
        "output": str(output),
        "transports": transports,
        "scenarios": scenario_names,
        "iterations": args.iterations,
        "startedAt": started.isoformat(),
        "finishedAt": datetime.now(timezone.utc).isoformat(),
        "provenance": provenance_base,
    }
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
