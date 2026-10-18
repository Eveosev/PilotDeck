# TASK_DEF · T-PC1-3 · PC3 n=30 重采 + 判定 PC1#3（rust-core TCP）

> 状态：**已冻结**（2026-10-18 ~15:50 CST）；箱本地 `review/2026-10-18-T-PC1-3/`。
> `unlocked=true`（见 `UNLOCK.md`，standing「其余全做」2026-10-17 ~12:10 CST）。
> 基线：`rust_standalone_alpha1@04e04ae33217288b226c13cec56ba1203f1ba333`（#64 merge，T-P2-09；tip `5bccc465`）。
> 对照（均 @04e04ae3）：`docs/rust_rebuild/PLAN.md:5`（tip 仍写 da96f054）、`:29`（T-P2-09 进行中；PC1#3/PC2/PC3 open）、`:47`（PC1#3）、`:48`（PC3）、`:56`（T-P2-09 进行中）、`:78`（G-P2-PERF：TCP 轮在 T-P2-05 后；PC1#3/PC3 单独成行）、`:111` / `:113`（Q1 PC1 第 3 项 / PC3）、`evidence/p1/go-nogo.md`（旧探针 TCP 基线与 E1 披露）、`tools/agent-loop-perf/METRICS.md`（after-first / D4）、`tools/agent-loop-parity/rust-tcp-sidecar.sh`（HOST/PORT→`--listen`；须显式 `PILOTDECK_RUST_SIDECAR_BIN`）。
> **允许** draft PR；**ready/merge 仍等真 Payne**。禁止 force-push / rebase / amend，仅普通追加 commit。

## 0. 前置

1. #64 已合 tip `5bccc465` → merge `04e04ae3`：T-P2-09（rust-core `agent_status` `kind`+`text`）已入主线。G-GHA 由真 Payne 豁免，本地等效证据。
2. PLAN @04e04ae3 仍写 tip `da96f054`、T-P2-09 **进行中（本 PR，未合）**、PC1#3 / PC3 **open**——本切片 D0 收口 #64，并把本任务标为进行中。
3. **为何 PC1#3 与 PC3 同一切片**（PLAN 证据）：
   - PC1#3（`:47`）：流块 after-first 净 P95 差/D4 ≤ 1；FT-1 单次 r2 实测 1.394 / 1.822，**移交 PC3 的 n=30**（`:111`）。
   - PC3（`:48`、`:113`）：同一套 `--model-ms 200`、n=30，QA Formal，`baseSha` 正确（E1 修复或手工核对）。
   - **T-P2-04 合入后旧探针 TCP 数字作废，必须重采**（`:47`、`:48`）。T-P2-05 listen+token（#56）与 T-P2-06 supervisor（#58）已合 → 本轮采 **rust-core TCP**（常驻 listener），不是仓根探针、也不是 stdio。
4. **G-GHA**：仓库 Actions 自 2026-10-15 02:40 CST 起 0 run。真 Payne 裁定：G-GHA = **WAIVER-PENDING + 本地等效证据**（`raw/*`），不得写成 PASS。
5. **Out of this slice**：PC2 关闭 / Track C (FT-2a) / CI m2·m4 债务 / 默认 transport 翻转 / `apps/**` / 覆盖既有 `evidence/p1/*.json` 冒充「旧数字仍有效」。

## 1. 交付物（按顺序）

### D0（第一个 commit）· PLAN 收口 #64 / T-P2-09，打开 T-PC1-3
- `docs/rust_rebuild/PLAN.md`：
  - `:5` 头注 tip → `04e04ae3`（#64 合并，T-P2-09；tip `5bccc465`；G-GHA 由真 Payne 豁免，本地等效证据）。
  - `:29` P2 状态行：记 #64 / T-P2-09 已合；T-PC1-3（PC1#3+PC3）进行中（本 PR，未合）；PC2 仍 open。
  - `:56` T-P2-09 → **已合 #64 `04e04ae3`（tip `5bccc465`；G-GHA 由真 Payne 豁免，本地等效证据）**。
  - `:47` PC1#3 → **进行中**（本 PR，draft，未合）；一句指向 rust-core TCP n=30 重采后判定 after-first 差/D4。
  - `:48` PC3 → **进行中**（本 PR，draft，未合）；同一采集。
  - `:111` / `:113` Q1 脚注可加「重采主体改为 rust-core TCP（T-P2-04/05 后）」；**不**冒充 PC1#3/PC3 已关。
  - R4（`:127`）若仍写 rust-core 设 TCP 就 exit 2：可脚注「T-P2-05 后已可 `--listen`；旧句留作历史」，或最小改一句；非本切片强制。
