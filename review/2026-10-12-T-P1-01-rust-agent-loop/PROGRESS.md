# T-P1-01 PR-A progress (S0–S2)

- PR: Eveosev/PilotDeck#8 — **draft** → `rust_standalone_alpha1`
- Branch: `pilotdeck-rust/T-P1-01-agent-loop-a`
- Base: `1da663a2` · code: `2b492df3` · previous tip `846402ac` · merge `7e7cb662` · M `7d488a1b`
- Diff vs first progress note: tip is no longer `5ea8d3ce` / 34 files.

## Slices
| Slice | Status |
|---|---|
| S0 crate skeleton + hello/capabilities + Rust `validate_module_message` | done |
| S1 execute pure_text stub, events + final⇒outcome, forbidden-field rejects | done |
| S2 cancel/status (incl. cancel mid-execute), resume/ack → `*_UNSUPPORTED` | done |
| S3 R2-2 seven serde cases | deferred → PR-B |
| S4 TCP `--listen 127.0.0.1:0` + TS host smoke | deferred → PR-B |

## Locked decisions (Payne, 2026-10-12 20:23)
1. stdio first; TCP in S4. → PR-A is stdio JSONL only.
2. New crate `crates/pilotdeck-agent-loop`; hello crate untouched. → hello diff empty.
3. Duplicate keys = JSON.parse last-wins via `serde_json::Value` first, no direct derive on wire input. → `protocol.rs`; tests `execute_duplicate_keys_last_wins_like_json_parse`, `parse_json_line_last_key_wins`, `sidecar::execute_duplicate_keys_use_last_request_id`.
4. Two PRs: PR-A = S0–S2, PR-B = S3–S4.

## Numbers (Round-1 fix, collected on `2b492df3`, gitDirty=false)
- `cargo test --workspace -- --test-threads=1` ×2: exit 0/0, **32 passed / 0 failed** (lib 19, lock 5, roundtrip 2, sidecar_stdio 6).
- `cargo +1.83.0 test -p pilotdeck-agent-loop`: **PASS** (exit 0).
- Real toolchain: `rustc 1.83.0 (90b35a623 2024-11-26)` / `cargo 1.83.0 (5ffbef321 2024-10-29)` — **not** 1.85.1. Host is pinned by `rust-toolchain.toml`.
- `cargo clippy --workspace --all-targets -- -D warnings` after `cargo clean`: EXIT 0, logs `Checking pilotdeck-agent-loop`.
- Live emitted corpus: 19 messages (response 9 / error 7 / event 3) including completed + cancelled; mismatch 0.
- Lock contrast on base `1da663a2`: FAIL exit 101 (`package ID specification ... did not match any packages`).
- Scope: no changes under `src/`, `.github/`, `ui/`, `packages/`, `package.json`/`package-lock.json`, `crates/pilotdeck-agent-loop-hello`.

## 2026-10-12 21:23
B4（TS host 端到端）已延至 PR-B，见 DECISION / Payne；PR-A 不验 B4，PR-B 必过。

## 2026-10-12 21:28 Round：缺口 4/5/6（B4 已延至 PR-B）
- code `29babbc7`（gitDirty=false），tip `804b9ed5`
- cargo test --workspace 30/0（lib 18, lock 5, roundtrip 2, sidecar_stdio 5），两次一致；clippy（cargo clean 后）-D warnings 通过，含 Checking pilotdeck-agent-loop
- 缺口 4：`sidecar_stdio::s1_execute_rejects_step_id`，真二进制 execute+stepId → error/UNSUPPORTED_FIELD
- 缺口 5：重复键测试改走 parse_json_line；变异 first-wins → FAILED, EXIT 101（未提交）
- 缺口 6：crate Cargo.toml 已有 `rust-version = "1.83"`，与 hello crate、rust-toolchain.toml（1.83.0）一致；workspace 根无 rust-version。未改字段，新增 lock 测试 `crate_rust_version_matches_hello_msrv` 钉住。

## 2026-10-12 21:32 后续项（Payne 指派）
- [x] 1.83.0 编译：已由 PR #8 CI「Linux x64 hello handshake」覆盖（rust-hello.yml L31 固定 1.83.0，L41 根目录 `cargo build --release`，新 crate 是 workspace 成员），804b9ed5 上 pass：https://github.com/Eveosev/PilotDeck/actions/runs/38255805576/job/114833439899
- [x] 缺口 6 遗留（缩小后）：本机已跑 `cargo +1.83.0 test -p pilotdeck-agent-loop`，exit 0（见 `evidence/cargo-plus-1.83.txt`，将被 F-7 删除并挂到 PR artifacts）。
- 本条已从共享目录并入仓内 PROGRESS。

