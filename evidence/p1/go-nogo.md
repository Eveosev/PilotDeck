# T-P1-05 两组对照数据（Rust-tcp vs native / Rust-tcp vs TS-tcp）

本文件**只给数据**。go / 有条件 go / no-go 由 **T-P1-06** 判定，须 Payne 签字。这里不写结论。

## 口径表

| 用语 | 含义 |
|---|---|
| **Rust-tcp** | Rust sidecar 走 TCP（`tools/agent-loop-parity/rust-tcp-sidecar.sh` → `pilotdeck-agent-loop --listen`） |
| **TS-tcp** | TS sidecar 走 TCP（harness 默认 `dist/src/cli/pilotdeck-agent-loop-sidecar.js`） |
| **native** | 产品默认 in-process AgentLoop |
| **source=sidecar** | live sidecar trace（#36 follow-up：不再标 `gateway`） |
| **source=native** | live native adapter trace |
| **raw** | 墙钟总量，含 `configuredModelMs` |
| **net-of-delay** | 框架开销：turn = `turn_ms − modelMs × 该样本 model 次数`；model 迭代 = 每次 − 200；流块只从 **interval[0]** 扣 200，后续间隔不扣 |
| **D4** | `max(native 净 P95 × 10%, 5ms)`。判定列**只看净 P95**。delay-0 的 `evidence/perf-baseline/*.json` 只作形态参考，不直接比 |

T-P1-03 `summary.md` 曾把「TS native vs Rust sidecar TCP」叫 "TS-tcp"。**本任务不用那个叫法。**

## 采集 provenance

| 项 | 值 |
|---|---|
| 主机 | Cursor cloud VM `cursor`，Linux 6.12.94+ x86_64，4 CPU，15 GiB |
| 采集 HEAD / `collectSha` | `df1d0cc98ccb45a82e877dd28e1bf28211ee35cb`（本 PR harness commit；`gitDirty=false`） |
| base | `rust_standalone_alpha1` @ `b3399c14`（#36 已合） |
| 延迟 | 三路径同一套：`--model-ms 200`（`delayPolicy=zero+modelMs:200`） |
| Node / Python / rustc | v22.14.0 / 3.12.3 / 1.83.0 |
| `pnpm build` | 本 VM，EXIT 0，`dist/` 存在（C0） |
| Rust bin | `cargo build -p pilotdeck-agent-loop --release` EXIT 0 |
| n | turn / model：**30** 次/路径/场景；流块 chars_50 另 30 次（native / TS-tcp 有间隔；Rust-tcp 见下） |
| 百分位 | inclusive-rank，`rank = p/100 × (n−1)`，线性插值 |

**披露（`provenance.baseSha`，数字不变，此处不修）：** `evidence/p1/perf-modelms200-*.json` 的 `provenance.baseSha` 记为 `f376b4a5`（`f376b4a5b6c487367a9671ddb47fd2fefe9eba8a`）。实际 base 是 `rust_standalone_alpha1` @ `b3399c14`（`b3399c141efaf6fc63daa739c580be7769e40a24`）。该陈旧值由采集 HEAD `df1d0cc9` 上的 `tools/agent-loop-perf/run.py:672` 写入（`base_branch, base_sha = resolve_base(source, args.base_branch)`）。对照表里的计时数字不受影响。本 PR 不改 `tools/**`。

命令（均在仓库根、干净树、输出到 `/tmp` 再拷入本目录）：

```bash
pnpm build
cargo build -p pilotdeck-agent-loop --release

python3 tools/agent-loop-perf/run.py --pilotdeck-root "$PWD" \
  --scenarios pure_text,single_tool,sidecar_live_model_stream_chars_50 \
  --model-ms 200 --iterations 30 --adapter-timeout-seconds 120 \
  --transports native --output /tmp/t-p1-05/perf-native
# ts-tcp: --transports tcp --output .../perf-ts-tcp
# rust-tcp: --transports tcp --pilotdeck-tcp-sidecar-cmd tools/agent-loop-parity/rust-tcp-sidecar.sh

PARITY_PERF=1 python3 tools/agent-loop-parity/collect_stream_chunks.py \
  --pilotdeck-root "$PWD" --run-gateway --run-gateway-arg=--adapter-timeout-seconds --run-gateway-arg=120 \
  --sidecar-transport tcp --transport native --trace-source native
# ts-tcp / rust-tcp 换 --transport 与 --trace-source sidecar
```

