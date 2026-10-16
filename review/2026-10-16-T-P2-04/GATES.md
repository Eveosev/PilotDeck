# GATES · T-P2-04 · P1–P11

命令在源码提交 `87b2d6b4` 的工作树上执行（当时 `git status --porcelain` 为空）。完整日志在 `raw/`。下面每项先给判定，再给命令和决定性输出。

## P1 源树钉死 — PASS

```bash
sha256sum agentcpm-rust-core-src.tgz
# ef4235c2027f8eb58f5356a107826debb503946f1e81fd0976eaa830f420956d

sha256sum tiktoken-rs-0.12.0.crate
# 027853bbf8c7763b77c5c595f1c271c7d536ced7d6f83452911b944621e57fc2

diff -rq --exclude=agentcpm-rust-core --exclude=target \
  /tmp/agentcpm-extract/agentcpm-rust-core-src rust-core
```

```
Only in rust-core: .gitattributes
Only in rust-core: .gitignore
Files .../rust-toolchain.toml and rust-core/rust-toolchain.toml differ
Only in rust-core/vendor/tiktoken-rs: assets
```

`diff -u` 只改了 `channel = "1.99"` → `"1.99.1"`。assets sha256 与 §2.4 四行一致，合计 6966788 字节。`*.rs`、各 `Cargo.toml`、`Cargo.lock` 与 tarball 0 diff。落地时 `git status --porcelain rust-core/vendor/tiktoken-rs/assets` 为 `?? rust-core/vendor/tiktoken-rs/assets/`（未忽略；porcelain 把未跟踪目录收成一行）。`git ls-files` 列出四个 `.tiktoken`。`git check-ignore` 无输出。

## P2 工具链 — PASS（字面 grep 非空，见下）

```bash
grep -n 'resolver = "3"\|edition = "2024"\|rust-version = "1.93"\|unsafe_code = "forbid"' rust-core/Cargo.toml
cat rust-core/rust-toolchain.toml
grep -n 'version = "[0-9^~]' rust-core/Cargo.toml rust-core/pilotdeck-*/Cargo.toml
```

```
7:resolver = "3"
17:edition = "2024"
18:rust-version = "1.93"
32:unsafe_code = "forbid"
```

```
[toolchain]
channel = "1.99.1"
components = ["rustfmt", "clippy"]
profile = "minimal"
```

字面 grep **不是**空输出：

```
rust-core/Cargo.toml:18:rust-version = "1.93"
rust-core/Cargo.toml:19:version = "0.1.0"
```

这两行是 `[workspace.package]`，不是依赖。`[workspace.dependencies]` 与四个成员的外部依赖都是 `"=x.y.z"`。`Cargo.toml` 相对 tarball 0 diff，不能为了让 grep 变空去改它。

## P3 快速门 — PASS（696）

工作目录 `rust-core/`。`F` = `-p pilotdeck-protocol -p pilotdeck-tokenizer -p pilotdeck-agent -p pilotdeck-transport`。

```bash
cargo +1.99.1 --locked fmt --check $F
# EXIT:0

cargo +1.99.1 build --release --locked -p pilotdeck-transport --bin pilotdeck-agent-loop-sidecar
# Finished release profile [optimized] target(s) in 21.26s
# EXIT:0

cargo +1.99.1 clippy --locked $F --all-targets -- -D warnings
# Finished dev profile [unoptimized + debuginfo] target(s) in 4.46s
# EXIT:0

cargo +1.99.1 test --locked $F
# EXIT:0
```

`test result` 按包相加（每个测试二进制计一次）：

| crate | passed |
|---|---:|
| pilotdeck-agent | 479 |
| pilotdeck-transport | 174 |
| pilotdeck-protocol | 27 |
| pilotdeck-tokenizer | 16 |
| 合计 | **696** |

failed 全是 0。与 tarball `PROVENANCE.md:65` 的 479 / 174 / 27 / 16 一致。

## P4 默认路径未切 — PASS

```bash
git diff --stat 2238c7ba -- apps/ tools/ src/ ui/ crates/ packages/
# 无输出，退出码 0

git show 87b2d6b4:apps/desktop/scripts/rust-hello.mjs | grep -n 'RUST_HELLO_BIN ='
# 8:export const RUST_HELLO_BIN = "pilotdeck-agent-loop-hello";

grep -n 'target/release/pilotdeck-agent-loop"' \
  tools/agent-loop-parity/rust-stdio-sidecar.sh \
  tools/agent-loop-parity/rust-tcp-sidecar.sh
# rust-stdio-sidecar.sh:12
# rust-tcp-sidecar.sh:8

grep -n 'normalized === "native") return "native"' src/cli/AgentLoopDeploymentProfile.ts
# 139:  if (normalized === undefined || normalized === "" || normalized === "native") return "native";

ls target/release/pilotdeck-agent-loop-sidecar
# No such file or directory（P3 之后；根 1.83 release 构建之后仍然没有这个文件名）
```

## P5 AGPL / 合箱 A / 无 TCP / PC* — PASS

```bash
git diff 2238c7ba -- LICENSE
# 空，退出码 0
```

