"""Run and compare PilotDeck native and sidecar AgentLoop adapters."""
from __future__ import annotations

import argparse
import json
import os
import shlex
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from trace import (
    Difference,
    compare_baseline_trace_details,
    compare_continuable_trace_details,
    compare_trace_details,
    load_trace,
    validate_production_sidecar_proof,
    validate_trace_expectations,
    write_report,
)

ROOT = Path(__file__).resolve().parent
SIDECAR_TRANSPORTS = frozenset({"stdio", "tcp"})
# The production Gateway suite is a release gate. Keep this count and the
# required id set in lockstep so a full run cannot silently shrink or grow.
PILOTDECK_GATEWAY_GATE_SCENARIO_COUNT = 53

# The production Gateway suite is a release gate. Keep this list separate
# from filters so deleting or silently renaming a scenario cannot turn a full
# run into a smaller passing run.
REQUIRED_GATEWAY_SCENARIOS = frozenset({
    "pure_text", "single_tool", "multiple_tool", "tool_error", "permission_denial",
    "max_turns", "deadline", "cancel", "image", "checkpoint_resume",
    "permission_allow", "permission_ask_approve", "permission_ask_deny", "can_prompt_false",
    "multi_tool_ordered", "multi_tool_mixed_permission", "multi_tool_mixed_error", "large_tool_result",
    "tool_retryable_error", "tool_non_retryable_error", "model_retryable_error", "model_non_retryable_error",
    "malformed_model_response", "stream_interruption", "cancel_during_tool", "deadline_during_tool",
    "multimodal_image_and_text", "allowed_read_files", "denied_read_files", "write_snapshot_resume", "auto_compact",
    "plan_mode_host_policy", "plan_mode_bypass_host_policy",
    "sidecar_budget_limit", "sidecar_elicitation", "sidecar_elicitation_execution", "sidecar_sdk_tool_progress",
    "sidecar_live_steer", "sidecar_durable_compaction", "sidecar_full_request_compaction_budget",
    "sidecar_projected_request_compaction_budget", "sidecar_seed_read_state", "sidecar_live_model_stream",
    "sidecar_model_metadata", "sidecar_empty_system_prompt", "sidecar_additional_working_directories",
    "sidecar_continuable_followup_live", "sidecar_continuable_followup_cold", "sidecar_parent_close_after_admission",
    "sidecar_one_shot_subagent_success", "sidecar_one_shot_subagent_failure",
    "sidecar_one_shot_parent_abort_after_admission", "sidecar_one_shot_parent_close_after_admission",
})
if len(REQUIRED_GATEWAY_SCENARIOS) != PILOTDECK_GATEWAY_GATE_SCENARIO_COUNT:
    raise RuntimeError(
        "REQUIRED_GATEWAY_SCENARIOS is out of sync with "
        f"PILOTDECK_GATEWAY_GATE_SCENARIO_COUNT={PILOTDECK_GATEWAY_GATE_SCENARIO_COUNT}"
    )


@dataclass(frozen=True)
class TcpSidecarTarget:
    """Resolved TCP sidecar listener for a parity run.

    `start_command` is set when the harness must spawn the listener. It is
    None when the caller already has a process bound to host/port (reuse,
    including a future Rust sidecar).
    """

    host: str
    port: int
    start_command: str | None


def resolve_sidecar_transport(cli_value: str | None, env: dict[str, str] | None = None) -> str:
    """Select the sidecar deployment transport from CLI or harness env.

    Product default remains native. Sidecar default remains stdio. Accept only
    explicit harness flags/env so a leftover PILOTDECK_AGENT_LOOP_TRANSPORT
    cannot silently retarget the gate.
    """
    source = env if env is not None else os.environ
    raw = (
        (cli_value if cli_value is not None else "")
        or source.get("PARITY_SIDECAR_TRANSPORT", "")
        or source.get("PILOTDECK_PARITY_SIDECAR_TRANSPORT", "")
        or "stdio"
    ).strip().lower()
    if raw not in SIDECAR_TRANSPORTS:
        raise ValueError(f"sidecar transport must be stdio or tcp, got {raw!r}")
    return raw


def default_ts_tcp_sidecar_command(source: Path) -> str:
    return f"node {shlex.quote(str((source / 'dist/src/cli/pilotdeck-agent-loop-sidecar.js').resolve()))}"


def allocate_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        return int(sock.getsockname()[1])


def resolve_tcp_sidecar_target(
    *,
    host: str | None,
    port: int | None,
    command: str | None,
    source: Path,
    allocate_port: Any = allocate_loopback_port,
) -> TcpSidecarTarget:
    provided_host = (host or "").strip() or None
    if (provided_host is None) != (port is None):
        raise ValueError("tcp sidecar reuse requires both --pilotdeck-tcp-host and --pilotdeck-tcp-port")
    if provided_host is not None:
        if not isinstance(port, int) or isinstance(port, bool) or port < 1 or port > 65_535:
            raise ValueError("PILOTDECK_AGENT_LOOP_TCP_PORT must be an integer between 1 and 65535.")
        return TcpSidecarTarget(provided_host, port, None)
    start_command = (command or default_ts_tcp_sidecar_command(source)).strip()
    if not start_command:
        raise ValueError("tcp sidecar command must not be empty")
    return TcpSidecarTarget("127.0.0.1", int(allocate_port()), start_command)


