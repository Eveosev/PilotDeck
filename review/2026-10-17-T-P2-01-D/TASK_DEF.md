# TASK_DEF · T-P2-01-D · Track D（最小切片：消掉 `deadline_during_tool`）

> 状态：**定稿**·箱本地；`unlocked=true`（见 `UNLOCK.md`，2026-10-17 04:33 CST，真 Payne 经 Payne 分身 1:1 选 **A**）。
> 对照：`docs/rust_rebuild/PLAN.md` T-P2-01 D（`:46`）/ P2 Track D（`:29`、`:40`）；Formal `#55` `review/2026-10-16-T-P2-05/qa-gate-55-54633c3e/SUMMARY.md`。
> **不是** T-P2-05 D7 范围变更；**不**扩 #55 allowlist；**不**把期望改成 50/3。

## 0. 前置

1. #55 T-P2-05 draft tip **`54633c3e`** Formal **FAIL**（仅 P6）：full-53 两次 **50/3/0/0** ≠ 锁定 **51/2/0/0**。
2. 失败名：`deadline`（3 semantic）+ **`deadline_during_tool`**（1）+ `sidecar_budget_limit`（1）。Allowlist **仅** `deadline` + `sidecar_budget_limit`；`deadline_during_tool` → Track D。
3. Diff 签名（Formal `raw/full53-diff-signatures.txt` / `deadline_during_tool-pilotdeck.md`）：`gateway_submit_failed` + `result_unknown`（及 deadline 上 durableStopReason/resultType null 族）。根因在 **rust-core 对拍路径**，不是 D7 auth/listen。
4. #55 tip **`54633c3e` 暂不动**（不往该 tip 强推）。本任务另开 draft PR。
5. 基线父提交：**`54633c3e`**（含 #55 TCP）；主线仍 `d740abe1`。若选择合入顺序与 tip 合并策略，见 §7。

## 1. 目标（最小可验收切片）

在 rust-core 侧修到：对拍 **TCP full-53 两次** 回到锁定文案 **51 pass / 2 trace_diff / 0 profile_gap / 0 BLOCKED**（分母 53）。

允许的 trace_diff **仅**：`deadline` + `sidecar_budget_limit`。  
**必须消除**：`deadline_during_tool` 作为 failed/trace_diff（不得靠扩 allowlist）。

**不是**：关 PC2；切产品默认路径；改 `apps/**`；修全量 tools 缺口 m2/m4/…（可登记后续 Track D 扩面）；把探针 10ms 轮询搬进 rust-core。

## 2. In

1. 改动面优先：`rust-core/pilotdeck-transport/**` 与/或 `rust-core/pilotdeck-agent/**`（以复现 `gateway_submit_failed`/`result_unknown` 所需为限）；必要时单测。
2. 证据落 `review/2026-10-17-T-P2-01-D/**`：`PROVENANCE.md`、`PARITY_TCP.md`（含两次 full-53 摘要）、`DIFF_SIGNATURES.md`（修前/修后）、`raw/*.txt`。
3. 允许最小改 `docs/rust_rebuild/PLAN.md`：T-P2-01 D / Track D 状态一行。
4. 身份与 #55 Formal 相同：`PILOTDECK_RUST_SIDECAR_BIN` → rust-core-proof symlink → `rust-core/target/release/pilotdeck-agent-loop-sidecar`；忽略 harness `sidecarImplementation=ts` 标签。

## 3. Out

- 扩 #55 / 本任务 allowlist；自批 P6 waiver 到 50/3
- 改 `crates/**` 探针堆场景；改 `apps/**` `ui/**` `packages/**`
- ready / merge / force-push / rebase / amend（仅 real Payne）
- 未 Formal PASS 就启 Reviewer

## 4. 白名单

| 允许 | 禁止 |
|---|---|
| `rust-core/pilotdeck-transport/**`、`rust-core/pilotdeck-agent/**`（必要时 `pilotdeck-protocol/**` 若契约确需） | `crates/**`；根 `Cargo.toml` / `Cargo.lock` / `rust-toolchain.toml` |
| `review/2026-10-17-T-P2-01-D/**` | `apps/**` `ui/**` `src/**` `packages/**` |
| `docs/rust_rebuild/PLAN.md`（Track D / T-P2-01 D 状态） | 覆盖 `evidence/p1/*.json` 冒充关 PC* |
| — | 改 #55 已冻结 tip 的强制推送；改 TASK_DEF #55 的 P6 锁定期望 |

## 5. 验收

| # | 条件 | 判定 |
|---|---|---|
| P1 | 构建 | `cd rust-core && cargo +1.99.1 build --release --locked -p pilotdeck-transport --bin pilotdeck-agent-loop-sidecar` 成功；产物路径钉死 |
| P2 | 单测 | `cargo +1.99.1 test --locked -p pilotdeck-transport`（及本 PR 新增测例）绿；若改 agent crate 则该 crate test 亦绿 |
| P3 | 身份 | `readlink -f "$PILOTDECK_RUST_SIDECAR_BIN"` → rust-core release sidecar |
| P4 | TCP 快速门 | `pure_text` / `single_tool` 各 ×30，**0 semantic diff**（同 #55 Formal） |
| P5 | **TCP full-53 ×2** | 两次均为 **51/2/0/0**；failed/trace_diff 名 **仅** `deadline` + `sidecar_budget_limit`；**不得**出现 `deadline_during_tool` |
| P6 | Diff 签名 | `DIFF_SIGNATURES.md` 附修前（引用 Formal）与修后；说明如何消除 `deadline_during_tool` 的 `gateway_submit_failed`/`result_unknown` |
| P7 | 白名单 / draft | diff ⊆ 白名单；PR **draft**；不 ready/merge |
| P8 | #55 关系 | PROVENANCE 写明与 #55 tip `54633c3e` 的父子/堆叠关系；**不**在本 PR 把 #55 allowlist 改宽 |

P5 缺一次或出现第三名失败 → Formal FAIL。

## 6. PR

- 标题建议：`T-P2-01-D: Track D eliminate deadline_during_tool (restore 51/2)`
- 父 tip：**`54633c3e`**（堆在 #55 上）；目标分支 `rust_standalone_alpha1`
- **draft**；Formal PASS 后父代理启 Mac Reviewer：**先评重构进度，再评代码质量**
- ready/merge 仅 real Payne

## 7. 与 #55 合入路径

推荐（写死默认）：本 PR tip = #55 + Track D 提交；QA 对本 PR tip Formal PASS 后，由真 Payne 决定合入本 PR（可关闭或 supersede #55）或先合 #55 再合本 PR。  
备选：Track D 合入主线后回头对 #55 tip 重 Formal（仅当 #55 仍独立保留时）。

## 8. 成功标准

- draft PR + P1–P8 证据；full-53 两次锁回 **51/2**
- 读者清楚：D7（#55）功能面可保留；P6 卡点由 Track D 消掉 `deadline_during_tool`，**不是**放宽门禁
