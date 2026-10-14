# T-P1-03-FU-A evidence (B3 + S4 + #26 m1–m4)

Provenance: `gitSha=a1ab4e8c4b8ecc2efc07e01319cd592cbed307bf`, `gitDirty=false`.
R3 F1″ refresh on clean `dist` + code tip `a1ab4e8c` (before this evidence commit).
Draft PR: https://github.com/Eveosev/PilotDeck/pull/30 → `rust_standalone_alpha1`.

## B3 — seven serde cases (TS vs Rust, never silent)

| Case | TS | Rust | Decision |
| --- | --- | --- | --- |
| `1.0` | accept (js=1) | accept | aligned |
| `-0` | accept (`Object.is(-0,-0)`) | accept (i64 0) | documented-divergence |
| `1e2` / `1E0` / `100e-2` | accept | accept | aligned |
| `>2^53` `9007199254740993` | accept (js=9007199254740992) | accept (exact) | documented-divergence |
| `1e400` | parse Infinity, then reject | parseOk=false, parseError=true | documented-divergence |
| duplicate key execute payload | last-wins | last-wins via `Value` | aligned |
| ajv strict | accept 1.0 / reject 1e400 | same | aligned |

R1 F2: `1e400.rust.parseOk` is `overflow_rust.is_ok()` (false). See `b3.json`.

## S4 — same B1/B4 suite, stdio vs TCP `127.0.0.1:0`

Crate (`tests/common/suite.rs`):

| Transport | Tests | Result |
| --- | ---: | --- |
| stdio (`sidecar_stdio`) | 6 | PASS |
| TCP `--listen 127.0.0.1:0` (`sidecar_tcp`) | 7 (same 6 + TS host B4) | PASS |

T-P1-03 parity (TS native vs sidecar), same scenes:

| Scene | stdio (exec-proof Rust) | TCP `listening 127.0.0.1:45751` | stdio warnings | TCP warnings |
| --- | --- | --- | ---: | ---: |
| `pure_text` | PASS exit 0 | PASS exit 0 | 16 | 58 |
| `single_tool` | PASS exit 0 | PASS exit 0 | 40 | 134 |

### What stdio proves vs what TCP proves

**stdio** (`sidecarImplementation=rust`, source `exec-proof+module-call`, `rustFingerprint=n/a`):

- Wrapper wrote `rust_sidecar_exec` (`pid` + resolved `target/release/pilotdeck-agent-loop`) before `exec`. That is the implementation discriminator.
- Raw `sequence`: `budget.evaluate_request_budget` (4) before `model.prepare`/`model.stream` (5/6). Timing-independent module_call order, same shape as TCP Rust.
- Host WS `context.budget` still arrives after `model.request` (`sequence` 10 after 8/9). That is **TS-shaped delivery timing**, not an implementation test. It is **not** used to PASS or BLOCK. Format warnings are envelope-only 16/40 — do **not** read this as “Rust-shaped taxonomy”.
- Adapter does **not** rewrite traces or invent `requestEvidence`.

**TCP** (`sidecarImplementation=rust`, source `fingerprint`, collectHead `98c88232`):

- First `context.budget` raw `sequence` before first `model.request` (Rust fingerprint). Taxonomy 58/134 includes budget / modelView / requestEvidence.

R3 F1″: deleted `alignObservedRustBudgetFingerprint`. Clean-dist recollect with `--pilotdeck-stdio-sidecar-cmd tools/agent-loop-parity/rust-stdio-sidecar.sh`.

## #26 R1 m1–m4

- **m1**: `formatWarningNote` lists envelope + budget + modelView.* + request/requestEvidence/response/state/kind/source/attempt. TCP `pure_text` observed all ten categories.
- **m2**: per-run `formatWarningTaxonomy` persisted; modelView format diffs are envelope-only (no semantic modelView FAIL).
- **m3**: removed `g3-reuse-sidecar-command-native`. Added `g3-reuse-fake-sidecar`.
- **m4**: `comparatorVersion=1.1.0` and per-run `traceDigest.ts` / `traceDigest.rust`. `rust` key only when sidecar is observed Rust.

### G3

| Case | Expected | Exit | Gate |
| --- | ---: | ---: | --- |
| `g3-stdio-native-mode` | 2 | 2 | PASS |
| `g3-tcp-native-mode` | 2 | 2 | PASS |
| `g3-reuse-no-listener` | 2 | 2 | PASS |
| `g3-reuse-fake-sidecar` | 2 | 2 | PASS |

## Local gates

`cargo test -p pilotdeck-agent-loop --test serde_r2`: 9/0.
`python3 -m unittest test_trace` (cwd `tools/agent-loop-parity`): 87 passed.

No `ui/`, no `apps/desktop`, no T-P1-04, no real model calls.
