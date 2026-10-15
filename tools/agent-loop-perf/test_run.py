"""Unit tests for the AgentLoop performance baseline harness."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import run as perf  # noqa: E402


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