- **不**冒充本 PR 已合；**不**关 PC2；**不**写 Track C 已开。

### D1 · rust-core TCP 身份 + 采集脚手架
目标：同机一次跑通 **native** 与 **rust-core TCP**（可选并列 TS-tcp 作参考），`--model-ms 200`，n=30。

| 项 | 要求 |
|---|---|
| 构建 | `cd rust-core && cargo +1.99.1 build --locked --release --bin pilotdeck-agent-loop-sidecar` |
| 身份 | proof symlink：`rust-core/target/rust-core-proof/pilotdeck-agent-loop` → `../release/pilotdeck-agent-loop-sidecar`；`export PILOTDECK_RUST_SIDECAR_BIN=<abs>/…/pilotdeck-agent-loop`（**禁止**落到仓根探针 `target/release/pilotdeck-agent-loop`） |
| TCP wrapper | `--pilotdeck-tcp-sidecar-cmd tools/agent-loop-parity/rust-tcp-sidecar.sh`（`:6-12`：HOST/PORT→`--listen`） |
| baseSha | 采集时传 `--base-sha 04e04ae33217288b226c13cec56ba1203f1ba333`（或 Formal 可核的等价 full SHA）。JSON `provenance.baseSha` **必须**等于该 merge；若工具仍写错 → 修 `tools/agent-loop-perf/run.py`（E1）或在 PROVENANCE **手工核对**并披露（PLAN `:48` 允许二者之一） |
| 默认 transport | 产品仍 **native**；本任务只改测量路径，不改 `AgentLoopDeploymentProfile` 默认 |

### D2 · PC3 采集（perf + 流块）
1. **perf**（`tools/agent-loop-perf/run.py`）：
   - `--model-ms 200 --iterations 30`
   - 场景至少：`pure_text`、`single_tool`、`sidecar_live_model_stream_chars_50`
   - transports：`native` + rust-core **tcp**（经 wrapper + `PILOTDECK_RUST_SIDECAR_BIN`）；可选同机 `ts-tcp` 参考
   - 输出到新目录（建议 `evidence/p2/pc1-3-pc3/` 或仅 `review/2026-10-18-T-PC1-3/raw/perf/`）——**禁止覆盖** `evidence/p1/perf-modelms200-*.json`
2. **流块 after-first**（PC1#3 核心）：
   - 对 chars **1 / 50 / 500**：rust-core TCP vs native，报 `firstDeltaBeforeProviderCompletion`、`perf_n_chunks` vs harness `n_chunks`、`stream_chunk_ms_after_first` 净 P50/P95、相对 native 的差、D4=`max(native after-first 净 P95×10%, 5ms)`、**差/D4**
   - **PC1 第 3 项关门钉**：chars=1 与 chars=50 的 after-first 差/D4 **均 ≤ 1**（chars=500 如实报；样本间隔少时注明 n）
   - 优先 n=30 独立 turn（对齐 PC3）；若 chars=500 仍只能 live 单次，须在 PROVENANCE 披露并与 FT-1 口径区分
   - 复用 / 对齐 `PARITY_PERF=1` + `collect_stream_chunks.py`（或 perf JSON 内已有 `stream_chunk_ms`）；口径见 `METRICS.md`（interval[0] 含 modelMs；after-first = `[1:]`）
3. **PC1 第 1–2 项复核**（非本切片新功能，但是判定前置）：rust-core TCP 上 chars 1/50/500 须 `firstDeltaBeforeProviderCompletion=true` 且 `perf_n_chunks` = harness `n_chunks`。若 rust-core **缺** `stream_next` 拉流导致 `perf_n_chunks=1` / 无间隔 → **如实 BLOCK / 记 open**，不得用探针旧 1.394/1.822 顶替，也不得宣称 PC1#3 已关。

### D3 · 报告与 PLAN 终态（同 PR 后续 commit，或 D0 之外的 docs commit）
- `review/2026-10-18-T-PC1-3/PROVENANCE.md`：tip、`collectSha`/`baseSha`/`gitDirty`、二进制 sha256、toolchain、命令行、env（含 `PILOTDECK_RUST_SIDECAR_BIN` 与 proof `readlink -f`）、主机规格
- `PC3_TABLE.md`：三场景 × 路径的 turn/model 净 P50/P95（D4 / Q2 仅记录，**不关 PC2**）
- `PC1_3_STREAM.md`：after-first 表 + 差/D4；明确 PC1#3 **关闭 / 仍 open**（≤1 才可在 PLAN 标关闭；>1 如实报，**不擅自宣布关闭**——关闭权归真 Payne / QA Formal）
- `raw/*`：perf JSON、流块 JSON、fmt/clippy 若改了 tools、identity 证明
- 若本 PR Formal 后确认关闭：另 commit 把 PLAN `:47`/`:48` 标为已完成并引用本 tip；若未达标只把 PC3 标「数据已交付、待 Payne 判」，PC1#3 保持 open 并写入新实测