def wait_for_tcp(host: str, port: int, timeout_seconds: float = 5) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: OSError | None = None
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.2):
                return
        except OSError as error:
            last_error = error
            time.sleep(0.05)
    detail = last_error.strerror if last_error else "not listening"
    raise RuntimeError(f"TCP sidecar did not become ready on {host}:{port}: {detail}")


def start_tcp_sidecar(target: TcpSidecarTarget, cwd: Path, env: dict[str, str]) -> subprocess.Popen[str]:
    if not target.start_command:
        raise ValueError("TCP sidecar reuse does not start a process")
    child_env = env.copy()
    child_env["PILOTDECK_AGENT_LOOP_TCP_HOST"] = target.host
    child_env["PILOTDECK_AGENT_LOOP_TCP_PORT"] = str(target.port)
    # The sidecar is the listener. It must not inherit a host transport selection
    # that would make a Rust/TS binary try to connect instead of listen.
    child_env.pop("PILOTDECK_AGENT_LOOP_TRANSPORT", None)
    process = subprocess.Popen(
        shlex.split(target.start_command),
        cwd=cwd,
        env=child_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        wait_for_tcp(target.host, target.port)
    except Exception:
        process.kill()
        stdout, stderr = process.communicate()
        detail = (stderr or stdout or "").strip().splitlines()[-8:]
        raise RuntimeError(
            f"TCP sidecar failed to listen on {target.host}:{target.port}: {' | '.join(detail)}"
        ) from None
    return process


def stop_process(process: subprocess.Popen[str] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()


# Baseline policy is scenario-specific. Keeping it keyed by scenario id avoids
# silently dropping an entire suite when main already supports part of it.
BASELINE_COMPARISONS: dict[str, dict[str, Any]] = {
    # Current runtime context is a declared SDK composition surface. The
    # budget may differ only when the trace carries host-linked evidence.
    "checkpoint_resume": {"mode": "extension", "allowEvidencedBudgetDrift": True},
    "write_snapshot_resume": {"mode": "extension", "allowEvidencedBudgetDrift": True},
    "auto_compact": {"mode": "extension", "expected": {"terminalOutcome": "failed", "stopReason": "prompt_too_long"}, "allowedDifferences": [{
        "pathSuffix": "compactionCompletedCount", "baseline": 0, "current": 1,
    }]},
    # Current Gateway aborts the active session before it durably publishes a
    # timeout. This closes the historical main race where the visible timeout
    # could be emitted without a durable AgentLoop terminal. The extension is
    # intentionally narrow: the visible timeout remains shared, while the
    # terminal fields below prove durable-before-visible for both transports.
    "deadline": {"mode": "extension", "allowedDifferencesByAdapter": {
        "pilotdeck-current-native": [
            {"path": "trace.partialOrder.left.durable_status_missing.turn_timeout[0]", "baseline": "durable_before_visible", "current": "missing"},
            {"pathSuffix": "durableStopReason", "baseline": None, "current": "aborted_streaming"},
            {"pathSuffix": "resultType", "baseline": None, "current": "aborted"},
        ],
        "pilotdeck-current-sidecar": [
            {"path": "trace.partialOrder.left.durable_status_missing.turn_timeout[0]", "baseline": "durable_before_visible", "current": "missing"},
        ],
    }},
    "deadline_during_tool": {"mode": "extension", "allowedDifferences": [
        {"path": "trace.partialOrder.left.durable_status_missing.turn_timeout[0]", "baseline": "durable_before_visible", "current": "missing"},
    ]},
    "sidecar_live_steer": {"mode": "extension", "allowedDifferences": [
        {"path": "trace.partialOrder.left.durable_steer_missing.parity-steer-1[0]", "baseline": "durable_before_applied", "current": "missing"},
    ]},
    "plan_mode_host_policy": {"mode": "unavailable", "reason": "main lacks the host-owned plan-mode lifecycle exercised by this scenario"},
    "plan_mode_bypass_host_policy": {"mode": "unavailable", "reason": "main lacks the host-owned plan-mode lifecycle exercised by this scenario"},
    "sidecar_budget_limit": {"mode": "unavailable", "reason": "main Gateway has no ModelBudgetPort capability"},
    "sidecar_elicitation": {"mode": "unavailable", "reason": "main Gateway cannot advertise elicitation availability as a sidecar capability"},
    "sidecar_elicitation_execution": {"mode": "unavailable", "reason": "main Gateway cannot route host-backed elicitation through a sidecar capability"},
    "sidecar_sdk_tool_progress": {"mode": "unavailable", "reason": "main Gateway has no SDK session progress control"},
    "sidecar_durable_compaction": {"mode": "unavailable", "reason": "main cannot inject the durable compaction provider required by this scenario"},
    "sidecar_full_request_compaction_budget": {"mode": "unavailable", "reason": "main has no request-level compaction budget capability"},
    "sidecar_projected_request_compaction_budget": {"mode": "unavailable", "reason": "main has no projected-request compaction budget capability"},
    "sidecar_seed_read_state": {"mode": "unavailable", "reason": "main Gateway client does not expose seed_read_state"},
    "sidecar_empty_system_prompt": {"mode": "unavailable", "reason": "main Gateway has no SDK session system-prompt control"},
    "sidecar_additional_working_directories": {"mode": "unavailable", "reason": "main Gateway has no SDK additional-working-directories control"},
    "sidecar_continuable_followup_live": {"mode": "unavailable", "reason": "main has no continuable subagent lifecycle"},
    "sidecar_continuable_followup_cold": {"mode": "unavailable", "reason": "main has no continuable subagent lifecycle"},
    "sidecar_parent_close_after_admission": {"mode": "unavailable", "reason": "main has no one-shot subagent admission lifecycle"},
    "sidecar_one_shot_subagent_success": {"mode": "unavailable", "reason": "main has no one-shot subagent capability"},
    "sidecar_one_shot_subagent_failure": {"mode": "unavailable", "reason": "main has no one-shot subagent capability"},
    "sidecar_one_shot_parent_abort_after_admission": {"mode": "unavailable", "reason": "main has no one-shot subagent admission lifecycle"},
    "sidecar_one_shot_parent_close_after_admission": {"mode": "unavailable", "reason": "main has no one-shot subagent admission lifecycle"},
}

SAME_VERSION_COMPARISONS: dict[str, dict[str, Any]] = {
    "deadline": {"mode": "extension", "allowedDifferences": [
        {"pathSuffix": "durableStopReason", "baseline": "aborted_streaming", "current": None},
        {"pathSuffix": "resultType", "baseline": "aborted", "current": None},
    ]},
    # Native and stdio sidecar continuable runs share model-visible behavior
    # but independently observe parent/child actors. The dedicated comparator
    # keeps actor-local core order and all semantic values strict while allowing
    # only the reviewed generated metadata and state insertion positions.
    "sidecar_continuable_followup_live": {
        "mode": "extension",
        "comparator": "continuable_actor_v1",
        "allowedGeneratedMetadata": [
            "invocationId", "sequence", "startedAt", "completedAt",
            "child.blockId", "child.timeline.id",
        ],
        "allowIndependentActorOrdering": True,
        "allowedStateInsertionKinds": ["context.budget", "agent.status:turn_continued", "durable.status:context_budget"],
    },
    "sidecar_continuable_followup_cold": {
        "mode": "extension",
        "comparator": "continuable_actor_v1",
        "allowedGeneratedMetadata": [
            "invocationId", "sequence", "startedAt", "completedAt",
            "child.blockId", "child.timeline.id",
        ],
        "allowIndependentActorOrdering": True,
        "allowedStateInsertionKinds": ["context.budget", "agent.status:turn_continued", "durable.status:context_budget"],
    },
}

# These are SDK-only Gateway controls, not scenario-authored tools. Their
# existence is asserted by SDK coverage; main-baseline parity removes only this
# explicit catalog delta and still compares every shared tool schema exactly.
_SDK_EXTENSION_TOOLS = ["create_goal", "get_goal", "lsp", "send_message", "subagent", "update_goal"]

# SDK adds an explicit Gateway sandbox execution profile and a configurable
# subagent depth cap. These two existing tools retain their complete schemas;
# only their model-visible descriptions differ from main. Keep both complete
# strings here so an unreviewed description change remains a baseline failure.
_SDK_TOOL_DESCRIPTION_CONTRACTS: dict[str, dict[str, str]] = {
    "agent": {
        "baseline": (
            "Launch a new subagent to handle a focused multi-step task.\n\n"
            "Use this tool when a bounded piece of work would benefit from an autonomous helper instead of keeping every intermediate step in the parent agent's context.\n\n"
            "Provide:\n"
            "- `description`: a short 3-5 word label for the task.\n"
            "- `prompt`: the full directive for the subagent. Write it like a complete briefing: include the goal, relevant context, constraints, and what good output looks like.\n"
            "- `subagent_type` (optional): choose a built-in preset. If omitted, `general-purpose` is used.\n\n"
            "Available built-in subagent types:\n"
            "- general-purpose: General-purpose subagent for complex research/synthesis tasks. Has broad parent-tool access except nested subagent launch. Tools: all parent tools except nested agent launch.\n"
            "- explore: Read-only exploration subagent. Inspects files, runs grep/glob, and may run safe shell commands. Cannot edit files. Tools: read_file, grep, glob, bash.\n"
            "- plan: Read-only planning subagent. Inspects code via read/grep/glob and produces a step-by-step plan. Tools: read_file, grep, glob.\n\n"
            "The subagent returns one structured report with these sections: `Scope`, `Result`, `Key files`, `Files changed`, and `Issues`.\n\n"
            "Runtime behavior:\n"
            "- Multiple independent agent calls in one assistant message may run concurrently; batch sibling investigations when their scopes do not depend on each other.\n"
            "- Inside the AgentLoop, this runs a real forked subagent with its own scoped tool loop.\n"
            "- In stand-alone runtimes and some tests, it falls back to a single model call that preserves the same high-level subagent intent."
        ),
        "current": (
            "Launch a new subagent to handle a focused multi-step task.\n\n"
            "Use this tool when a bounded piece of work would benefit from an autonomous helper instead of keeping every intermediate step in the parent agent's context.\n\n"
            "Provide:\n"
            "- `description`: a short 3-5 word label for the task.\n"
            "- `prompt`: the full directive for the subagent. Write it like a complete briefing: include the goal, relevant context, constraints, and what good output looks like.\n"
            "- `subagent_type` (optional): choose a built-in preset. If omitted, `general-purpose` is used.\n\n"
            "Available built-in subagent types:\n"
            "- general-purpose: General-purpose subagent for complex research/synthesis tasks. Has broad parent-tool access; nested delegation follows the configured depth cap. Tools: all parent tools except nested agent launch.\n"
            "- explore: Read-only exploration subagent. Inspects files, runs grep/glob, and may run safe shell commands. Cannot edit files. Tools: read_file, grep, glob, bash.\n"
            "- plan: Read-only planning subagent. Inspects code via read/grep/glob and produces a step-by-step plan. Tools: read_file, grep, glob.\n\n"
            "The subagent returns one structured report with these sections: `Scope`, `Result`, `Key files`, `Files changed`, and `Issues`.\n\n"
            "Runtime behavior:\n"
            "- Multiple independent agent calls in one assistant message may run concurrently; batch sibling investigations when their scopes do not depend on each other.\n"
            "- Inside the AgentLoop, this runs a real forked subagent with its own scoped tool loop.\n"
            "- In stand-alone runtimes and some tests, it falls back to a single model call that preserves the same high-level subagent intent."
        ),
    },
    "execute_code": {
        "baseline": (
            "Run a local Python 3 script that can call a small allow-list of PilotDeck tools via `import pilotdeck_tools`. "
            "The script runs from the workspace cwd and inherits the same runtime environment as normal tools such as bash, including configured API, proxy, PATH, virtualenv, and conda variables; do not print secrets or dump the full environment. "
            "Only the script's final stdout/stderr summary is returned to the model; intermediate tool results stay inside the script. "
            "Available helper functions: web_fetch, read_file, write_file, edit_file, grep, glob, bash. "
            "Use normal Python control flow to orchestrate tools: loops for batch work, conditionals for branching, data structures for aggregation, and try/except around individual helper calls when one failure should not abort the whole script. Helper failures raise RuntimeError. You can chain helper results, e.g. grep -> read_file -> edit_file. Print only the concise final result needed by the agent. "
            "Before modifying an existing file, call read_file first so PilotDeck can verify freshness. Prefer edit_file for targeted changes and write_file for new files or complete rewrites. "
            "Notebook edits, agent, task tools, MCP tools, and execute_code itself are not available."
        ),
        "current": (
            "Run a local Python 3 script that can call a small allow-list of PilotDeck tools via `import pilotdeck_tools`. "
            "The script runs through a Gateway-selected host sandbox runner. It receives only the private RPC/module environment needed for this execution, not the Gateway process environment, provider credentials, or arbitrary host variables. "
            "Only the script's final stdout/stderr summary is returned to the model; intermediate tool results stay inside the script. "
            "Available helper functions: web_fetch, read_file, write_file, edit_file, grep, glob, bash. "
            "Use normal Python control flow to orchestrate tools: loops for batch work, conditionals for branching, data structures for aggregation, and try/except around individual helper calls when one failure should not abort the whole script. Helper failures raise RuntimeError. You can chain helper results, e.g. grep -> read_file -> edit_file. Print only the concise final result needed by the agent. "
            "Before modifying an existing file, call read_file first so PilotDeck can verify freshness. Prefer edit_file for targeted changes and write_file for new files or complete rewrites. "
            "Notebook edits, agent, task tools, MCP tools, and execute_code itself are not available."
        ),
    },
}


def baseline_comparison(scenario: dict[str, Any]) -> dict[str, Any]:
    inline = scenario.get("baselineComparison")
    if isinstance(inline, dict):
        return inline
    configured = BASELINE_COMPARISONS.get(str(scenario.get("scenarioId")), {"mode": "shared"})
    return {
        "extensionTools": _SDK_EXTENSION_TOOLS,
        "toolDescriptionContracts": _SDK_TOOL_DESCRIPTION_CONTRACTS,
        **configured,
    }

def baseline_not_applicable_reason(scenario: dict[str, Any]) -> str | None:
    comparison = baseline_comparison(scenario)
    if comparison.get("mode") == "unavailable":
        reason = comparison.get("reason")
        if not isinstance(reason, str) or not reason:
            raise ValueError(f"{scenario.get('scenarioId')}: unavailable baseline comparison requires a reason")
        return reason
    return None


def baseline_comparison_mode(scenario: dict[str, Any]) -> str:
    comparison = baseline_comparison(scenario)
    mode = comparison.get("mode", "shared")
    if mode not in {"shared", "extension", "unavailable"}:
        raise ValueError(f"{scenario.get('scenarioId')}: invalid baseline comparison mode {mode!r}")
    return str(mode)


def declared_extension_matches(
    scenario: dict[str, Any],
    differences: list[Difference],
    *,
    comparison: dict[str, Any] | None = None,
    adapter: str | None = None,
) -> bool:
    """Accept only exhaustively declared baseline/current differences.

    An extension is not a whole-scenario waiver. Each observed semantic
    difference needs a matching contract with an exact baseline/current value;
    declarations that are not observed are also failures, preventing stale
    allowlists from silently masking a newly shared behavior.
    """
    comparison = comparison or baseline_comparison(scenario)
    if not differences and comparison.get("allowEvidencedBudgetDrift") is True:
        return True
    if comparison.get("comparator") == "continuable_actor_v1":
        # compare_continuable_trace_details has already enforced the narrow
        # actor/state contract and returns no semantic differences only when
        # every non-waived field passed strict comparison.
        return not differences
    per_adapter = comparison.get("allowedDifferencesByAdapter")
    allowed = per_adapter.get(adapter) if isinstance(per_adapter, dict) and adapter else comparison.get("allowedDifferences")
    if not isinstance(allowed, list):
        return False
    unmatched = list(differences)
    for expected in allowed:
        if not isinstance(expected, dict):
            return False
        exact_path = expected.get("path")
        path_suffix = expected.get("pathSuffix")
        if not isinstance(exact_path, str) and not isinstance(path_suffix, str):
            return False
        if isinstance(path_suffix, str) and path_suffix.startswith("durable_"):
            return False
        found = next((
            index for index, difference in enumerate(unmatched)
            if (difference.path == exact_path if isinstance(exact_path, str) else difference.path.endswith(path_suffix))
            and difference.left == expected.get("baseline")
            and difference.right == expected.get("current")
        ), None)
        if found is None:
            return False
        unmatched.pop(found)
    return not unmatched


def scenario_for_adapter(scenario: dict[str, Any], adapter: str) -> dict[str, Any]:
    if adapter != "pilotdeck-baseline-native":
        return scenario
    comparison = baseline_comparison(scenario)
    expected = comparison.get("expected")
    if not isinstance(expected, dict):
        return scenario
    baseline = dict(scenario)
    baseline["expected"] = expected
    baseline.pop("expectedByPair", None)
    baseline.pop("expectedByAdapter", None)
    return baseline


def resolve_ref(root: Path, ref: str) -> str:
    result = subprocess.run(
        ["git", "rev-parse", ref], cwd=root, text=True, capture_output=True, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"cannot resolve PilotDeck ref {ref}: {result.stderr.strip()}")
    return result.stdout.strip()


def load_scenarios(path: Path, selected: str, suite: str) -> list[dict[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    candidates = document.get("scenarios") if isinstance(document, dict) else None
    if not isinstance(candidates, list):
        raise TypeError("scenario file must contain a scenarios list")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for scenario in candidates:
        if not isinstance(scenario, dict) or "pilotdeck" not in (scenario.get("pairs") or []):
            continue
        scenario_id = scenario.get("scenarioId")
        if not isinstance(scenario_id, str) or not scenario_id:
            raise ValueError("PilotDeck scenario is missing a non-empty scenarioId")
        if scenario_id in seen:
            raise ValueError(f"duplicate PilotDeck scenario: {scenario_id}")
        seen.add(scenario_id)
        if selected != "all" and scenario_id != selected:
            continue
        if suite != "all" and scenario.get("suite") != suite:
            continue
        result.append(scenario)
    if selected != "all" and not result:
        raise ValueError(f"unknown PilotDeck scenario: {selected}")
    if selected == "all" and suite == "all":
        actual = {str(s["scenarioId"]) for s in result}
        missing = sorted(REQUIRED_GATEWAY_SCENARIOS - actual)
        if missing:
            raise ValueError(f"required PilotDeck scenarios are missing: {', '.join(missing)}")
        extra = sorted(actual - REQUIRED_GATEWAY_SCENARIOS)
        if extra:
            raise ValueError(f"unexpected PilotDeck gate scenarios: {', '.join(extra)}")
        if len(result) != PILOTDECK_GATEWAY_GATE_SCENARIO_COUNT:
            raise ValueError(
                f"PilotDeck gate requires {PILOTDECK_GATEWAY_GATE_SCENARIO_COUNT} scenarios, "
                f"found {len(result)}"
            )
    return result


def start_mock() -> tuple[subprocess.Popen[str], str]:
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "mock_backend.py"), "--port", "0"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert process.stdout is not None
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        line = process.stdout.readline()
        if line:
            payload = json.loads(line)
            return process, f"http://127.0.0.1:{int(payload['port'])}"
        if process.poll() is not None:
            break
    process.kill()
    raise RuntimeError("PilotDeck parity mock did not become ready")


def materialize_baseline(root: Path, ref: str, parent: Path) -> tuple[Path, bool]:
    if ref in {"", "HEAD", "working-tree"}:
        return root, False
    target = parent / f"{root.name}-{ref.replace('/', '_')}"
    result = subprocess.run(
        ["git", "worktree", "add", "--detach", str(target), ref],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"cannot materialize PilotDeck at {ref}: {result.stderr.strip()}")
    source = root / "node_modules"
    destination = target / "node_modules"
    if source.exists() and not destination.exists():
        destination.symlink_to(source, target_is_directory=True)
    return target, True


def remove_baseline(root: Path, target: Path, created: bool) -> None:
    if created:
        subprocess.run(
            ["git", "worktree", "remove", "--force", str(target)],
            cwd=root,
            text=True,
            capture_output=True,
            check=False,
        )


def prepare_baseline(root: Path) -> None:
    if (root / "package.json").exists() and not (root / "dist").exists():
        result = subprocess.run(["pnpm", "build"], cwd=root, text=True, capture_output=True, check=False)
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()
            raise RuntimeError(f"PilotDeck baseline build failed: {detail}")


def adapter_env(
    scenario: dict[str, Any],
    mode: str,
    source: Path,
    mock: str,
    output: Path,
    ref: str,
    invocation_id: str,
    sidecar_transport: str = "stdio",
    tcp_target: TcpSidecarTarget | None = None,
) -> dict[str, str]:
    env = os.environ.copy()
    env.update({
        "PARITY_SCENARIO_FILE": str(ROOT / "scenarios.json"),
        "PARITY_SCENARIO_ID": str(scenario["scenarioId"]),
        "PARITY_Q": str(scenario["q"]),
        "PARITY_SCENARIO_JSON": json.dumps(scenario, ensure_ascii=False),
        "PARITY_MOCK_BASE_URL": mock,
        "PARITY_TRACE_OUT": str(output),
        "PARITY_SOURCE_ROOT": str(source.resolve()),
        "PARITY_SOURCE_REF": ref,
        "PARITY_MODE": mode,
        "PARITY_PILOTDECK_ROOT": str(source.resolve()),
        "PARITY_SIDECAR_TRANSPORT": sidecar_transport,
        # Keep mock side effects and cancellation state isolated per adapter
        # invocation. The mock server is shared across a run, but a trace must
        # never inherit effects from another scenario or comparison pair.
        "PARITY_RUN_KEY": f"{mode}-{scenario['scenarioId']}-{ref.replace('/', '_')}",
        "PARITY_INVOCATION_ID": invocation_id,
    })
    if sidecar_transport == "tcp" and tcp_target is not None:
        env["PARITY_TCP_HOST"] = tcp_target.host
        env["PARITY_TCP_PORT"] = str(tcp_target.port)
    if mode in {"native", "sidecar"}:
        env["PARITY_RUNTIME_ROOT"] = str(output.parent / ".runtime" / str(scenario["scenarioId"]))
    return env


def run_adapter(
    mode: str,
    source: Path,
    ref: str,
    scenario: dict[str, Any],
    mock: str,
    output: Path,
    surface: str,
    timeout_seconds: float,
    override: str | None,
    sidecar_transport: str = "stdio",
    tcp_target: TcpSidecarTarget | None = None,
) -> str:
    invocation_id = uuid.uuid4().hex
    if output.exists():
        output.unlink()
    started_ns = time.time_ns()
    if override:
        command = override
    elif surface == "gateway":
        command = f"node {shlex.quote(str(ROOT / 'adapters' / 'pilotdeck_gateway_impl.mjs'))}"
    elif mode == "native":
        command = f"node {shlex.quote(str(ROOT / 'adapters' / 'pilotdeck_native_impl.mjs'))}"
    else:
        command = f"{shlex.quote(sys.executable)} {shlex.quote(str(ROOT / 'adapters' / 'pilotdeck_sidecar_impl.py'))}"
    scenario_timeout = scenario.get("adapterTimeoutSeconds")
    if scenario_timeout is not None:
        if not isinstance(scenario_timeout, (int, float)) or isinstance(scenario_timeout, bool) or scenario_timeout <= 0:
            return "BLOCKED: scenario adapterTimeoutSeconds must be a positive number"
        timeout_seconds = float(scenario_timeout)
    try:
        result = subprocess.run(
            shlex.split(command),
            cwd=source,
            env=adapter_env(
                scenario, mode, source, mock, output, ref, invocation_id,
                sidecar_transport=sidecar_transport,
                tcp_target=tcp_target,
            ),
            text=True,
            capture_output=True,
            check=False,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        detail = error.stderr or error.stdout or ""
        return f"BLOCKED: adapter timeout ({str(detail).strip()[-300:]})"
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()[-8:]
        return f"BLOCKED: adapter exited {result.returncode}: {' | '.join(detail)}"
    if not output.exists():
        return "BLOCKED: adapter did not write trace"
    if output.stat().st_mtime_ns < started_ns:
        return "BLOCKED: adapter trace predates this invocation"
    records = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not records or any(record.get("invocationId") != invocation_id for record in records):
        return "BLOCKED: adapter trace does not match this invocation"
    if surface == "gateway" and mode == "sidecar":
        required_modules = {str(module) for module in scenario.get("requiredSidecarModules") or []}
        required_operations = {str(operation) for operation in scenario.get("requiredSidecarOperations") or []}
        proof_errors = validate_production_sidecar_proof(
            records,
            required_modules,
            required_operations,
            expected_transport=sidecar_transport,
        )
        if proof_errors:
            return f"BLOCKED: {'; '.join(proof_errors)}"
    return "PASS"


def known_gap_matches(scenario: dict[str, Any], differences: list[Difference]) -> bool:
    expected = sorted(str(item) for item in scenario.get("expectedDifferencePaths") or [])
    return bool(expected) and sorted(item.path for item in differences) == expected


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pilotdeck-root", type=Path, required=True)
    parser.add_argument("--pilotdeck-baseline", default="working-tree")
    parser.add_argument("--scenario", default="all")
    parser.add_argument("--suite", default="all")
    parser.add_argument("--comparison", choices=("same-version", "baseline", "both"), default="same-version")
    parser.add_argument("--surface", "--pilotdeck-surface", choices=("loop", "gateway"), default="gateway")
    parser.add_argument("--scenario-file", type=Path, default=ROOT / "scenarios.json")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts")
    parser.add_argument("--pilotdeck-native-cmd")
    parser.add_argument("--pilotdeck-sidecar-cmd")
    parser.add_argument(
        "--sidecar-transport",
        "--pilotdeck-sidecar-transport",
        choices=sorted(SIDECAR_TRANSPORTS),
        default=None,
        help="Sidecar deployment transport. Default: stdio, or PARITY_SIDECAR_TRANSPORT.",
    )
    parser.add_argument("--pilotdeck-tcp-host", help="Reuse an already-listening TCP sidecar on this host.")
    parser.add_argument("--pilotdeck-tcp-port", type=int, help="Reuse an already-listening TCP sidecar on this port.")
    parser.add_argument(
        "--pilotdeck-tcp-sidecar-cmd",
        help=(
            "Command that listens on PILOTDECK_AGENT_LOOP_TCP_HOST/PORT. "
            "Default: node <pilotdeck-root>/dist/src/cli/pilotdeck-agent-loop-sidecar.js"
        ),
    )
    parser.add_argument("--adapter-timeout-seconds", type=float, default=30)
    args = parser.parse_args()
    sidecar_transport = resolve_sidecar_transport(args.sidecar_transport)
    tcp_target: TcpSidecarTarget | None = None
    if sidecar_transport == "tcp":
        tcp_target = resolve_tcp_sidecar_target(
            host=args.pilotdeck_tcp_host,
            port=args.pilotdeck_tcp_port,
            command=args.pilotdeck_tcp_sidecar_cmd,
            source=args.pilotdeck_root,
        )

    scenarios = load_scenarios(args.scenario_file, args.scenario, args.suite)
    args.output.mkdir(parents=True, exist_ok=True)
    mock_process, mock_url = start_mock()
    tcp_process: subprocess.Popen[str] | None = None
    blocked: list[str] = []
    failed: list[str] = []
    oracle_failures: list[str] = []
    known_gaps: list[str] = []
    expected_extensions: list[str] = []
    not_applicable: list[str] = []
    warnings: list[str] = []
    try:
        if tcp_target is not None and tcp_target.start_command:
            tcp_process = start_tcp_sidecar(tcp_target, args.pilotdeck_root, os.environ.copy())
        with tempfile.TemporaryDirectory(prefix="pilotdeck-agent-loop-parity-") as temporary:
            baseline, created = materialize_baseline(args.pilotdeck_root, args.pilotdeck_baseline, Path(temporary))
            try:
                if args.comparison in {"baseline", "both"}:
                    prepare_baseline(baseline)
                for scenario in scenarios:
                    sid = str(scenario["scenarioId"])
                    jobs: dict[str, tuple[str, Path, str, str | None]] = {}
                    if args.comparison in {"same-version", "both"}:
                        jobs.update({
                            "pilotdeck-current-native": ("native", args.pilotdeck_root, "working-tree", args.pilotdeck_native_cmd),
                            "pilotdeck-current-sidecar": ("sidecar", args.pilotdeck_root, "working-tree", args.pilotdeck_sidecar_cmd),
                        })
                    if args.comparison in {"baseline", "both"}:
                        reason = baseline_not_applicable_reason(scenario)
                        if reason:
                            not_applicable.append(f"{sid}: {reason}")
                        else:
                            jobs.update({
                                "pilotdeck-baseline-native": ("native", baseline, args.pilotdeck_baseline, args.pilotdeck_native_cmd),
                                "pilotdeck-current-native": ("native", args.pilotdeck_root, "working-tree", args.pilotdeck_native_cmd),
                                "pilotdeck-current-sidecar": ("sidecar", args.pilotdeck_root, "working-tree", args.pilotdeck_sidecar_cmd),
                            })
                    traces: dict[str, Path] = {}
                    for name, (mode, source, ref, override) in jobs.items():
                        trace_path = args.output / f"{sid}.{name}.jsonl"
                        status = run_adapter(
                            mode, source, ref, scenario, mock_url, trace_path, args.surface,
                            args.adapter_timeout_seconds, override,
                            sidecar_transport=sidecar_transport,
                            tcp_target=tcp_target,
                        )
                        if status != "PASS":
                            blocked.append(f"{sid}/{name}: {status}")
                            continue
                        traces[name] = trace_path
                        oracle_scenario = scenario_for_adapter(scenario, name)
                        for failure in validate_trace_expectations(load_trace(trace_path), oracle_scenario, "pilotdeck", name):
                            oracle_failures.append(f"{sid}/{name}: {failure.path} expected={failure.left!r} actual={failure.right!r}")
                    comparisons = [
                        ("PilotDeck", "pilotdeck-current-native", "pilotdeck-current-sidecar", False),
                        ("PilotDeck baseline drift", "pilotdeck-baseline-native", "pilotdeck-current-native", True),
                        ("PilotDeck baseline sidecar drift", "pilotdeck-baseline-native", "pilotdeck-current-sidecar", True),
                    ]
                    for label, left_name, right_name, is_baseline in comparisons:
                        if left_name not in traces or right_name not in traces:
                            continue
                        same_version_contract = SAME_VERSION_COMPARISONS.get(sid, {"mode": "shared"})
                        comparison = (
                            compare_baseline_trace_details(
                                load_trace(traces[left_name]),
                                load_trace(traces[right_name]),
                                {**scenario, "baselineComparison": baseline_comparison(scenario)},
                            )
                            if is_baseline
                            else (
                                compare_continuable_trace_details(
                                    load_trace(traces[left_name]),
                                    load_trace(traces[right_name]),
                                )
                                if same_version_contract.get("comparator") == "continuable_actor_v1"
                                else compare_trace_details(load_trace(traces[left_name]), load_trace(traces[right_name]))
                            )
                        )
                        report = args.output / f"{sid}-{label.lower().replace(' ', '-')}.md"
                        write_report(report, f"{sid} {label}", traces[left_name], traces[right_name], comparison)
                        if comparison.format_warnings:
                            warnings.append(f"{sid}/{label}: {len(comparison.format_warnings)} warning(s)")
                        if not is_baseline and same_version_contract.get("mode") == "extension":
                            if declared_extension_matches(scenario, comparison.semantic, comparison=same_version_contract):
                                expected_extensions.append(
                                    f"{sid}/{label}: verified {len(comparison.semantic)} declared transport difference(s)"
                                )
                            else:
                                failed.append(
                                    f"{sid}/{label}: transport contract mismatch ({len(comparison.semantic)} semantic difference(s))"
                                )
                        elif is_baseline and baseline_comparison_mode(scenario) == "extension":
                            if declared_extension_matches(scenario, comparison.semantic, adapter=right_name):
                                expected_extensions.append(
                                    f"{sid}/{label}: verified {len(comparison.semantic)} declared extension difference(s)"
                                )
                            else:
                                failed.append(
                                    f"{sid}/{label}: extension contract mismatch ({len(comparison.semantic)} semantic difference(s))"
                                )
                        elif scenario.get("suite") == "known-gap":
                            if known_gap_matches(scenario, comparison.semantic):
                                known_gaps.append(f"{sid}/{label}: reproduced {len(comparison.semantic)} expected difference(s)")
                            else:
                                failed.append(f"{sid}/{label}: known-gap declaration mismatch")
                        elif comparison.semantic:
                            failed.append(f"{sid}/{label}: {len(comparison.semantic)} semantic difference(s)")
            finally:
                remove_baseline(args.pilotdeck_root, baseline, created)
    finally:
        stop_process(tcp_process)
        stop_process(mock_process)
    summary = {
        "scenarios": len(scenarios),
        "gateScenarioCount": PILOTDECK_GATEWAY_GATE_SCENARIO_COUNT,
        "sidecarTransport": sidecar_transport,
        "provenance": {
            "current": resolve_ref(args.pilotdeck_root, "HEAD"),
            "baseline": resolve_ref(args.pilotdeck_root, args.pilotdeck_baseline)
                if args.comparison in {"baseline", "both"} else None,
            "python": sys.version,
            "node": subprocess.run(["node", "--version"], text=True, capture_output=True, check=False).stdout.strip(),
        },
        "blocked": blocked,
        "failed": failed,
        "oracleFailures": oracle_failures,
        "knownGaps": known_gaps,
        "expectedExtensions": expected_extensions,
        "notApplicable": not_applicable,
        "formatWarnings": warnings,
        "output": str(args.output),
    }
    if args.scenario == "all" and args.suite == "all" and summary["scenarios"] != PILOTDECK_GATEWAY_GATE_SCENARIO_COUNT:
        blocked.append(
            f"summary.json scenarios={summary['scenarios']} does not match "
            f"gateScenarioCount={PILOTDECK_GATEWAY_GATE_SCENARIO_COUNT}"
        )
        summary["blocked"] = blocked
    (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if failed or oracle_failures:
        return 1
    return 2 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
