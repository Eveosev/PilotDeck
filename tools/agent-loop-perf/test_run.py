"""Unit tests for the AgentLoop performance baseline harness."""
from __future__ import annotations

import json
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
