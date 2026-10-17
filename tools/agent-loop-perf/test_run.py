"""Unit tests for the AgentLoop performance baseline harness."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _load_perf():
    """Load this directory's run.py without claiming the shared module name ``run``."""
    name = "agent_loop_perf_run_under_test"
    cached = sys.modules.get(name)
    if cached is not None:
        return cached
    spec = importlib.util.spec_from_file_location(name, ROOT / "run.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load tools/agent-loop-perf/run.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


perf = _load_perf()


class PercentileTests(unittest.TestCase):
    def test_empty_is_none(self) -> None:
        self.assertIsNone(perf.percentile([], 50))

    def test_single_sample(self) -> None:
        self.assertEqual(perf.percentile([10], 95), 10.0)

    def test_linear_interpolation(self) -> None:
        samples = [float(item) for item in range(1, 31)]
        self.assertEqual(perf.percentile(samples, 50), 15.5)
        self.assertAlmostEqual(perf.percentile(samples, 95) or 0, 28.55)


class DelayPolicyTests(unittest.TestCase):
    def test_zeroes_delays_and_tool_delays(self) -> None:
        scenario, injected = perf.apply_delay_policy({
            "scenarioId": "deadline",
            "delays": {"modelMs": 5000, "toolMs": 10},
            "toolDelays": {"lookup": 80},
        })
        self.assertFalse(injected)
        self.assertEqual(scenario["delays"], {"modelMs": 0, "toolMs": 0})
        self.assertEqual(scenario["toolDelays"], {"lookup": 0})

    def test_keep_delays_marks_injected(self) -> None:
        scenario, injected = perf.apply_delay_policy(
            {"scenarioId": "cancel", "delays": {"modelMs": 100}},
            zero=False,
        )
        self.assertTrue(injected)
        self.assertEqual(scenario["delays"]["modelMs"], 100)

    def test_pure_text_has_no_injected_delay(self) -> None:
        _, injected = perf.apply_delay_policy({"scenarioId": "pure_text", "q": "What is the status?"})
        self.assertFalse(injected)

    def test_model_ms_overlay_sets_identical_delay_after_zeroing(self) -> None:
        scenario, injected = perf.apply_delay_policy(
            {
                "scenarioId": "pure_text",
                "delays": {"modelMs": 5000, "toolMs": 10},
                "toolDelays": {"lookup": 80},
            },
            model_ms=200,
        )
        self.assertTrue(injected)
        self.assertEqual(scenario["delays"]["modelMs"], 200)
        self.assertEqual(scenario["delays"]["toolMs"], 0)
        self.assertEqual(scenario["toolDelays"]["lookup"], 0)
        self.assertEqual(perf.delay_policy_label(zero_delays=True, model_ms=200), "zero+modelMs:200")


class ScenarioFixtureTests(unittest.TestCase):
    def test_default_scenarios_exist(self) -> None:
        loaded = perf.load_named_scenarios(
            ROOT.parent / "agent-loop-parity" / "scenarios.json",
            ["pure_text", "single_tool"],
        )
        self.assertEqual([item["scenarioId"] for item in loaded], ["pure_text", "single_tool"])
        for item in loaded:
            _, injected = perf.apply_delay_policy(item)
            self.assertFalse(injected)


class StdioSidecarTests(unittest.TestCase):
    def test_refuses_tcp_transport_with_stdio_command(self) -> None:
        with self.assertRaises(ValueError):
            perf.refuse_tcp_with_stdio_sidecar(
                ["stdio", "tcp"],
                "tools/agent-loop-parity/rust-stdio-sidecar.sh",
                None,
            )

    def test_refuses_tcp_flag_with_stdio_command(self) -> None:
        with self.assertRaises(ValueError):
            perf.refuse_tcp_with_stdio_sidecar(
                ["stdio"],
                "tools/agent-loop-parity/rust-stdio-sidecar.sh",
                "tools/agent-loop-parity/rust-tcp-sidecar.sh",
            )

    def test_stdio_only_is_allowed(self) -> None:
        perf.refuse_tcp_with_stdio_sidecar(
            ["native", "stdio"],
            "tools/agent-loop-parity/rust-stdio-sidecar.sh",
            None,
        )

    def test_main_refuses_before_collection(self) -> None:
        with self.assertRaises(ValueError):
            perf.main([
                "--pilotdeck-root", "/tmp",
                "--transports", "tcp",
                "--pilotdeck-stdio-sidecar-cmd", "tools/agent-loop-parity/rust-stdio-sidecar.sh",
                "--pilotdeck-tcp-sidecar-cmd", "tools/agent-loop-parity/rust-tcp-sidecar.sh",
                "--iterations", "1",
            ])

    def test_prepare_requires_same_name_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "pilotdeck-agent-loop-sidecar"
            target.write_bytes(b"rust-bin")
            link = root / "pilotdeck-agent-loop"
            link.symlink_to(target.name)
            identity = perf.prepare_rust_stdio_identity(
                "tools/agent-loop-parity/rust-stdio-sidecar.sh",
                str(link),
            )
            assert identity is not None
            self.assertEqual(identity["bin"], str(link))
            self.assertEqual(identity["target"], str(target.resolve()))
            self.assertEqual(len(identity["sha256"]), 64)
            direct = root / "pilotdeck-agent-loop-sidecar"
            with self.assertRaises(RuntimeError):
                perf.prepare_rust_stdio_identity(
                    "tools/agent-loop-parity/rust-stdio-sidecar.sh",
                    str(direct),
                )

    def test_proof_must_match_symlink_not_sidecar_name(self) -> None:
        expected = "/tmp/release/pilotdeck-agent-loop"
        good = [{"pid": 9, "bin": expected, "resolved": expected}]
        self.assertTrue(perf.proof_resolves_to_agent_loop(good, expected))
        followed = [{
            "pid": 9,
            "bin": expected,
            "resolved": "/tmp/release/pilotdeck-agent-loop-sidecar",
        }]
        self.assertFalse(perf.proof_resolves_to_agent_loop(followed, expected))

    def test_wrapper_and_trace_proof_loaders(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            trace = Path(temporary) / "turn.jsonl"
            trace.write_text(
                "\n".join([
                    json.dumps({"kind": "harness.proof", "state": "transport_selected"}),
                    json.dumps({
                        "kind": "harness.proof",
                        "state": "rust_sidecar_exec",
                        "pid": 4,
                        "bin": "/tmp/pilotdeck-agent-loop",
                        "resolved": "/tmp/pilotdeck-agent-loop",
                    }),
                ]) + "\n",
                encoding="utf-8",
            )
            proof = perf.exec_proof_path(trace)
            proof.write_text(
                json.dumps({
                    "pid": 4,
                    "bin": "/tmp/pilotdeck-agent-loop",
                    "resolved": "/tmp/pilotdeck-agent-loop",
                }) + "\n",
                encoding="utf-8",
            )
            self.assertEqual(perf.load_wrapper_exec_proof(trace)[0]["pid"], 4)
            self.assertEqual(perf.load_trace_exec_proof(trace)[0]["resolved"], "/tmp/pilotdeck-agent-loop")


class ReportTests(unittest.TestCase):
    def test_primary_baseline_excludes_injected_delay(self) -> None:
        samples = [{
            "iteration": 1,
            "turn_ms": 10.0,
            "model_iter_ms": [4.0],
            "stream_chunk_ms": [],
            "rss_kb": 1000,
        }]
        clean = perf.build_scenario_report("pure_text", delay_injected=False, samples=samples)
        dirty = perf.build_scenario_report("deadline", delay_injected=True, samples=samples)
        self.assertTrue(clean["primaryBaseline"])
        self.assertFalse(dirty["primaryBaseline"])
        self.assertEqual(clean["turn_ms"]["n"], 1)
        self.assertEqual(clean["turn_ms"]["p50"], 10.0)
        self.assertEqual(clean["non_model_ms"]["p50"], 6.0)

    def test_net_of_delay_subtracts_configured_model_ms(self) -> None:
        self.assertEqual(perf.net_of_configured_delay([450.0, 460.0], 200, times=1), [250.0, 260.0])
        self.assertEqual(
            perf.net_of_configured_delay([650.0, 860.0], 200, times=[1, 2]),
            [450.0, 460.0],
        )
        self.assertEqual(perf.net_stream_chunk_ms([212.5, 3.0, 4.0], 200), [12.5, 3.0, 4.0])
        self.assertEqual(perf.d4_threshold(40.0), 5.0)
        self.assertEqual(perf.d4_threshold(80.0), 8.0)
        samples = [{
            "iteration": 1,
            "turn_ms": 650.0,
            "model_iter_ms": [210.0, 205.0],
            "stream_chunk_ms": [201.0, 3.0],
            "rss_kb": 1000,
        }]
        report = perf.build_scenario_report(
            "sidecar_live_model_stream_chars_50",
            delay_injected=True,
            samples=samples,
            configured_model_ms=200.0,
        )
        self.assertEqual(report["configuredModelMs"], 200.0)
        self.assertEqual(report["turn_ms"]["p50"], 650.0)
        self.assertEqual(report["turn_ms_net_of_model_ms"]["p50"], 250.0)
        self.assertEqual(report["model_iter_ms_net_of_model_ms"]["p50"], 7.5)
        self.assertEqual(report["stream_chunk_ms_net_of_model_ms"]["raw"], [1.0, 3.0])
        self.assertEqual(report["stream_chunk_ms_interval0_net_of_model_ms"]["p50"], 1.0)

    def test_record_command_scrubs_absolute_root(self) -> None:
        repo = ROOT.parent.parent
        command = perf.record_command(
            ["--pilotdeck-root", str(repo), "--iterations", "30"],
            repo,
        )
        self.assertIn("--pilotdeck-root $PWD", command)
        self.assertNotIn(str(repo), command)

    def test_git_dirty_matches_porcelain(self) -> None:
        self.assertIsInstance(perf.git_dirty(ROOT.parent.parent), bool)

    def test_resolve_collect_sha_refuses_dirty_tree(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            subprocess.run(["git", "init"], cwd=repo, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.email", "perf@example.test"], cwd=repo, check=True)
            subprocess.run(["git", "config", "user.name", "perf"], cwd=repo, check=True)
            (repo / "marker").write_text("clean\n", encoding="utf-8")
            subprocess.run(["git", "add", "marker"], cwd=repo, check=True, capture_output=True)
            subprocess.run(["git", "commit", "-m", "init"], cwd=repo, check=True, capture_output=True)
            sha, dirty = perf.resolve_collect_sha(repo, allow_dirty=False)
            self.assertFalse(dirty)
            self.assertTrue(sha)
            (repo / "marker").write_text("dirty\n", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                perf.resolve_collect_sha(repo, allow_dirty=False)
            dirty_sha, dirty = perf.resolve_collect_sha(repo, allow_dirty=True)
            self.assertTrue(dirty)
            self.assertEqual(dirty_sha, sha)

    def test_resolve_base_uses_merge_base(self) -> None:
        branch, sha = perf.resolve_base(ROOT.parent.parent, "rust_standalone_alpha1")
        self.assertEqual(branch, "rust_standalone_alpha1")
        self.assertRegex(sha, r"^[0-9a-f]{7,}$")
        origin = subprocess.run(
            ["git", "merge-base", "HEAD", "origin/rust_standalone_alpha1"],
            cwd=ROOT.parent.parent,
            text=True,
            capture_output=True,
            check=False,
        )
        if origin.returncode == 0 and origin.stdout.strip():
            self.assertEqual(sha, origin.stdout.strip())

    def test_resolve_base_prefers_origin_over_stale_local_branch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            subprocess.run(["git", "init"], cwd=repo, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.email", "perf@example.test"], cwd=repo, check=True)
            subprocess.run(["git", "config", "user.name", "perf"], cwd=repo, check=True)
            marker = repo / "marker"
            marker.write_text("A\n", encoding="utf-8")
            subprocess.run(["git", "add", "marker"], cwd=repo, check=True, capture_output=True)
            subprocess.run(["git", "commit", "-m", "A"], cwd=repo, check=True, capture_output=True)
            stale = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
            subprocess.run(["git", "branch", "rust_standalone_alpha1"], cwd=repo, check=True)
            marker.write_text("B\n", encoding="utf-8")
            subprocess.run(["git", "add", "marker"], cwd=repo, check=True, capture_output=True)
            subprocess.run(["git", "commit", "-m", "B"], cwd=repo, check=True, capture_output=True)
            origin = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
            subprocess.run(
                ["git", "update-ref", "refs/remotes/origin/rust_standalone_alpha1", origin],
                cwd=repo,
                check=True,
            )
            marker.write_text("C\n", encoding="utf-8")
            subprocess.run(["git", "add", "marker"], cwd=repo, check=True, capture_output=True)
            subprocess.run(["git", "commit", "-m", "C"], cwd=repo, check=True, capture_output=True)
            branch, sha = perf.resolve_base(repo, "rust_standalone_alpha1")
            self.assertEqual(branch, "rust_standalone_alpha1")
            self.assertEqual(sha, origin)
            self.assertNotEqual(sha, stale)
            _branch, explicit = perf.resolve_base(repo, "rust_standalone_alpha1", base_sha=stale)
            self.assertEqual(explicit, stale)
            with self.assertRaises(RuntimeError):
                perf.resolve_base(repo, "rust_standalone_alpha1", base_sha="not-a-commit")

    def test_transport_label_distinguishes_native_ts_tcp_rust_tcp_rust_stdio(self) -> None:
        ts = "node /repo/dist/src/cli/pilotdeck-agent-loop-sidecar.js"
        self.assertEqual(perf.label_perf_transport("native"), "native")
        self.assertEqual(perf.label_perf_transport("tcp", tcp_sidecar_cmd=ts), "ts-tcp")
        self.assertEqual(
            perf.label_perf_transport("tcp", tcp_sidecar_cmd="tools/agent-loop-parity/rust-tcp-sidecar.sh"),
            "rust-tcp",
        )
        self.assertEqual(
            perf.label_perf_transport(
                "tcp",
                tcp_sidecar_cmd="/tmp/proof/pilotdeck-agent-loop",
            ),
            "rust-tcp",
        )
        self.assertEqual(
            perf.label_perf_transport(
                "stdio",
                stdio_sidecar_command="tools/agent-loop-parity/rust-stdio-sidecar.sh",
            ),
            "rust-stdio",
        )
        self.assertEqual(perf.label_perf_transport("stdio"), "stdio")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "pilotdeck-agent-loop-sidecar"
            target.write_bytes(b"rust-core")
            link = root / "pilotdeck-agent-loop"
            link.symlink_to(target)
            identity = perf.rust_core_identity(str(link))
            self.assertIsNotNone(identity)
            assert identity is not None
            self.assertEqual(identity["proofBasename"], "pilotdeck-agent-loop")
            self.assertEqual(identity["target"], str(target.resolve()))
            self.assertEqual(len(identity["sha256"]), 64)

    def test_comparison_baseline_records_d4_and_diff_over_d4(self) -> None:
        native = {
            "transport": "native",
            "harnessTransport": "native",
            "comparisonBaseline": {
                "pure_text": {"turn_ms_net_of_model_ms": {"n": 1, "p50": 30.0, "p95": 40.0}},
            },
        }
        rust = {
            "transport": "rust-tcp",
            "harnessTransport": "tcp",
            "comparisonBaseline": {
                "pure_text": {"turn_ms_net_of_model_ms": {"n": 1, "p50": 45.0, "p95": 50.0}},
            },
        }
        perf.annotate_d4(native, native)
        perf.annotate_d4(rust, native)
        native_row = native["comparisonBaseline"]["pure_text"]
        rust_row = rust["comparisonBaseline"]["pure_text"]
        self.assertEqual(native_row["d4"], 5.0)
        self.assertEqual(native_row["netP95DiffMs"], 0.0)
        self.assertEqual(native_row["diffOverD4"], 0.0)
        self.assertEqual(rust_row["d4"], 5.0)
        self.assertEqual(rust_row["netP95DiffMs"], 10.0)
        self.assertEqual(rust_row["diffOverD4"], 2.0)

    def test_write_evidence_includes_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "native.json"
            perf.write_transport_evidence(
                path,
                {
                    "transport": "native",
                    "primaryBaseline": {"pure_text": {"turn_ms": {"n": 1, "p50": 1, "p95": 1}}},
                    "excludedFromPrimary": [],
                    "hostOverheadDefinition": perf.HOST_OVERHEAD_DEFINITION,
                },
                provenance={"gitSha": "abc", "command": "python3 tools/agent-loop-perf/run.py"},
            )
            document = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(document["transport"], "native")
            self.assertEqual(document["provenance"]["gitSha"], "abc")
            self.assertIn("no sidecar", document["hostOverheadDefinition"])


if __name__ == "__main__":
    unittest.main()
