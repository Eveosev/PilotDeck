# CI_CONTRACT · T-P2-08 · G-CI

基线 `rust_standalone_alpha1@d21eb126486eed0e86a76b00beb4f6ccd5636953`。两个 Cargo workspace 保持分开。rust-core 的 `rust-version = "1.93"` 不降。CI 钉的是各 workspace 自己的 toolchain，不是把它们合成一个。

## 工具链

| Workspace | 文件 | CI | 命令里看到的版本 |
| --- | --- | --- | --- |
| 根 hello / 探针 | `rust-toolchain.toml` `channel = "1.83.0"` | `dtolnay/rust-toolchain@1.83.0`，组件 rustfmt、clippy | 本地 `rustc 1.83.0 (90b35a623 2024-11-26)` |
| `rust-core/` | `rust-core/rust-toolchain.toml` `channel = "1.99.1"` | `dtolnay/rust-toolchain@1.99.1`，`toolchain: 1.99.1`，组件 rustfmt、clippy | 本地 `rustc 1.99.1 (58cf8f9c3 2026-10-13)` |

Node：CI `actions/setup-node@v7` 钉 **22.23.1**（与现有 hello / web workflow 相同）。本地证据是 **v22.14.0**。两者都在 engines `>=22.13.0 <23` 里，且高于 replay 要求的 22.6。pnpm **10.32.1**（`packageManager`）。

## Workflow

### `.github/workflows/rust-workspaces.yml`

`pull_request` 的 `paths`：

- `Cargo.toml`
- `Cargo.lock`
- `rust-toolchain.toml`
- `crates/**`
- `rust-core/**`
- `.github/workflows/rust-workspaces.yml`

另有 `workflow_dispatch`。两个 job 并行，互不切换 toolchain。

根 job（`working-directory` 为仓库根）：

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

`rust-core` job（`working-directory: rust-core`）：

```bash
cargo fmt --check \
  -p pilotdeck-protocol \
  -p pilotdeck-tokenizer \
  -p pilotdeck-agent \
  -p pilotdeck-transport
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked
```

`cargo fmt --all` 在嵌套布局下还会去格式化 path 依赖 `vendor/tiktoken-rs`。该包被 rust-core workspace `exclude`，自身没有 `[workspace]`，Cargo 会继续走到仓库根 workspace 并报 “believes it's in a workspace when it's not”。`-p` 只覆盖四个成员，不把 vendor fork 收进根 workspace，也不改它的格式。clippy / test 仍用 `--workspace --all-targets --locked`。

### `.github/workflows/protocol-sync.yml`

`on.pull_request.paths` 与下面两处逐字相同：

- `evidence/protocol-sync-gate.md` 触发路径围栏
- `CONTRIBUTING.md` 触发路径围栏

共 15 条，最后一条是追加的 `rust-core/**`。原文 14 条的顺序不变。`.github/workflows/check-protocol-sync-paths.py` 在 job 开头比对三处，不一致就失败。

列表：

```
src/agent/modules/protocol.ts
scripts/lib/module-protocol-schema.mjs
scripts/generate-module-protocol-schema.mjs
scripts/replay-module-protocol-schema.mjs
evidence/schema/fixtures/negative-samples.json
evidence/schema/fixtures/edge-samples.json
evidence/schema/module-protocol.schema.json
evidence/schema/replay-report.json
evidence/schema/replay-report.md
evidence/protocol-sync-gate.md
tools/agent-loop-parity/run.py
tools/agent-loop-parity/scenarios.json
package.json
pnpm-lock.yaml
rust-core/**
```

Job 步骤：

1. 三处路径比对。
2. `pnpm install --frozen-lockfile --ignore-scripts`。检查 1–3 只 `import` ajv；原生 postinstall 不在这几条里。`--frozen-lockfile` 禁止改写 lockfile。安装后 `git status --porcelain` 必须为空，否则后面的 generate / replay 会按文档 exit 2。
3. 从 `CONTRIBUTING.md` 抽出唯一的 `bash` 命令块，`bash -e` 执行。块内是 1a、1c（generate + `git diff --exit-code`）、一次 replay + restore、检查 2、检查 3、检查 7。restore 在失败路径上也会执行。不第二次 replay。检查 4–6 不在这个 job 里。

Node 22。不给 1a / generate 加 `--experimental-strip-types`。

### `.github/workflows/parity-quick.yml`

`paths`：

- `rust-core/**`
- `tools/agent-loop-parity/**`
- `scripts/ci/parity-quick.sh`
- `.github/workflows/parity-quick.yml`

脚本 `scripts/ci/parity-quick.sh`。只跑 `pure_text` 和 `single_tool`。命令是现有 stdio wrapper，不传 `--scenario all`：

```bash
PILOTDECK_RUST_SIDECAR_BIN="$PWD/rust-core/target/rust-core-proof/pilotdeck-agent-loop" \
python3 tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --sidecar-transport stdio \
  --pilotdeck-stdio-sidecar-cmd tools/agent-loop-parity/rust-stdio-sidecar.sh \
  --scenario pure_text \
  --output /tmp/pilotdeck-parity-quick-pure_text
```

`single_tool` 同样，只换 `--scenario` 和 output。证明链沿用 T-P2-02：默认二进制是 `rust-core/target/release/pilotdeck-agent-loop-sidecar` 时，脚本建 `rust-core/target/rust-core-proof/pilotdeck-agent-loop` → `../release/pilotdeck-agent-loop-sidecar`。`rust-stdio-sidecar.sh` 对这个 basename 用 `realpath -s`，不把证明改写成 `*-sidecar`。

缺省 release 二进制：**显式 skip**，exit 0，打印 `PARITY_QUICK_RESULT=skip` 和 “not a scenario pass”。CI 不编译 release sidecar，避免每个 PR 做一次长编译。这不是场景通过。

以下情况 **失败**（exit 1，`PARITY_QUICK_RESULT=fail`），不能当成 skip：

- `PILOTDECK_RUST_SIDECAR_BIN` 已设置但路径不存在
- 二进制在，但 basename 不是 `pilotdeck-agent-loop`，也不是默认的 release sidecar
- 二进制在，但没有 `dist/src/cli/createLocalGateway.js`（要先 `pnpm build`）
- 任一场景 `scenarios != 1`，或 `sidecarImplementation != rust`，或 `blocked` / `failed` / `oracleFailures` 非空
- `scenarios == 53`（快速门里跑了全量）

全量 53 不在本 workflow 的路径过滤里，也不在 protocol-sync job 里。

### `.github/workflows/rust-hello.yml`

保留。`paths` 仍包含 desktop hello 探针那一组（`apps/desktop/scripts/rust-hello.mjs`、`verify-rust-hello.mjs`、`resources/rust/**` 等）。本 PR 只在文件头加了注释，说明它和 `rust-workspaces.yml` 的分工：hello 继续 1.83，rust-core 不塞进这条。toolchain 仍是 `dtolnay/rust-toolchain@1.83.0`，Node 仍是 22.23.1。

## 本 PR 不改变的产品事实

- 默认 transport 仍是 native。
- 不改 supervisor 语义，不改 `apps/**` 的打包逻辑。
- 不把真 sidecar 打进 `apps/**`。
- PC1#3、PC2、PC3、Track D tools、T-P2-09 仍 open。
