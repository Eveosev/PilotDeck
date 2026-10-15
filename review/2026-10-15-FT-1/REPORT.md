# FT-1 REPORT（T-P1-06 前置 PC1）

基线：`rust_standalone_alpha1` @ `1d7c806846386c16274e0549e156b142f4930a6f`。
实现提交：`4ac1ca7076f65cace4f3b7ca7c5b013533b69373`。
证据与报告提交：`107b18bbe1c68d44e0fccef3535fdc7d8b1202ce`。
分支：`ft-1-stream-next`。Draft PR：https://github.com/Eveosev/PilotDeck/pull/40 ，目标分支 `rust_standalone_alpha1`。

本任务只改 Rust sidecar 生产路径。未改 `src/**`、协议 schema、`ui/**`、`apps/**`、`tools/agent-loop-perf`。未覆盖 `evidence/p1/` 里已有的 json。未做 FT-2（model 迭代开销）。

## 改动摘要

`crates/pilotdeck-agent-loop/src/sidecar.rs`：

- Host 在 execute payload 的 `hostModules.model.methods` 里声明 `stream_next` 时（与 `hostModelInvokerPort.ts` 的 `supportsPullStream` 相同），sidecar 在 `prepare` 之后循环调用 `model.stream_next`，直到 `done: true`。
- 每一帧里的 canonical 事件在下一次 pull 之前发出 `agent.model_event`。`text_delta` 带稳定 `blockId`。Host 的 `GatewayAgentEventProjector.mapModelEvent` 把它投影成 `assistant_text_delta`。这样首块 `STREAM_PREFIX` 会在 provider completion 之前到达 Gateway。
- 耐久 `assistant_message` 复用同一个 `blockId`，host timeline 补上 `timeline` 后投影为 `assistant_block`，避免再发一条合并后的 `assistant_text_delta`（那会把默认变体从 2 个 delta 变成 3，或把 chars=1 从 98 变成 99）。
- `done: true` 的结束帧正常收束，不调用 `close_stream`。错误帧（`type: error`）、畸形帧（缺 `events` 或 `done`）、host `ok: false`、或未完成时被中断：若 host 同时声明 `close_stream`，则关闭未完成的流。
- 未声明 `stream_next`（包括现有单测里的 `hostModules.model: true`）时，仍走一元 `stream`，`assemble_canonical_events` 继续把 delta 拼成一条，并在结束后 `close_stream`。

单测（都在 `sidecar.rs` 的 `tests` 模块）：

- `stream_next_emits_each_text_delta_before_the_next_pull`
- `stream_next_falls_back_to_unary_stream_when_host_does_not_advertise_it`
- `stream_next_error_frame_is_emitted_then_the_unfinished_stream_is_closed`
- `stream_next_end_frame_completes_and_malformed_frame_fails`

## 测试命令与输出

```bash
cargo test --workspace -- --test-threads=8
```

完整日志：`review/2026-10-15-FT-1/cargo-test.txt`（exit 0）。

| 目标 | 结果 |
| --- | --- |
| lib unit | 69 passed，含上面 4 个 `stream_next_*` |
| `g5_tcp_module_call` | 1 passed |
| `lock` | 6 passed |
| `roundtrip` | 2 passed |
| `serde_r2` | 9 passed |
| `sidecar_stdio` | 6 passed |
| `sidecar_tcp` | 7 passed |
| hello bin / doc-tests | 0 tests |

## 对拍结果

Live 命令（`PARITY_PERF=1`，`--comparison same-version`，`--surface gateway`，`--sidecar-transport tcp`，`--pilotdeck-tcp-sidecar-cmd tools/agent-loop-parity/rust-tcp-sidecar.sh`，`--adapter-timeout-seconds 180`）。chars 1/50/500 经 `collect_stream_chunks.py --run-gateway --transport rust-tcp` 收到 `/tmp`，再写入下面的新文件。默认变体 `sidecar_live_model_stream` 另跑 `run.py`。没有覆盖已有 `evidence/p1/*.json`。

