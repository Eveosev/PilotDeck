# TASK_DEF · T-PC1-3-close · docs-only：PLAN 标 PC1#3 已关

> 状态：**已冻结**（2026-10-18 ~17:50 CST）；箱本地 `review/2026-10-18-T-PC1-3-close/`。
> `unlocked=true`（standing「其余全做」）。
> 基线：`rust_standalone_alpha1@bfd397f50e8995dd823c1df314eeaf64bad1c547`（#66 merge；tip `3731d36e`；G-GHA 由真 Payne 豁免）。
> **允许** draft PR；**ready/merge 仍等真 Payne**。禁止 force-push / rebase / amend。

## 0. 前置
1. #66 已合 tip `3731d36e` → merge `bfd397f5`：PC3 n=30 + PC1#3 after-first 数据已入主线。
2. 真 Payne（经 Payne 分身转达）授权：**把 PLAN 里 PC1#3 标为已关**（chars1 差/D4≈0.095、chars50≈−0.103）。
3. **PC2 仍 open**。不关 Track C。不改产品代码。

## 1. 交付（唯一 commit，docs-only）
仅改 `docs/rust_rebuild/PLAN.md`：
- 头注 tip → `bfd397f5`（#66 合并，T-PC1-3；tip `3731d36e`；G-GHA 由真 Payne 豁免，本地等效证据）。
- P2 状态行：记 #66 / T-PC1-3 已合；PC1#3 **已关**；PC3 数据已交付并随 #66 合入；PC2 仍 open。
- 任务表 PC1#3 行 → **已关**（#66 `bfd397f5` tip `3731d36e`；chars1=0.095、chars50=-0.103；真 Payne 授权关）。
- 任务表 PC3 行 → **已合 #66**（数据交付 + Formal PASS；PC2 仍 open）。
- Q1 PC1 第 3 项 / `:111` 附近：标 **已关**，引用同上数字与授权；删「本 PR draft 未合 / 未标已关」措辞。
- Q1 PC3：标随 #66 合入完成；**不**关 PC2。
- 全文扫一遍：不得再写「T-PC1-3 本 PR draft 未合」。

## 2. 白名单
| 允许 | 禁止 |
|---|---|
| `docs/rust_rebuild/PLAN.md` | 一切非 docs；`apps/**` `ui/**` `packages/**` `crates/**` `rust-core/**` `tools/**` `evidence/**` |
| 可选 `review/2026-10-18-T-PC1-3-close/**` 放本 TASK_DEF | 关 PC2；改数字；覆盖 evidence |

## 3. Out
产品代码、测量重跑、PC2 关闭、Track C、CI、desktop。

## 4. PR
- 标题：`docs(T-PC1-3): mark PC1#3 closed after #66 merge`
- draft；普通追加 commit；ready/merge = 真 Payne。
- G-GHA = WAIVER-PENDING + 本地说明（docs-only）。
