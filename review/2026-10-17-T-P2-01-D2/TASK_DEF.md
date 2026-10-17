# TASK_DEF · T-P2-01-D2 · Track D 余项（tools 缺口 m2/m4/m5/m6/E1/n1/n3 + 53 余差分诊）

> 状态：**草案待 Arch 冻结**（2026-10-17 ~20:55 CST）；箱本地 `review/2026-10-17-T-P2-01-D2/`。
> `unlocked=true`（见 `UNLOCK.md`，standing「其余全做」2026-10-17 ~12:10 CST）。
> 基线：`rust_standalone_alpha1@fbcfa7a9471045354de1dd33fefe9fc27bfd856b`（#60 merge，T-P2-08 G-CI；tip 31a462e6）。
> 对照（均 @fbcfa7a9）：`docs/rust_rebuild/PLAN.md:46`（T-P2-01 D：tools 缺口 m2/m4/m5/m6/E1/n1/n3 与其余 Track D 仍 open）、`:29`、`:40`（Track D = 53 场景 / tools 后续）、`:49`（stdio 53 = 51/2/0/0）、`:86-90`（G-CI 及 m2/m4 债务）、`:56`（T-P2-09 不在本切片）。
> 缺口原始定义：`review/2026-10-15-T-P1-06/TASK_DEF-PROPOSAL.md:52-53`（非阻塞 follow-up，白名单 `tools/agent-loop-perf/**`、`tools/agent-loop-parity/**`）；明细 `review/2026-10-15-T-P1-05/REVIEW_RESULT-PR37-R2.md:63-69`、`REVIEW_RESULT-PR37-R1.md:38,47,49`。
> **允许** draft PR；**ready/merge 仍等真 Payne**。禁止 force-push / rebase / amend，仅普通追加 commit。

## 0. 前置

1. #56 `d91ed18b` 已合 T-P2-01-D 最小切片（消 `deadline_during_tool`，锁回 51/2）。#58 T-P2-06、#60 T-P2-08 已合。
2. 本切片 = Track D **余项**：PR37 遗留的 tools 非阻塞缺口 7 项 + 53 场景剩余 2 个 trace_diff（`deadline`、`sidecar_budget_limit`）的**分诊记录**。
3. **G-GHA**：仓库 Actions 自 2026-10-15 02:40 CST 起 0 run（原因未查明）。真 Payne 裁定：所有 PR 的 G-GHA = **WAIVER-PENDING + 本地等效证据**（`raw/*` 命令输出），不得写成 PASS。
4. T-P2-09 / PC1#3 / PC3 / Track C / 桌面 sidecar 打包 **不在本切片**。

## 1. 交付物（按顺序）

### D0（第一个 commit）· PLAN.md 收口 T-P2-08
- `docs/rust_rebuild/PLAN.md`：`:5` 头注 tip 改 `fbcfa7a9`；`:29`、`:55`、`:86`、`:129` 把 T-P2-08「进行中，未合」改为 **已合 #60 `fbcfa7a9`（tip `31a462e6`；G-GHA 由真 Payne 豁免，本地等效证据）**。
- 债务（保留并标 owner）：
  - **m2**：CI 干净 checkout 无 rust-core release 二进制，`parity-quick` 恒 `PARITY_QUICK_RESULT=skip`；owner 后续 CI 切片，是否在 CI 编译由真 Payne 定（`:89` 原文保留）。
  - **m4**：另加 `protocol-sync-meta.yml`，由 `.github/workflows/protocol-sync.yml`、`.github/workflows/check-protocol-sync-paths.py`、`CONTRIBUTING.md` 触发，跑路径比对 + 同一 bash 块；owner 后续 CI 切片（`:90` 原文保留）。
  - **nit**：`review/2026-10-17-T-P2-08/PROVENANCE.md:74` 措辞中性化（不把「不加账单」与「原因未查」并列暗示因果）。可在本 PR 顺手修此一行。
- 「T-P2-01 D」行（`:46`）改为指向本任务 T-P2-01-D2（进行中，未合）。**不**写本 PR 已合。

### D1 · tools 缺口（每项先核实 @fbcfa7a9 是否仍存在，再 fix / already-fixed / wontfix+理由）

| id | 位置（起点，以 tip 实际行号为准） | 要求 |
|---|---|---|
| m2 | `tools/agent-loop-perf/run.py`（~:741/766/920 `transport` 字段） | perf JSON 顶层 `transport` 能区分 `native` / `ts-tcp` / `rust-tcp` / `rust-stdio`（含 rust-core 身份） |
| m4 | `tools/agent-loop-parity/collect_stream_chunks.py` `run_gateway`（`check=False`） | 运行前清残留 trace 或按 mtime/run-id 校验；gateway 非零退出不得读旧 trace |
| m5 | `tools/agent-loop-parity/run.py`（PR37 时 `:679-680` Rust intent 判定）+ `rust-tcp-sidecar.sh` / rust-core proof symlink | intent 判定与 wrapper/symlink 配套；`go-nogo.md` 不追改历史数字，只在 PROVENANCE 记 |
| m6 | `evidence/p1/go-nogo.md` 3a 表列名（PR37 `:136-138`） | 只允许改列名/脚注消歧，**不改数字** |
| E1 | `tools/agent-loop-perf/run.py:188` `resolve_base` | 优先 `origin/<branch>`（或先 fetch / 显式 `--base-sha`），本地分支过期时不得写错 `baseSha`；加单测 |
| n1 | `tools/agent-loop-perf/run.py:157` `d4_threshold` | D4 与差/D4 写进输出 JSON（如 `comparisonBaseline`） |
| n3 | mock backend `int(modelMs)`（现位置以 grep 为准；`run.py:88` 已写 float） | 非整数 `--model-ms` 不被截断；若已修则标 already-fixed 并附 grep |