`rust-core/LICENSE` 首行是 `GNU AFFERO GENERAL PUBLIC LICENSE`。vendor `tiktoken-rs/LICENSE` 是 MIT。未做 TCP/D7。PC2 仍 open；PC1#3 / PC3 旧数作废、待重采。见 `ADOPT_NOTES.md`。

## P6 白名单 / 历史 — PASS（证据提交之后复核）

父提交 `2238c7ba`，线性，draft，未 ready、未 merge、未 force-push / rebase / amend。

源码提交 `87b2d6b4` 的 `git diff --name-only 2238c7ba..87b2d6b4` 只有 `docs/rust_rebuild/PLAN.md` 与 `rust-core/**`。`PLAN.md` 只改三处：D-CORE 注脚、T-P2-04 行、T-P2-08 行。证据提交只增加 `review/2026-10-16-T-P2-04/**`。最终 `git diff --name-only 2238c7ba..<tip>` 在推送后写入 PR 正文。

## P7 CI 隔离 — PASS

### E1

```bash
git diff --exit-code 2238c7ba -- Cargo.toml Cargo.lock rust-toolchain.toml .github/workflows/rust-hello.yml
# 无输出，退出码 0
```

### E2

两边都是 `cargo +1.83.0 build --release --locked`，退出码 0。

```bash
cargo +1.83.0 tree --locked --workspace | sed "s#$(pwd)#<repo>#g"
diff -u e2-tree-base.txt e2-tree-tip.txt
# E2_TREE_DIFF_EXIT:0
```

两边的树（路径已换成 `<repo>`）：

```
pilotdeck-agent-loop v0.1.0 (<repo>/crates/pilotdeck-agent-loop)
└── serde_json v1.0.154
    ├── foldhash v0.2.0
    ├── indexmap v2.7.1
    │   ├── equivalent v1.0.3
    │   └── hashbrown v0.15.5
    ├── itoa v1.0.18
    ├── memchr v2.8.3
    ├── serde_core v1.0.229
    └── zmij v1.0.23

pilotdeck-agent-loop-hello v0.1.0 (<repo>/crates/pilotdeck-agent-loop-hello)
└── serde_json v1.0.154 (*)
```

### E3

```bash
cd rust-core && rustc -V && cargo -V
# rustc 1.99.1 (58cf8f9c3 2026-10-13)
# cargo 1.99.1 (5f94df478 2026-08-27)

rustup show active-toolchain
# 1.99.1-x86_64-unknown-linux-gnu (overridden by '/workspace/rust-core/rust-toolchain.toml')
```

## P8 PARITY — FAIL（全量名单不稳定）

### ① 检查 5 — PASS

`cargo +1.99.1 test --locked $F` = **696**，见 P3。探针 `cargo +1.83.0 test --locked` `EXIT:0`（`raw/probe-test.txt`）。

### ② 快速门 ×30 — PASS

```bash
export PILOTDECK_RUST_SIDECAR_BIN=$PWD/rust-core/target/rust-core-proof/pilotdeck-agent-loop
python3 tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --sidecar-transport stdio \
  --pilotdeck-stdio-sidecar-cmd tools/agent-loop-parity/rust-stdio-sidecar.sh \
  --scenario <pure_text|single_tool> \
  --output <run-dir>
```

`pure_text`、`single_tool` 各 30 次（2026-10-16T07:46:24Z 至 07:49:49Z）。60/60 退出码 0，`failed` / `blocked` / `oracleFailures` 皆空，`sidecarImplementation=rust`，`sidecarImplementationSource=exec-proof`。逐次在 `raw/quick-index.jsonl`。

`pure_text` 第 1 次 exec proof（`raw/sample-exec-proof.json`）：`resolved` 以 `pilotdeck-agent-loop` 结尾。

format warning 不改变退出码。`pure_text` 有 29 次 16 条、1 次 46 条；`single_tool` 为 52×1、60×10、71×15、90×2、92×2。语义比较仍是 0 diff。

### ③ 全量 53 — 两次名单不同，不能写成稳定的 51/2（deadline、sidecar_budget_limit）

同一条命令、同一二进制，`--scenario all`。分母都是 53，身份都是 exec-proof，`blocked` 与 `oracleFailures` 都空，sidecar jsonl 里 `Rust normal-turn candidate has not implemented` 都是 0 次。进程退出码都是 1。

第一次 2026-10-16T07:49:49Z–07:54:11Z（`raw/full53-summary.json`）：

```
failed: deadline_during_tool/PilotDeck: 1 semantic difference(s)
        sidecar_budget_limit/PilotDeck: 1 semantic difference(s)
expectedExtensions: deadline/PilotDeck: verified 2 declared transport difference(s)
```

`deadline_during_tool` 多了一条 `gateway_submit_failed`（`result_unknown` / host reconciliation found no final result）。`sidecar_budget_limit` 的 `text` 是 native 金额句 vs rust `max_budget_reached`。

第二次 2026-10-16T08:00:46Z–08:05:08Z（`raw/full53-rerun-summary.json`）：

```
failed: deadline/PilotDeck: transport contract mismatch (3 semantic difference(s))
        sidecar_budget_limit/PilotDeck: 1 semantic difference(s)
expectedExtensions: []
```