`--model-ms 200` 场景 `delay_injected=true`，不进 T-P0a-03 `primaryBaseline`。对照读各 JSON 的 `scenarios.*` / `comparisonBaseline` 以及 `*_net_of_model_ms`。

## 单位与 C4

- **turn**：`submit_turn` → `turn_completed`（不含 Gateway 启停）。
- **model 迭代**：一次 mock HTTP/流结束。`pure_text` / live-stream 每 turn 1 次；`single_tool` 每 turn 2 次（故 turn net = raw − 400）。
- **流块**：Gateway 客户端相邻 `assistant_text_delta` 间隔。
  - harness `n_chunks`：adapter yield 的 `text_delta` 次数（planned / `model.stream state=chunks`）。chars 1/50/500 钉死 **98 / 22 / 4**。
  - `perf_n_chunks`：Gateway 观测到的 `assistant_text_delta` 次数。
  - interval[0] 含 mock `modelMs:200`；归因看 net 或 `stream_chunk_ms_after_first`。

## 1. turn（raw + net）

判定列 = 相对 **native 净 P95** 的差 / 该行 D4。Rust-tcp vs TS-tcp 只作参考。

### `pure_text`（n=30，1 model / turn → net = raw − 200）

| path | raw P50 | raw P95 | net P50 | net P95 | n | 相对 native 净P95差 | D4 | 差/D4 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 773.364 | 850.044 | 573.364 | 650.044 | 30 | — | — | — |
| Rust-tcp | 794.079 | 882.268 | 594.079 | 682.268 | 30 | +32.224 | 65.004 | 0.496 |
| TS-tcp | 809.119 | 877.735 | 609.119 | 677.735 | 30 | +27.691 | 65.004 | 0.426 |

Rust-tcp vs TS-tcp 净 P95：682.268 − 677.735 = **+4.533 ms**（参考）。

### `single_tool`（n=30 turn；model 次数=2 → net = raw − 400）

| path | raw P50 | raw P95 | net P50 | net P95 | n | 相对 native 净P95差 | D4 | 差/D4 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 1150.657 | 1203.727 | 750.657 | 803.727 | 30 | — | — | — |
| Rust-tcp | 1133.873 | 1210.885 | 733.873 | 810.885 | 30 | +7.158 | 80.373 | 0.089 |
| TS-tcp | 1171.438 | 1290.847 | 771.438 | 890.847 | 30 | +87.120 | 80.373 | 1.084 |

Rust-tcp vs TS-tcp 净 P95：810.885 − 890.847 = **−79.962 ms**（参考）。

### live-stream chars=50 turn（n=30，1 model / turn → net = raw − 200）

| path | raw P50 | raw P95 | net P50 | net P95 | n | 相对 native 净P95差 | D4 | 差/D4 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 1051.322 | 1153.079 | 851.322 | 953.079 | 30 | — | — | — |
| Rust-tcp | 993.603 | 1075.015 | 793.603 | 875.015 | 30 | −78.064 | 95.308 | −0.819 |
| TS-tcp | 1044.698 | 1138.183 | 844.698 | 938.183 | 30 | −14.896 | 95.308 | −0.156 |

## 2. model 迭代（raw + net）

net = 每次 iteration − 200。`single_tool` n=60（30 turn × 2）。

### `pure_text`

| path | raw P50 | raw P95 | net P50 | net P95 | n | 相对 native 净P95差 | D4 | 差/D4 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 217.852 | 230.179 | 17.852 | 30.179 | 30 | — | — | — |
| Rust-tcp | 241.801 | 251.520 | 41.802 | 51.520 | 30 | +21.341 | 5.000 | 4.268 |
| TS-tcp | 222.066 | 224.744 | 22.066 | 24.744 | 30 | −5.435 | 5.000 | −1.087 |

Rust-tcp vs TS-tcp 净 P95：51.520 − 24.744 = **+26.776 ms**（参考）。

