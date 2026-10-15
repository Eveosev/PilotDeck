# TASK_DEF · T-P1-04（定稿 · 2026-10-15 Payne 1:1 unlock · chunk=chars · scenario field）

**Base：** `rust_standalone_alpha1` @ `f4e40243`（#32 FU-B 已合）  
**状态：** unlocked；**钉死** chunk 单位=`chars`；参数入口仅 **`scenarios[].streamChunkChars`**（`1 | 50 | 500`）。不要 env，不要 token 切片。  
**QA Formal：** `review/2026-10-15-T-P1-04/QA-ACCEPTANCE.md`

## 目标

为 P1「有条件 Go」归因提供可调流块粒度：mock / parity 按 Unicode **chars** 拟合 **1 / 50 / 500** 的单块往返，支撑 T-P1-05 的 turn / model 迭代 / 流块对照。

实现落在 adapter 流式 yield：保持现有 `STREAM_PREFIX::` 首 delta（provider 完成前），再按 `streamChunkChars` 切片 mock body。

## Track A

| ID | 项 | 验收 |
|---|---|---|
| A1 | 流块参数入口 | 仅 `scenarios[].streamChunkChars`：`1 \| 50 \| 500`。单位 chars。无 env。 |
| A2 | adapter 行为 | `sidecar_live_model_stream` 同族三种粒度：首 delta 早于 provider completion；仍含 `STREAM_PREFIX` / expected；pure_text / single_tool 不回归 |
| A3 | 可复现跑法 | README 三条命令 + `collect_stream_chunks.py`；产物 `evidence/p1/stream-chunks-{1,50,500}.json` |
| A4 | 单测 / 冒烟 | 默认省略字段 = STREAM_PREFIX + 整包 remainder（2 delta）；50 与 500 发出多个 text_delta；**`1` = 每 chunk 一个 Unicode code point，不是整包** |

## Track B

| ID | 项 | 验收 |
|---|---|---|
| B1 | 计时/计数 | 产物含 `n_chunks`；`PARITY_PERF=1` 时填充 `stream_chunk_ms` |
| B2 | T-P1-05 接口 | 产物注明 T-P1-05 用于 Rust-tcp vs native / vs TS-tcp；**本 PR 不写 go-nogo** |

## Out

T-P1-05/06、真模型、desktop/ui、Cargo.lock churn、扩大 rust crate 范围。