### D2 · 53 余差分诊（只记录，不放宽门）
- `review/2026-10-17-T-P2-01-D2/TRIAGE_53.md`：`deadline`、`sidecar_budget_limit` 两个 trace_diff 的 diff 签名、根因归类（rust-core 实现 / 期望 / 计时）、建议 owner。若修复只涉 rust-core 且 ≤ 小改，可另起**单独 commit**，但须满足 P6。
- **不**改 allowlist、不改 53 分母、不在 `crates/**` 探针上补场景。

### D3 · 证据
`review/2026-10-17-T-P2-01-D2/**`：`PROVENANCE.md`（逐项表：id → 状态 → path:line → 测试）、`TRIAGE_53.md`、`raw/*.txt`（下列命令完整输出）。

## 2. 白名单

| 允许 | 禁止 |
|---|---|
| `docs/rust_rebuild/PLAN.md`、`review/2026-10-17-T-P2-08/PROVENANCE.md`（仅 :74 一行） | `apps/**` `ui/**` `src/**` `packages/**` |
| `tools/agent-loop-perf/**`、`tools/agent-loop-parity/**` | `crates/**`；根 `Cargo.toml`/`Cargo.lock`/`rust-toolchain.toml` |
| `evidence/p1/go-nogo.md`（仅 m6 列名/脚注） | 覆盖 `evidence/p1/*.json` 数字；改 `.github/workflows/**` |
| `review/2026-10-17-T-P2-01-D2/**` | 翻转默认 transport（仍 native）；改 supervisor 语义（sidecar 仍 opt-in A） |
| （仅 D2 选修时）`rust-core/pilotdeck-agent/**`、`rust-core/pilotdeck-transport/**` | 协议 schema；T-P2-09 事件投影 |

## 3. Out
- T-P2-09（status `kind`/`text` 投影）、PC1#3/PC3 重采、PC2、Track C、m2/m4 CI 债务实施、desktop 打包、默认 transport 切换。

## 4. 验收（Formal 钉）

| # | 判据 | 命令 / 证据 |
|---|---|---|
| P1 | D0 PLAN：T-P2-08 已合 @fbcfa7a9（#60, tip 31a462e6, G-GHA 真 Payne 豁免）；m2/m4/nit 三条债务在；本 PR 未冒充已合 | `git diff fbcfa7a9 -- docs/rust_rebuild/PLAN.md`；D0 为分支第一个 commit（`git log --reverse fbcfa7a9..HEAD`） |
| P2 | 白名单 | `git diff --name-only fbcfa7a9...HEAD` ⊆ §2；无 `apps/**`、`crates/**`、`.github/**` |
| P3 | 7 项逐项闭环 | PROVENANCE 表 7 行，每行 fix/already-fixed/wontfix + path:line + 测试名；无空行 |
| P4 | Python 单测 | `python3 -m pytest tools/agent-loop-perf tools/agent-loop-parity -q`（或仓库既有 unittest 入口）全绿；E1、n1、m2、m4 各至少 1 新测例 |
| P5 | Node 单测（若改 .mjs） | `node --test tools/agent-loop-parity tools/agent-loop-perf` 绿 |
| P6 | 对拍不回退 | rust-core `cd rust-core && cargo +1.99.1 build --release --locked --bin pilotdeck-agent-loop-sidecar`；身份 `readlink -f "$PILOTDECK_RUST_SIDECAR_BIN"`；stdio 快速门 `pure_text`/`single_tool` 0 semantic diff；full-53 = **51/2/0/0**（名仅 `deadline`+`sidecar_budget_limit`），若 D2 修掉某项则更优数字需两次复现 |
| P7 | rust-core 门（仅 D2 改 rust-core 时） | `cargo +1.99.1 fmt --check`、`clippy --locked -- -D warnings`、`test --locked` 绿 |
| P8 | 证据 | `TRIAGE_53.md` + `raw/*`；perf 产物 `baseSha` 与 `git merge-base HEAD origin/rust_standalone_alpha1` 一致（E1 实证） |
| P9 | G-GHA | 标 **WAIVER-PENDING**，以 P4–P7 `raw/*` 为本地等效证据；不得写 PASS |
| P10 | 提交纪律 | 仅普通追加 commit；无 force-push/rebase/amend；PR **draft**；默认 transport 仍 native |

## 5. 流程
- PR 标题建议：`T-P2-01-D2: Track D rest — tools follow-ups m2/m4/m5/m6/E1/n1/n3 + 53 triage`
- draft → **QA Formal**（`qa-gate-<pr>-<tip>/SUMMARY.md`）→ **Reviewer**（parent 在 Payne 1:1 拉 Mac，先进度后质量；Arch 不在群催）→ ready/merge **仅真 Payne**。
- 合并后 Desktop chrome smoke（证据 PR，勿合、无 Reviewer）。