### `single_tool`

| path | raw P50 | raw P95 | net P50 | net P95 | n | 相对 native 净P95差 | D4 | 差/D4 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 225.515 | 233.550 | 25.515 | 33.550 | 60 | — | — | — |
| Rust-tcp | 229.117 | 247.096 | 29.117 | 47.096 | 60 | +13.546 | 5.000 | 2.709 |
| TS-tcp | 229.836 | 238.952 | 29.836 | 38.952 | 60 | +5.402 | 5.000 | 1.080 |

### live-stream chars=50

| path | raw P50 | raw P95 | net P50 | net P95 | n | 相对 native 净P95差 | D4 | 差/D4 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 239.288 | 245.186 | 39.288 | 45.186 | 30 | — | — | — |
| Rust-tcp | 326.814 | 341.974 | 126.814 | 141.974 | 30 | +96.788 | 5.000 | 19.358 |
| TS-tcp | 260.594 | 277.166 | 60.593 | 77.166 | 30 | +31.980 | 5.000 | 6.396 |

Rust-tcp 在 live-stream 上 model 净 P95 明显高于 native / TS-tcp。`stream_chunk_ms=[]`、`perf_n_chunks=1`、`firstDeltaBeforeProviderCompletion` oracle FAIL 的根因（行号在 `b3399c14` 核对）：Rust sidecar 只调用 host 的一次性 `stream`，从不调用 `stream_next`，把多段 delta 合成一段。`crates/pilotdeck-agent-loop/src/sidecar.rs:1769-1777` 只发 `operation: "stream"`；`:1816-1832` 的 `assemble_canonical_events` 把全部 `text_delta` 拼进一个字符串。缺逐块 firstDelta 是 **crates 产品行为上的 A2 功能缺口**（T-P1-04 A2：首 delta 应早于 provider completion）。Payne 已接受为已披露的数据缺口，作为 **T-P1-06 输入** / 单独 crates 任务（**未解锁**）。本 PR 不修。

## 3. 流块

### 3a. 30× chars=50（与 turn/model 同一 `--model-ms 200` 配置）

| path | harness n_chunks (p50) | perf n_chunks | 间隔 n | 全间隔净 P50/P95 | interval[0] 净 P50/P95 | after-first P50/P95 | 相对 native after-first 净P95差 | D4 | 差/D4 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 22 | 22 | 630 | 1.899 / 6.334 | 3.539 / 5.418（n=30） | 1.833 / 6.340（n=600） | — | — | — |
| TS-tcp | 22 | 22 | 630 | 3.511 / 6.118 | 3.253 / 5.135（n=30） | 3.513 / 6.123（n=600） | −0.217 | 5.000 | −0.043 |
| Rust-tcp | 22 | **1** | **0** | — | — | — | **无间隔可报** | 5.000 | — |

Rust-tcp：30 次 chars=50 的 `stream_chunk_ms=[]`。Gateway 每 turn 只观测到 **1** 个 `assistant_text_delta`（`n_chunks` 样本 p50=1），无法形成间隔。harness 仍按 char 切片记 22。

### 3b. live `--run-gateway` 一次（chars 1 / 50 / 500）

| path | chars | source | transport | planned | harness n_chunks | perf_n_chunks | 间隔 n | i0 raw | i0 net | after-first n/P50/P95 | firstDeltaBeforeProviderCompletion |
|---|---:|---|---|---|---:|---:|---:|---:|---:|---|---|
| native | 1 | native | native | 否 | 98 | 98 | 97 | 200.107 | 0.107 | 96 / 1.805 / 6.421 | true |
| native | 50 | native | native | 否 | 22 | 22 | 21 | 203.727 | 3.727 | 20 / 1.827 / 5.627 | true |
| native | 500 | native | native | 否 | 4 | 4 | 3 | 205.039 | 5.039 | 2 / 5.095 / 7.532 | true |
| TS-tcp | 1 | sidecar | ts-tcp | 否 | 98 | 98 | 97 | 204.694 | 4.694 | 96 / 3.260 / 5.454 | true |
| TS-tcp | 50 | sidecar | ts-tcp | 否 | 22 | 22 | 21 | 202.997 | 2.997 | 20 / 3.352 / 5.887 | true |
| TS-tcp | 500 | sidecar | ts-tcp | 否 | 4 | 4 | 3 | 202.092 | 2.092 | 2 / 3.772 / 3.886 | true |
| Rust-tcp | 1 | sidecar | rust-tcp | 否 | 98 | **1** | **0** | — | — | — | **false** |
| Rust-tcp | 50 | sidecar | rust-tcp | 否 | 22 | **1** | **0** | — | — | — | **false** |
| Rust-tcp | 500 | sidecar | rust-tcp | 否 | 4 | **1** | **0** | — | — | — | **false** |

