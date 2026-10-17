"""Unit tests for T-P1-04-FU collect_stream_chunks (m3/m4/m6) and METRICS notes (m5)."""
from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from collect_stream_chunks import (
    VALID_TRANSPORTS,
    artifact_for,
    build_run_gateway_extra_args,
    chunk_text_by_chars,
    infer_transport,
    live_artifact_path,
    load_variant,
    main,
    net_stream_chunk_ms,
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

    def test_m4_sidecar_trace_labels_source_sidecar_not_gateway(self) -> None:
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
            self.assertEqual(selected["source"], "sidecar")
            self.assertNotEqual(selected["source"], "gateway")
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
            with self.assertRaises(FileNotFoundError) as raised:
                select_run_gateway_trace(native_only, scenario_id, prefer="sidecar")
            self.assertIn("no sidecar trace", str(raised.exception))
            native_selected = select_run_gateway_trace(native_only, scenario_id, prefer="native")
            self.assertEqual(native_selected["source"], "native")
            self.assertEqual(native_selected["perf"]["n_chunks"], 4)
            self.assertEqual(native_selected["trace_summary"]["n_chunks"], 4)

    def test_m4_nonzero_exit_does_not_read_stale_trace(self) -> None:
        scenario_id = "sidecar_live_model_stream_chars_1"
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            dest = output / "raw-1"
            dest.mkdir()
            stale = dest / f"{scenario_id}.pilotdeck-current-sidecar.jsonl"
            stale.write_text(json.dumps({"stale": True}) + "\n", encoding="utf-8")
            stale_perf = Path(str(stale) + ".perf.json")
            stale_perf.write_text(json.dumps({"n_chunks": 99}) + "\n", encoding="utf-8")

            def fake_run(command, check, env):  # noqa: ANN001
                class Result:
                    returncode = 2

                return Result()

            with mock.patch("collect_stream_chunks.subprocess.run", fake_run):
                with self.assertRaises(FileNotFoundError) as raised:
                    run_gateway(1, output, Path("/repo"), [])
            message = str(raised.exception)
            self.assertIn("without a fresh", message)
            self.assertNotIn("stale", message)
            self.assertFalse(stale.exists())
            self.assertFalse(stale_perf.exists())

    def test_m4_old_mtime_is_not_a_fresh_trace(self) -> None:
        scenario_id = "sidecar_live_model_stream_chars_1"
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            dest = output / "raw-1"
            dest.mkdir()
            stale = dest / f"{scenario_id}.pilotdeck-current-sidecar.jsonl"
            stale.write_text(json.dumps({"stale": True}) + "\n", encoding="utf-8")
            old = time.time() - 30
            os.utime(stale, (old, old))

            def fake_run(command, check, env):  # noqa: ANN001
                class Result:
                    returncode = 1

                return Result()

            with mock.patch("collect_stream_chunks._discard_trace", lambda path: None):
                with mock.patch("collect_stream_chunks.subprocess.run", fake_run):
                    with self.assertRaises(FileNotFoundError) as raised:
                        run_gateway(1, output, Path("/repo"), [])
            self.assertIn("without a fresh", str(raised.exception))
            self.assertTrue(stale.is_file())
            self.assertIn("stale", stale.read_text(encoding="utf-8"))

    def test_m4_nonzero_exit_keeps_a_trace_written_by_this_run(self) -> None:
        scenario_id = "sidecar_live_model_stream_chars_1"
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)

            def fake_run(command, check, env):  # noqa: ANN001
                dest = Path(command[command.index("--output") + 1])
                dest.mkdir(parents=True, exist_ok=True)
                trace = dest / f"{scenario_id}.pilotdeck-current-sidecar.jsonl"
                trace.write_text(json.dumps({"fresh": True}) + "\n", encoding="utf-8")

                class Result:
                    returncode = 1

                return Result()

            with mock.patch("collect_stream_chunks.subprocess.run", fake_run):
                raw = run_gateway(1, output, Path("/repo"), [])
            selected = select_run_gateway_trace(raw, scenario_id)
            self.assertEqual(selected["source"], "sidecar")
            text = (raw / f"{scenario_id}.pilotdeck-current-sidecar.jsonl").read_text(encoding="utf-8")
            self.assertIn("fresh", text)
            self.assertNotIn("stale", text)

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
            self.assertIn("no sidecar or native trace", str(raised.exception))

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
                source="sidecar",
                sidecar_transport="tcp",
                tcp_sidecar_cmd="./target/release/pilotdeck-agent-loop-sidecar",
            ),
            "rust-tcp",
        )
        self.assertEqual(
            infer_transport(explicit=None, source="sidecar", sidecar_transport="tcp", tcp_sidecar_cmd=None),
            "ts-tcp",
        )
        self.assertEqual(
            infer_transport(
                explicit=None,
                source="sidecar",
                sidecar_transport="tcp",
                tcp_sidecar_cmd="tools/agent-loop-parity/rust-tcp-sidecar.sh",
            ),
            "rust-tcp",
        )
        artifact = artifact_for(
            50,
            scenario=load_variant(50),
            source="sidecar",
            transport="rust-tcp",
        )
        self.assertEqual(artifact["transport"], "rust-tcp")
        self.assertEqual(artifact["n_chunks"], 22)

        recorded: dict[str, list[str]] = {}

        def fake_run(command, check, env):  # noqa: ANN001
            recorded["command"] = command
            dest = Path(command[command.index("--output") + 1])
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "sidecar_live_model_stream_chars_1.pilotdeck-current-sidecar.jsonl").write_text(
                "{}\n", encoding="utf-8"
            )

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

    def test_net_stream_chunk_ms_subtracts_model_ms_from_interval0_only(self) -> None:
        self.assertEqual(net_stream_chunk_ms([], 200), [])
        self.assertEqual(net_stream_chunk_ms([212.5, 3.0, 4.0], 200), [12.5, 3.0, 4.0])
        artifact = artifact_for(
            1,
            scenario=load_variant(1),
            source="sidecar",
            transport="ts-tcp",
            perf={"stream_chunk_ms": [201.0, 2.0], "n_chunks": 3},
        )
        self.assertEqual(artifact["configuredModelMs"], 200.0)
        self.assertEqual(artifact["stream_chunk_ms"], [201.0, 2.0])
        self.assertEqual(artifact["stream_chunk_ms_net_of_model_ms"], [1.0, 2.0])
        self.assertEqual(artifact["source"], "sidecar")
        self.assertNotEqual(artifact["source"], "gateway")

    def test_live_artifact_path_does_not_overwrite_planned_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            out = Path(temporary)
            self.assertEqual(
                live_artifact_path(out, 50, "rust-tcp"),
                out / "stream-chunks-live-rust-tcp-50.json",
            )
            planned = out / "stream-chunks-50.json"
            planned.write_text("{}\n", encoding="utf-8")
            live = live_artifact_path(out, 50, "native")
            live.write_text("{}\n", encoding="utf-8")
            self.assertTrue(planned.is_file())
            self.assertTrue(live.is_file())
            self.assertNotEqual(planned, live)


if __name__ == "__main__":
    unittest.main()
