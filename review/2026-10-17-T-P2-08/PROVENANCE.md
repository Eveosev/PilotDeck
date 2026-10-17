# PROVENANCE · T-P2-08

- 基线：`rust_standalone_alpha1` @ `d21eb126486eed0e86a76b00beb4f6ccd5636953`（#58 已合，含 T-P2-06）
- 分支：`cursor/t-p2-08-g-ci-9b0a`
- 实现提交：`ada7317e6743ab7c07d852aa6522ea1ae240e302`
- 证据提交：本文件所在的后一次普通提交。不 rebase、不 amend、不 force-push。PR head 以 GitHub 上的 tip 为准
- 规格：冻结 `TASK_DEF` sha256 `81125bdb7e9b2bc8dabab4aec70c32ff9a0ed712cbed45be65bcfb55a1225850`
- 解锁：`unlocked=true`（standing「其余全做」）。本 PR 保持 **draft**。ready / merge 仍等真 Payne
- 契约：同目录 `CI_CONTRACT.md`

## 实现选择

| 项 | 选择 |
| --- | --- |
| 双 workspace | `.github/workflows/rust-workspaces.yml`。根 1.83.0，`rust-core/` 1.99.1。不合并 workspace，不改 rust-core `rust-version = "1.93"` |
| rust-core fmt | `cargo fmt --check -p` 四个成员。`cargo fmt --all` 会撞上被 exclude 的 `vendor/tiktoken-rs` 与根 workspace 的嵌套发现，所以不用 `--all` |
| protocol-sync | `.github/workflows/protocol-sync.yml`。`paths` = 原触发列表逐字 + `rust-core/**`。job 执行 CONTRIBUTING 命令块（1a、1c、一次 replay、检查 2、3、7）。Node 22 |
| parity 快速门 | `.github/workflows/parity-quick.yml` + `scripts/ci/parity-quick.sh`。只准备 `pure_text` 与 `single_tool`。CI **不**编译 release 二进制 |
| 缺二进制 | 默认路径不存在则 `PARITY_QUICK_RESULT=skip`，exit 0，日志写明不是场景通过。二进制在但跑不起来则 exit 1，不是 skip |
| hello | `.github/workflows/rust-hello.yml` 保留，只加分工注释 |
| JS 依赖 | `pnpm install --frozen-lockfile --ignore-scripts`。检查 1–3 只需要 ajv |

根 workspace 在 1.83 的 `cargo fmt --all --check` 原先不是干净的。本 PR 对 `crates/pilotdeck-agent-loop` 与 `crates/pilotdeck-agent-loop-hello` 跑了 rustfmt。另外两处测试构造从 `std::iter::repeat(char).take(n).collect()` 改成 `"字".repeat(230)` / `"误".repeat(2_010)`，否则 `clippy -D warnings`（`--all-targets`，含 lib test）会因 `manual_str_repeat` 失败。没有改 `apps/**` 的行为，没有改默认 transport。

## 本地命令

工具：rustc 1.83.0 与 1.99.1（`rustup toolchain install 1.99.1 --profile minimal --component rustfmt,clippy`），Node v22.14.0，pnpm 10.32.1，Python 3.12.3。`CARGO_TERM_COLOR=never`。

