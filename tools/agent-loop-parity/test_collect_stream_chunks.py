"""Unit tests for T-P1-04-FU collect_stream_chunks (m3/m4/m6) and METRICS notes (m5)."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from collect_stream_chunks import (
    VALID_TRANSPORTS,
    artifact_for,
    build_run_gateway_extra_args,
    chunk_text_by_chars,
    infer_transport,
    load_variant,
    main,
    parse_args,
    planned_deltas,
    run_gateway,
    select_run_gateway_trace,
)
from run import ROOT


class CollectStreamChunksTests(unittest.TestCase):
    def test_planned_variant_chunk_counts_stay_pinned(self) -> None:
        expected = {1: 98, 50: 22, 500: 4}
        for chars, n_chunks in expected.items():
            scenario = load_variant(chars)
            self.assertEqual(len(planned_deltas(scenario)), n_chunks, f"chars={chars}")

    def test_default_empty_string_is_prefix_plus_one_remainder(self) -> None:
        self.assertEqual(chunk_text_by_chars("", None), [""])
        self.assertEqual(["STREAM_PREFIX::", *chunk_text_by_chars("", None)], ["STREAM_PREFIX::", ""])

    def test_m3_planned_oracles_are_not_true(self) -> None:
        scenario = load_variant(1)
        artifact = artifact_for(1, scenario=scenario, source="planned-from-scenario", transport=None)
        self.assertIsNone(artifact["firstDeltaBeforeProviderCompletion"])
        self.assertIsNone(artifact["outputContainsSTREAM_PREFIX"])
        self.assertNotEqual(artifact["firstDeltaBeforeProviderCompletion"], True)
        self.assertNotEqual(artifact["outputContainsSTREAM_PREFIX"], True)
        self.assertTrue(artifact["planned"])
        self.assertEqual(artifact["source"], "planned-from-scenario")
        self.assertIsNone(artifact["transport"])
        self.assertEqual(artifact["n_chunks"], 98)

    def test_m4_sidecar_trace_labels_source_gateway_and_keeps_native_perf_fallback(self) -> None:
        scenario_id = "sidecar_live_model_stream_chars_1"
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary)
            sidecar = raw / f"{scenario_id}.pilotdeck-current-sidecar.jsonl"
            sidecar.write_text(
                "\n".join([
                    json.dumps({"kind": "model.stream", "state": "first_delta"}),
                    json.dumps({"kind": "user.output", "text": "STREAM_PREFIX::"}),
                    json.dumps({"kind": "model.stream", "state": "provider_completed"}),
                    json.dumps({"kind": "model.stream", "state": "chunks", "n_chunks": 3}),
                ]) + "\n",
                encoding="utf-8",
            )
            (Path(str(sidecar) + ".perf.json")).write_text(
                json.dumps({"stream_chunk_ms": [200.0], "n_chunks": 3}),
                encoding="utf-8",
            )
            selected = select_run_gateway_trace(raw, scenario_id)
            self.assertEqual(selected["source"], "gateway")
            self.assertEqual(selected["perf"]["n_chunks"], 3)
            self.assertEqual(selected["trace_summary"]["n_chunks"], 3)

            native_only = Path(temporary) / "native-only"
            native_only.mkdir()
            native = native_only / f"{scenario_id}.pilotdeck-current-native.jsonl"
            native.write_text(
                json.dumps({"kind": "model.stream", "state": "chunks", "n_chunks": 4}) + "\n",
                encoding="utf-8",
            )
            (Path(str(native) + ".perf.json")).write_text(
                json.dumps({"stream_chunk_ms": [12.0], "n_chunks": 4}),
                encoding="utf-8",
            )
            native_selected = select_run_gateway_trace(native_only, scenario_id)
            self.assertEqual(native_selected["source"], "native")
            self.assertEqual(native_selected["perf"]["n_chunks"], 4)
            self.assertEqual(native_selected["trace_summary"]["n_chunks"], 4)

    def test_m4_missing_trace_exits_without_writing_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            out = Path(temporary)

            def fake_run_gateway(chars: int, output: Path, pilotdeck_root: Path, extra_args: list[str]) -> Path:
                dest = output / f"raw-{chars}"
                dest.mkdir(parents=True, exist_ok=True)
                return dest

            with mock.patch("collect_stream_chunks.run_gateway", fake_run_gateway):
                code = main([
                    "--run-gateway",
                    "--output", str(out),
                    "--pilotdeck-root", str(out),
                ])
            self.assertEqual(code, 1)
            self.assertEqual(list(out.glob("stream-chunks-*.json")), [])
            self.assertFalse((out / "stream-chunks-index.json").exists())

    def test_m4_missing_trace_raises_before_any_write_when_selecting(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary)
            with self.assertRaises(FileNotFoundError) as raised:
                select_run_gateway_trace(raw, "sidecar_live_model_stream_chars_1")
            self.assertIn("no gateway/sidecar or native trace", str(raised.exception))

    def test_m6_rust_tcp_args_pass_through_and_transport_field(self) -> None:
        extra = build_run_gateway_extra_args(
            sidecar_transport="tcp",
            tcp_host="127.0.0.1",
            tcp_port=9345,
            tcp_sidecar_cmd="./target/release/pilotdeck-agent-loop-sidecar",
        )
        self.assertEqual(extra, [
            "--sidecar-transport", "tcp",
            "--pilotdeck-tcp-host", "127.0.0.1",
            "--pilotdeck-tcp-port", "9345",
            "--pilotdeck-tcp-sidecar-cmd", "./target/release/pilotdeck-agent-loop-sidecar",
        ])
        args = parse_args([
            "--sidecar-transport", "tcp",
            "--pilotdeck-tcp-sidecar-cmd", "./target/release/pilotdeck-agent-loop-sidecar",
            "--transport", "rust-tcp",
        ])
        self.assertEqual(args.transport, "rust-tcp")
        self.assertIn("rust-tcp", VALID_TRANSPORTS)
        self.assertEqual(
            infer_transport(
                explicit=None,
                source="gateway",
                sidecar_transport="tcp",
                tcp_sidecar_cmd="./target/release/pilotdeck-agent-loop-sidecar",
            ),
            "rust-tcp",
        )
        self.assertEqual(
            infer_transport(explicit=None, source="gateway", sidecar_transport="tcp", tcp_sidecar_cmd=None),
            "ts-tcp",
        )
        artifact = artifact_for(
            50,
            scenario=load_variant(50),
            source="gateway",
            transport="rust-tcp",
        )
        self.assertEqual(artifact["transport"], "rust-tcp")
        self.assertEqual(artifact["n_chunks"], 22)

        recorded: dict[str, list[str]] = {}

        def fake_run(command, check, env):  # noqa: ANN001
            recorded["command"] = command

            class Result:
                returncode = 0

            return Result()

        with tempfile.TemporaryDirectory() as temporary:
            with mock.patch("collect_stream_chunks.subprocess.run", fake_run):
                run_gateway(1, Path(temporary), Path("/repo"), extra)
        self.assertIn("--pilotdeck-tcp-sidecar-cmd", recorded["command"])
        self.assertIn("./target/release/pilotdeck-agent-loop-sidecar", recorded["command"])
        self.assertIn("--sidecar-transport", recorded["command"])
        self.assertIn("tcp", recorded["command"])

    def test_m6_invalid_transport_exits_code_2(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            parse_args(["--transport", "bogus"])
        self.assertEqual(raised.exception.code, 2)

    def test_m5_metrics_documents_first_chunk_latency_and_n_chunks_sources(self) -> None:
        text = (ROOT.parent / "agent-loop-perf" / "METRICS.md").read_text(encoding="utf-8")
        self.assertIn("stream_chunk_ms[0]", text)
        self.assertIn("model 延迟", text)
        self.assertIn("harness `n_chunks`", text)
        self.assertIn("assistant_text_delta", text)
        self.assertIn("perf `n_chunks`", text)


if __name__ == "__main__":
    unittest.main()