第二次与 T-P2-02 的名字一致：`deadline` 是 3 处语义差（多一条 `gateway_submit_failed`，外加 `durableStopReason` / `resultType` 为 null），`sidecar_budget_limit` 仍是文案差。

两次都是 51 个不在 `failed` 里的场景、2 个 trace_diff、0 profile_gap、0 BLOCKED。规格点名的那一对只在第二次出现。额外事件是同一句 `result_unknown`，第一次落在 `deadline_during_tool`，第二次落在 `deadline`。判定：**P8 FAIL**。不在本 PR 改场景或修行为。

## P9 PERF — Q2 PASS；D4 有两项 > 1（只记录）

同一次采集，2026-10-16T07:54:11Z–07:59:47Z。`gitDirty=false`，`gitSha=87b2d6b4`，`baseSha=2238c7ba`。`--model-ms 200`，n=30。stdio exec proof 90/90，`resolved` 以 `pilotdeck-agent-loop` 结尾。

```bash
export PILOTDECK_RUST_SIDECAR_BIN=$PWD/rust-core/target/rust-core-proof/pilotdeck-agent-loop
python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --scenarios pure_text,single_tool,sidecar_live_model_stream_chars_50 \
  --model-ms 200 \
  --iterations 30 \
  --transports native,stdio \
  --pilotdeck-stdio-sidecar-cmd tools/agent-loop-parity/rust-stdio-sidecar.sh \
  --output /tmp/tp204-perf
# PERF_EXIT:0
```

单位毫秒。净 P95 来自同一次 JSON 的 `*_net_of_model_ms.p95`。

| 场景 | native model 净 P95 | rust model 净 P95 | 差 | Q2 阈值 | 超过 |
|---|---:|---:|---:|---:|---|
| pure_text | 26.918 | 23.930 | −2.988 | 100 | 否 |
| single_tool | 26.036 | 31.785 | +5.749 | 100 | 否 |
| chars_50 | 37.495 | 68.952 | +31.457 | 100 | 否 |

Q2 = `max(native model 净 P95 × 10%, 100ms)`。三场景 10% 都小于 100，阈值都是 100。**Q2 PASS**。

| 场景 | native turn 净 P95 | rust turn 净 P95 | 差 | D4 | 差/D4 |
|---|---:|---:|---:|---:|---:|
| pure_text | 561.687 | 612.148 | +50.461 | 56.169 | 0.898 |
| single_tool | 645.271 | 739.421 | +94.150 | 64.527 | **1.459** |
| chars_50 | 771.252 | 865.434 | +94.182 | 77.125 | **1.221** |

D4 = `max(native turn 净 P95 × 10%, 5ms)`。`single_tool` 与 `chars_50` 的差/D4 大于 1。model 净差仍在 Q2 以内。stdio handshake P95 约 80–81ms（native 没有 handshake）。整 turn 多出来的时间和这个拉起成本同量级，不是 model 迭代净时间。按规格只记录，**不因此判 FAIL**。T-P2-03 的 −3.699 / +2.687 / +33.259 ms 只作参考，不作比较基准。

## P10 依赖漂移 — PASS

```bash
cd rust-core && cargo +1.99.1 tree --locked -e features $F
cargo +1.99.1 metadata --locked --format-version 1
```

metadata resolve 的 73 个包版本与 `rust-core/Cargo.lock` 一一对应，没有多出版本、没有缺失。点名的钉扎：

| 包 | 版本 | resolve 里打开的 feature |
|---|---|---|
| serde_json | 1.0.151 | default, raw_value, std |
| ryu-js | 1.0.3 | （resolve 列表为空；tree 显示 default） |
| sha2 | 0.10.9 | default, std |
| tz-rs | 0.7.3 | alloc |
| tiktoken-rs | 0.12.0 | （path，无额外 feature） |
| base64 | 0.22.1 | alloc, default, std |
| rustc-hash | 2.1.3 | default, std |

根 workspace：

```bash
cargo +1.83.0 tree --locked | sed "s#$(pwd)#<repo>#g"
diff -u 2238c7ba tip
# P10_ROOT_TREE_DIFF_EXIT:0
```

与 E2 的树相同。

## P11 workspace 边界 — PASS

```bash
cd rust-core && cargo +1.99.1 metadata --locked --format-version 1 --no-deps \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["workspace_root"])'
# /workspace/rust-core

cd rust-core/pilotdeck-transport && cargo +1.99.1 metadata --locked --format-version 1 --no-deps \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["workspace_root"])'
# /workspace/rust-core
```

把仓根绝对路径换成 `<repo>` 后，两条都是 `<repo>/rust-core`。

```bash
# 仓根 tip，以及 2238c7ba worktree，命令相同
cargo +1.83.0 metadata --locked --format-version 1 --no-deps \
  | python3 -c 'import json,sys;print(sorted(p["name"] for p in json.load(sys.stdin)["packages"]))'
# ['pilotdeck-agent-loop', 'pilotdeck-agent-loop-hello']
```

两边包名相同。不需要给根 workspace 加 `exclude`。