逐块内容：Rust-tcp 的 `user.output` 文本与同一次 same-version native trace 逐条相等，并且与 `planned_deltas`（`STREAM_PREFIX` + 按 code point 切片的 mock body）逐条相等。语义 diff 为 0，`oracleFailures` 为空，`firstDeltaBeforeProviderCompletion=true`。

| 场景 | n_chunks / n_text_deltas / perf_n_chunks | stream_chunk_ms 长度 | 与 native / planned 逐条相等 | oracle / semantic | 证据 |
| --- | ---: | ---: | --- | --- | --- |
| chars=1 | 98 / 98 / 98 | 97，非空 | 是 / 是 | `[]` / `[]` | `evidence/p1/stream-chunks-live-rust-tcp-1-r2.json` |
| chars=50 | 22 / 22 / 22 | 21，非空 | 是 / 是 | `[]` / `[]` | `evidence/p1/stream-chunks-live-rust-tcp-50-r2.json` |
| chars=500 | 4 / 4 / 4 | 3，非空 | 是 / 是 | `[]` / `[]` | `evidence/p1/stream-chunks-live-rust-tcp-500-r2.json` |
| 默认（无 `streamChunkChars`） | 2 / 2 / 2 | 1，非空 | 是（char 计数 15 + 89） | `[]` / `[]` | `evidence/p1/stream-chunks-live-rust-tcp-default-r2.json` |

汇总表：`evidence/p1/stream-chunks-live-rust-tcp-compare-r2.json`。索引：`evidence/p1/stream-chunks-live-rust-tcp-index-r2.json`。

对照既有 TS-tcp 证据（未改）：`evidence/p1/stream-chunks-live-ts-tcp-{1,50,500}.json` 的 n_chunks 也是 98 / 22 / 4，`stream_chunk_ms` 长度也是 97 / 21 / 3。默认变体没有退回 1 个合并 delta：native 与 Rust-tcp 都是 `STREAM_PREFIX::` 加一整段 body，共 2 条。

`stream_chunk_ms` 的长度：`tools/agent-loop-perf/collector.mjs` 记录的是相邻 `assistant_text_delta` 的间隔，所以 `len(stream_chunk_ms) == n_chunks - 1`（n_chunks ≥ 2）。本次 Rust-tcp 间隔序列非空，并且和 TS-tcp / native 的既有证据同一契约。`perf_n_chunks` 与 harness `n_chunks` 对齐（98 / 22 / 4 / 2）。本任务不改 collector，因此没有把间隔数组改成与 `n_chunks` 等长。

chars=1 先前的 oracle FAIL（`firstDeltaBeforeProviderCompletion=false`，约 98 处语义 diff，`perf_n_chunks=1`，`stream_chunk_ms=[]`）在这次重采里不再出现。trace 里实际出现 `model.stream_next`（chars=1 为 102 次，50 为 26 次，500 为 8 次，默认为 6 次），没有一元 `stream`。

格式警告仍在（chars=1 为 335，主要是 envelope），不改变 exit。same-version 这四次的 exit 都是 0。

## 未解决项

1. `stream_chunk_ms.length` 是 `n_chunks - 1`，不是 `n_chunks`。这是 collector 的间隔定义，与既有 TS-tcp / native 证据一致。若闸门按字面要求长度等于 `n_chunks`，需要改 `tools/agent-loop-perf`，本任务白名单不允许。
2. chars=50 与默认变体的 `summary.json` 把 `sidecarImplementation` 标成 `ts`（fingerprint：`context.budget` 的 trace sequence 没有排在 `model.request` 之前）。chars=1 与 chars=500 标成 `rust`。四次的 TCP 日志都是 Rust 二进制的 `listening 127.0.0.1:<port>`，trace 里是 `model.stream_next`，语义 diff 与 oracle 都是空。这是 harness 标签，不是块内容差异。未按 FT-2 去查 model 迭代时序。
3. 未跑完整 53 场景 gate，只跑了 live stream 的四个场景（chars 1/50/500 与默认）。
4. 未做 FT-2，未改 `tools/agent-loop-perf`。