| 命令 | 结果 | 原始输出 |
| --- | --- | --- |
| 根 `fmt --all --check` + `clippy --workspace --all-targets --locked -- -D warnings` + `test --workspace --locked` | exit 0。rustc 1.83.0。测试 116 passed / 0 failed | `raw/root-fmt-clippy-test.txt` |
| rust-core `fmt --check -p` 四成员 + `clippy --workspace --all-targets --locked -- -D warnings` + `test --workspace --all-targets --locked` | exit 0。rustc 1.99.1。测试 708 passed / 0 failed | `raw/rust-core-fmt-clippy-test.txt` |
| `pnpm install --frozen-lockfile --ignore-scripts` | exit 0。之后 `git status --porcelain` 为空 | `raw/pnpm-install.txt` |
| 三处触发路径比对 | `PASS protocol-sync paths identical (15 entries, includes rust-core/**)` | `raw/path-sync.txt` |
| CONTRIBUTING 命令块 `bash -e`（采集时 HEAD `ada7317e`） | exit 0。`PASS schema-current`。`expressibleMismatches 0`。`allRejectedByBoth True`，`loosened FAIL`。`gitSha` == HEAD，`gitDirty False`。restore 后工作树仍干净 | `raw/protocol-sync.txt` |
| 无 release 二进制时的 parity 脚本 | exit 0。`PARITY_QUICK_RESULT=skip`。`pure_text` / `single_tool` 未执行 | `raw/parity-quick-skip.txt` |
| 放一个空的 release 路径（无 `dist`） | exit 1。`PARITY_QUICK_RESULT=fail`。不是 skip | `raw/parity-quick-present-no-dist.txt` |
| `PILOTDECK_RUST_SIDECAR_BIN` 指向不存在的路径 | exit 1。`PARITY_QUICK_RESULT=fail` | `raw/parity-quick-explicit-missing.txt` |

本环境没有 rust-core release 二进制，也没有 `pnpm build` 出的 `dist/`。因此 `pure_text` 与 `single_tool` **没有实际跑起来**。这和 CI 干净 checkout 的条件相同：job 会打出 skip，而不会把没跑的场景记成通过。脚本里的运行分支就是 T-P2-02 的 stdio wrapper 加 proof symlink；二进制和 dist 都在时才会进入该分支。

## Formal P1–P10

| 门 | 自检 |
| --- | --- |
| P1 白名单 | diff 没有 `apps/**` 产品逻辑。`rust-hello.yml` 只加了注释，desktop 路径还在。`crates/**` 是 rustfmt，外加两处测试用 `str::repeat`。没有把 Track D / PC1#3 / PC2 / PC3 写成已关 |
| P2 rust-core CI | `rust-workspaces.yml` 的 `paths` 含 `rust-core/**`。fmt / clippy `-D warnings` / `cargo test --locked` 本地 exit 0，toolchain 1.99.1。见 `raw/rust-core-fmt-clippy-test.txt` |
| P3 根 workspace CI | 同一 workflow 在 `crates/**`、根 `Cargo.toml` / `Cargo.lock` / `rust-toolchain.toml` 上触发。1.83.0 上 fmt / clippy / test exit 0。hello 流仍是单独的 `rust-hello.yml` |
| P4 protocol-sync | 15 条路径三处同文，含原列表逐字和 `rust-core/**`。job 跑检查 1–3（命令块里同时有检查 7，同一次 replay）。`raw/path-sync.txt`、`raw/protocol-sync.txt` |
| P5 parity 快速 | 有 job。跑的时候只有 `pure_text` 和 `single_tool`，且要求 `sidecarImplementation=rust`。缺默认 release 二进制是显式 skip。二进制在场但环境不够是 fail。本机未执行两场景，原因写在上面，不是静默通过。全量 53 不在该 workflow |
| P6 hello 保留 | `rust-hello.yml` 仍在，`on.pull_request.paths` 仍覆盖 desktop hello 探针 |
| P7 PLAN | `docs/rust_rebuild/PLAN.md` 把 T-P2-08 标成进行中（本 PR，draft，未合）。记下 #58 / `d21eb126` 已合、T-P2-06 完成。没有写成 T-P2-08 已合 |
| P8 证据 | 本目录 `CI_CONTRACT.md` + `raw/*`。rust-core toolchain **1.99.1** 写在契约和原始日志里 |
| P9 无 force-push | 实现提交之后只追加证据提交 |
| P10 默认路径 | 未改 supervisor，未改产品默认 transport。PLAN 仍写 native |

ready / merge 不在本 PR 里做。