### D4 · PR
- 标题建议：`T-PC1-3: PC3 n=30 rust-core TCP recollect; decide PC1#3 after-first`
- **draft**；普通追加 commit（D0 必须为相对 `04e04ae3` 的第一个）。

## 2. 白名单

| 允许 | 禁止 |
|---|---|
| `docs/rust_rebuild/PLAN.md` | `apps/**` `ui/**` `packages/**` |
| `evidence/p2/**`（新建；或不建而只放 review/） | 覆盖 / 改写 `evidence/p1/*.json` 数字冒充仍有效 |
| `review/2026-10-18-T-PC1-3/**` | `crates/**` 探针上补 `stream_next`；根 `Cargo.toml` 降 MSRV |
| `tools/agent-loop-perf/**`（仅 E1/`--base-sha` 或导出路径最小修复） | 翻转默认 transport；改 supervisor 语义；desktop 打包 hello→真 sidecar |
| `tools/agent-loop-parity/**`（仅 wrapper/README 最小订正，**不**改 `rust-tcp-sidecar.sh` 默认探针路径除非 Formal 同步改 P4） | 关 PC2；实施 Track C / CI m2·m4 |
| 必要时 `rust-core/**` **仅**当发现测量 blocker（如缺 stream 投影）且经 TASK_DEF 外另开——**默认本切片不改 rust-core 产品代码**；若缺 stream_next 则停在证据 + open，不偷偷修 | `.github/workflows/**` |

## 3. Out
- 关闭 PC2；声称「换 rust-core 就会过 PC2」；用 stdio 数字对 #37 Rust-tcp 表
- Track C / FT-2a；CI m2/m4；默认 transport≠native
- 用探针旧 after-first 1.394/1.822 关闭 PC1#3
- ready/merge（真 Payne）；force-push / rebase / amend

## 4. 验收（Formal 钉）

| # | 判据 | 命令 / 证据 |
|---|---|---|
| P1 | D0 PLAN：#64/T-P2-09 已合 @04e04ae3（tip 5bccc465，G-GHA 真 Payne 豁免）；PC1#3+PC3 标进行中/本 PR；未冒充已合/未关 PC2 | `git diff 04e04ae3 -- docs/rust_rebuild/PLAN.md`；`git log --reverse 04e04ae3..HEAD` 首 commit = D0 |
| P2 | 白名单 | `git diff --name-only 04e04ae3...HEAD` ⊆ §2；无 `apps/**` |
| P3 | 身份 | `PILOTDECK_RUST_SIDECAR_BIN` → proof symlink；`readlink -f` → `…/rust-core/target/release/pilotdeck-agent-loop-sidecar`（非仓根探针） |
| P4 | PC3 协议 | `--model-ms 200`、n=30、三场景、native + rust-core tcp；`provenance.baseSha` == `04e04ae3…`（E1 或手工披露） |
| P5 | PC1 前置 | rust-core TCP chars 1/50/500：`firstDeltaBeforeProviderCompletion` 与 `perf_n_chunks` 已报；缺流则记 blocker，不关 PC1#3 |
| P6 | PC1#3 数字 | chars=1 与 chars=50 after-first 差/D4 已算；≤1 → 可建议关闭；>1 → 如实 open。旧 1.394/1.822 **不得**当本轮结果 |
| P7 | 不关 PC2 | 文中明确 PC2 仍 open；Q2/D4 model/turn 仅记录 |
| P8 | G-GHA | **WAIVER-PENDING** + `raw/*` 本地等效；不得写 PASS |
| P9 | 提交纪律 | 仅普通追加；PR **draft**；默认 transport 仍 native；不覆盖 `evidence/p1/*` |

## 5. 流程
- draft → **QA Formal**（`qa-gate-<pr>-<tip>/SUMMARY.md`）→ **Reviewer**（parent 在 Payne 1:1 拉 Mac；Arch 不在群催）→ ready/merge **仅真 Payne**。
- 合并后 Desktop chrome smoke（证据 PR，勿合、无 Reviewer）。
