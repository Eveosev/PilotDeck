# T-P1-03-FU-A evidence (B3 + S4 + #26 m1–m4)

Provenance: `gitSha=98c882328c4d3cc87a3792502aba480507c754a5`, `gitDirty=false`.
Collected on the clean code tip before this evidence commit.
Draft PR: https://github.com/Eveosev/PilotDeck/pull/30 → `rust_standalone_alpha1`.

## B3 — seven serde cases (TS vs Rust, never silent)

| Case | TS | Rust | Decision |
| --- | --- | --- | --- |
| `1.0` | accept (js=1) | accept | aligned |
| `-0` | accept (`Object.is(-0,-0)`) | accept (i64 0) | documented-divergence |
| `1e2` / `1E0` / `100e-2` | accept | accept | aligned |
| `>2^53` `9007199254740993` | accept (js=9007199254740992) | accept (exact) | documented-divergence |
| `1e400` | parse Infinity, then reject | parse error | documented-divergence |
| duplicate key execute payload | last-wins | last-wins via `Value` | aligned |
| ajv strict | accept 1.0 / reject 1e400 | same | aligned |

B3(a) `preserve_order` is on (`serde_json` feature + `model_tool_schema_keeps_input_schema_key_order`). Wire input is `parse_json_line` → `Value`; no `Deserialize` derive in the crate. See `b3.json`.

## S4 — same B1/B4 suite, stdio vs TCP `127.0.0.1:0`

Crate (`tests/common/suite.rs`):

| Transport | Tests | Result |
| --- | ---: | --- |
| stdio (`sidecar_stdio`) | 6 | PASS |
| TCP `--listen 127.0.0.1:0` (`sidecar_tcp`) | 7 (same 6 + TS host B4) | PASS |

T-P1-03 parity (TS native vs Rust sidecar), same scenes, side-by-side:

| Scene | stdio | TCP `listening 127.0.0.1:45751` | stdio warnings | TCP warnings |
| --- | --- | --- | ---: | ---: |
| `pure_text` | PASS exit 0 | PASS exit 0 | 16 | 58 |
| `single_tool` | PASS exit 0 | PASS exit 0 | 40 | 134 |

TCP is reuse-mode listen-then-connect (`tcpSidecarLog=null`). `modelViewFormatEnvelopeOnly=true` on every run.

## #26 R1 m1–m4

- **m1**: `formatWarningNote` lists envelope + budget + modelView.* + request/requestEvidence/response/state/kind/source/attempt. TCP `pure_text` observed all ten categories.
- **m2**: per-run `formatWarningTaxonomy` persisted; modelView format diffs are envelope-only (no semantic modelView FAIL).
- **m3**: removed `g3-reuse-sidecar-command-native` (TCP-native crash twin). Added `g3-reuse-fake-sidecar` (malformed shape on listen port). Names match mode.
- **m4**: `comparatorVersion=1.1.0` and per-run `traceDigest.ts` / `traceDigest.rust` (file + canonical).

### G3

| Case | Expected | Exit | Gate |
| --- | ---: | ---: | --- |
| `g3-stdio-native-mode` | 2 | 2 | PASS |
| `g3-tcp-native-mode` | 2 | 2 | PASS |
| `g3-reuse-no-listener` | 2 | 2 | PASS |
| `g3-reuse-fake-sidecar` | 2 | 2 | PASS |

## Local gates

`cargo test --workspace -- --test-threads=1` ×2: **85 passed / 0 failed**, `run1EqRun2=true`.
`cargo clippy --workspace --all-targets -- -D warnings`: exit 0.
`python3 -m unittest test_trace` (cwd `tools/agent-loop-parity`): 78 passed.

No `ui/`, no `apps/desktop`, no T-P1-04, no real model calls.
