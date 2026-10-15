# T-P1-04 QA acceptance

Gate: clean tree; draft PR into `rust_standalone_alpha1`; do not merge evidence PRs.
Locked 2026-10-15 Arch 1:1: chunk unit = **chars**; parameter entry = **`scenarios[].streamChunkChars`** only (`1 | 50 | 500`). No env entry. No token slicing.

## Track A

- **A1** Scenario (or `sidecar_live_model_stream_chars_{1,50,500}` variants) sets top-level `streamChunkChars` to 1 / 50 / 500. Field path is `scenarios[].streamChunkChars`, not nested. Default gate scene `sidecar_live_model_stream` omits the field.
- **A2** Same-family live stream under each size: first `text_delta` (`STREAM_PREFIX::`) is still yielded **before** provider completion; traces still satisfy `firstDeltaBeforeProviderCompletion` and `outputContains: STREAM_PREFIX`. `pure_text` / `single_tool` do not read the field (no regression).
- **A3** Reproducible commands and result paths are in `tools/agent-loop-parity/README.md` → “T-P1-04 stream chunk size”. Artifacts: `evidence/p1/stream-chunks-{1,50,500}.json`.
- **A4** Tests/smoke: default omitted-field path remains STREAM_PREFIX + one whole-body remainder (2 deltas). Parameterized 50 and 500 emit multiple `text_delta`s (variants pad `q` so body > 500). **`1` means one Unicode code point per post-prefix chunk, not one chunk of the whole body.**

## Track B

- **B1** Artifacts / perf snapshot expose `n_chunks` and fill `stream_chunk_ms` when `PARITY_PERF=1` (collector no longer returns a forever-empty stub on a live stream).
- **B2** T-P1-05 consumes `evidence/p1/stream-chunks-{1,50,500}.json` for Rust-tcp vs native / vs TS-tcp. **This PR does not write go-nogo.**

## Commands

```bash
cd tools/agent-loop-parity
python3 -m unittest -v test_trace.SubagentTraceNormalizationTests.test_full_gateway_gate_counts_53_scenarios \
  test_trace.SubagentTraceNormalizationTests.test_stream_chunk_variants_are_selectable_outside_the_gate
node --test stream-chunks.test.mjs
python3 collect_stream_chunks.py --output ../../evidence/p1
```

Optional Gateway collect (needs `pnpm build`):

```bash
PARITY_PERF=1 python3 tools/agent-loop-parity/collect_stream_chunks.py \
  --pilotdeck-root "$PWD" --output evidence/p1 --run-gateway
```

## Out

T-P1-05/06 go-nogo, real models, desktop/ui, Cargo.lock churn, expanding rust crate scope.