## Round-1 reviewer FAIL follow-up
- F-1 blocker: delayMs 10s；terminal `sequence==0` 且之前无 `agent.message`；单测计时。M7a/M7b/M7c 各 OVERALL_EXIT **101**。
- F-2: 非 UTF-8 行 → INVALID_JSON，进程继续。`s0_non_utf8_line_is_invalid_json_and_keeps_serving`。
- F-3: live roundtrip 先 `ex-done` completed，再 `ex-1` delay 2000 + cancel；`T_P1_01_EMITTED_OUT` 落盘。
- F-6: cancel 无 requestId 时省略该键。
- F-9: 已结束 operationId + 不同 runId → `OPERATION_RUN_MISMATCH`。
- F-4 / F-5: **未改**（pending Payne）。
- F-10: **延至 S4**（检查+插入同一把锁；JoinHandle 回收；delayMs 上限）。stdio 单线程 dispatch 目前无害。
- F-12: tip / toolchain 记录已按实测 `rustc 1.83.0` 与当前 code SHA 更正（不再写 5ea8d3ce / 1.85.1）。

## F-7 raw evidence deletion table
The next commit (F-7) removes these raw files under `review/2026-10-12-T-P1-01-rust-agent-loop/evidence/`. Copies are attached as PR artifacts under `/opt/cursor/artifacts/t-p1-01-round1-raw/`. Collection gitSha is the clean code tip used when the files were written.

| path | sha256 | collection gitSha |
|---|---|---|
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/base-contrast.json | `7fff1f21cf2cd9a94cfd9fdf91d22c464683420bdb55d4fdcae01c354cd8caca` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/base-lock.txt | `3248b81a3b8426fd9342b69e580b1c6c914d4ee26ae0af093c0371b86daa829a` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/cargo-clippy.txt | `f735a7d1ca1fcac1cf1634f4f8a3e2035cc543c029600b36ccbd69ad8f7e28c0` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/cargo-plus-1.83.txt | `de0222e5efef9d2b7d54dc009ada7aa2c0a6d7546529cd93066422f7cd8c977f` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/cargo-test-1.txt | `684459e4ae022ef9e65ce65d6da12cb05bf6ef909d8304f129c24b3bfe0062bb` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/cargo-test-2.txt | `f717503f5b1f0bde819cc5e82aef8512387e190b72e9d244f63d541c051c3441` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/cargo-test.json | `0c831586d8db86209ff142f50bb9cb410f519069e241f111ee488764dc19f540` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/emitted-messages.json | `91dc96ac0db73d2466d2a4d8284e815ae115cd0e0b667418e665189986b27ffa` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/invalid-roundtrip.json | `6d1114cb9903eb95a9a547d91e187201454d028c1855648d880c17518d1a68d3` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/mutation-first-wins.txt | `f26ace09bbc95e68b989c871f8143392b9927ed089c3d398d6347bc34bd5a55f` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/mutation-m7a.txt | `e7299f9451d64ec907ff5da9e0755d2de778a1c454e1ae023e23395de4fb6fe8` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/mutation-m7b.txt | `799e4214f9e10cd4874a287c4f2bedb4d98d3914fe2b130f4fdd0c6bbd59febe` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/mutation-m7c.txt | `bdbd28140fc5050e1a5ad9cc21340bb873e319a616fdd0edaa577d3d5f626d94` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/provenance.json | `b294706e92fb98ec050533acd4eddccab83277bbf4f49a5ae291557508f215be` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/report.md | `e823016ecfc3f59869399b566583cb2bf8579f72531516f19315f640e3f91ec8` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/roundtrip.json | `709a652203613f4c3243f1f375dba70a221534d3f264128c52e6e0596a6af785` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/rust-decisions.json | `5b5415ccf05bd8e9b7265f6c60f11975c84c0b14b9f6dd012132ee165d1afec6` | `2b492df3` |
| review/2026-10-12-T-P1-01-rust-agent-loop/evidence/rustc-version.txt | `8f3838b3461758410db44782198e9b1b605206168ce553bdfb409820838c699e` | `2b492df3` |

**18 files** scheduled for F-7 deletion. After that commit, `review/2026-10-12-T-P1-01-rust-agent-loop/` keeps only DECISION.md, PROGRESS.md, REVIEW_RESULT.md, QA-ACCEPTANCE.md.

## 2026-10-12 mainline sync

Merged `origin/rust_standalone_alpha1` **M=`7d488a1b5607df51b91b3b0a596298d633638cc2`** into `pilotdeck-rust/T-P1-01-agent-loop-a` (no rebase / no force-push). F-4 / F-5 not touched.

| | SHA |
|---|---|
| previous tip | `846402ace0500b5c9744a751234cc81e585eed5d` |
| M | `7d488a1b5607df51b91b3b0a596298d633638cc2` |
| merge-base(846402ac, M) | `1da663a21d40ef5e309c86423a235550c79f91ff` |
| merge commit | `7e7cb662e7dee71e9425b86634f4d716cbaf2e55` |

Conflicts: **none**. Merge commit has no non-conflict edits (ort; only `ui/src/components/app-shell/MainAreaV2.tsx` from M).

Equality check (`':!review'`):

```
git diff 846402ac 7e7cb662 -- . ':!review'
git diff $(git merge-base 846402ac 7d488a1b) 7d488a1b -- . ':!review'
```

Both sha256: `89f448a80985d9fd9330710a2e89d558f13f2a8e8b61e95ec3f58ed457fa141b` — **EQUAL=yes**.
The shared diff is the desktop `data-desktop-no-drag` one-liner on session title `h1`.
