# T-P1-01 QA acceptance (draft, QA)
Gate: clean tree, provenance gitSha + gitDirty=false; lock tests need base(1da663a2) FAIL control; draft PR -> QA -> Reviewer.
- B1 schema round-trip: hello/capabilities/execute/cancel/status — Rust emits & accepts; every emitted msg validates against evidence/schema/module-protocol.schema.json (ajv 8 strict, 2020-12); TS validateModuleMessage accept/reject agrees. Per message >=1 valid + >=1 invalid.
- B2 out of scope rejected cleanly: resume/ack -> defined error, no panic/hang.
- B3 serde R2-2: one case each: 1.0, -0, 1e2/1E0/100e-2, >2^53, 1e400, duplicate key, ajv strict. Each records TS result vs Rust result; divergences listed and decided explicitly (not silent).
- B4 sidecar dialogue: TS host <-> Rust over sidecar protocol, hello->capabilities->execute->status->cancel end to end; log + exit codes.
- B5 robustness: malformed JSON / truncated frame / unknown kind -> error not crash; cancel mid-execute terminates <= agreed timeout.
- B6 scope: no changes to src/ protocol, ui/, packages/sdk; cargo build + test + clippy -D warnings green on pinned toolchain.
- B7 determinism: test suite run twice same result; no network.

## Slice mapping
S0: B1(hello/capabilities) B5(malformed) B6 B7 | S1: B1(execute, final=>outcome) B4 partial | S2: B1(cancel/status) B2 B4 full B5(cancel timeout) | S3: B3 | S4: TCP 127.0.0.1:0 same B1/B4 suite passes over TCP as over stdio
Duplicate key (if "follow JSON.parse"): test must prove last-wins on a derive-heavy message (execute payload) — guards against serde derive default.

## Updated per Payne decisions 2026-10-12 20:2x
- Transport: S0–S2 stdio only; S4 adds TCP and must rerun B1/B4 over TCP.
- Crate: new crates/pilotdeck-agent-loop; crates/pilotdeck-agent-loop-hello diff must be empty; Desktop rust-hello smoke stays green.
- Duplicate key: last-wins (JSON.parse parity). Gate checks: input parsed to serde_json::Value first; grep shows no direct derive-deserialize of raw input; execute-payload duplicate-key test asserts last value.
- PR split: PR-A = S0–S2 (B1 hello/capabilities/execute/cancel/status, B2, B4, B5, B6, B7); PR-B = S3–S4 (B3 seven serde cases, TCP rerun). Each PR gated separately.