Rust-tcp live：`outputContainsSTREAM_PREFIX=true`，但 `firstDeltaBeforeProviderCompletion=false`，`stream_chunk_ms` 为空。native / TS-tcp 的 `stream_chunk_ms` 非空，`source` 不是 gateway。根因与处置（A2 功能缺口，T-P1-06 输入 / 单独 crates 任务，未解锁，本 PR 不修）见上文 live-stream model 段。

Rust-tcp vs native 流块：没有可比较的间隔样本（n=0）。Rust-tcp vs TS-tcp 同样。

## delay-0 基线（仅形态，不比绝对值）

`evidence/perf-baseline/`（`delays.*=0`，`collectSha=248d7fbb`，另一台机器）turn P50：native `pure_text` 563 / tcp 627。本 VM modelMs:200 的 raw turn 大约再加 ~200ms，形态仍是 native ≈ tcp。**禁止把那组 delay-0 数字当本关 D4 锚。**

## 未跑 / 采集瑕疵（如实）

1. **未跑** 53 场景 live Gateway gate（本关只钉计数单测；`test_trace.py` 91/91，gate=53）。
2. **未跑** 真模型、stdio、生产 TCP 认证（D7）。
3. **Rust-tcp 流块间隔采不到**：`stream_chunk_ms=[]`，`perf_n_chunks=1`，firstDelta oracle FAIL。C1「`stream_chunk_ms` 非空」在 native / TS-tcp 成立，Rust-tcp 不成立。根因是 sidecar 只调 unary `stream`、不调 `stream_next`（见 live-stream model 段），harness 已开 `PARITY_PERF`。
4. live `--run-gateway` 的 **same-version 对拍不是 PASS**：
   - native / TS-tcp：sidecar 被误标 `rustSidecarIntended=true`（默认 TS 命令字符串含 `pilotdeck-agent-loop`），fingerprint 缺失 → exit 2。native/sidecar **trace 仍写出**，计时可用。
   - Rust-tcp：`firstDeltaBeforeProviderCompletion` oracle FAIL + 语义 diff（chars=1 时 98 处），exit 1。sidecar trace 仍写出。
5. `collect_stream_chunks.py --run-gateway-arg --adapter-timeout-seconds` 这种空格写法会被 argparse 吃掉；要用 `--run-gateway-arg=--adapter-timeout-seconds`。
6. 未把 chars=1 / 500 做成 30 次独立 turn（chars=500 一次只有 3 个间隔）。chars=50 的 30 次覆盖 native / TS-tcp 流块 P50/P95。
7. 未改 `crates/**` / `Cargo.lock`。缺逐块 firstDelta 的 A2 功能缺口本 PR 不修（T-P1-06 输入 / 单独 crates 任务，未解锁）。
8. **`provenance.baseSha` 陈旧**：JSON 为 `f376b4a5`，实际 base 为 `b3399c14`（见采集 provenance 披露）。数字不受影响；此处不修 `tools/**`。

## 产物

| 文件 | 内容 |
|---|---|
| `evidence/p1/go-nogo.md` | 本对照（无决议） |
| `evidence/p1/perf-modelms200-{native,ts-tcp,rust-tcp}.json` | 30× 三场景 raw 样本 + 净统计 |
| `evidence/p1/stream-chunks-live-{native,ts-tcp,rust-tcp}-{1,50,500}.json` | live 流块（planned 的 `stream-chunks-{1,50,500}.json` **未覆盖**） |
| `review/2026-10-15-T-P1-05/TASK_DEF.md` | 定稿 + 锁定决策 |
