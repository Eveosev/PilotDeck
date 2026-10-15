# TASK_DEF · T-P1-04-FU（R1 m1–m6）

**Base：** `rust_standalone_alpha1` @ `30883a13`（#34 已合）
**Whitelist：** `tools/agent-loop-parity/**` ; `tools/agent-loop-perf/**` ; `evidence/p1/**` ; `review/2026-10-15-T-P1-04-FU/**`.
**Out：** live timing / `pnpm build` / `--run-gateway`（留给 T-P1-05）；ready / merge。

| ID | 项 |
|---|---|
| m1 | `--scenario all --suite all` 只豁免 suite `sidecar-stream-chunks`；其它未登记场景 raise |
| m2 | adapter 调用 `yieldLiveModelStreamDeltas` / `liveStreamTextDeltas`；默认路径 2 deltas（含空 body） |
| m3 | planned 模式 oracle 字段不为 True（null / not-evaluated） |
| m4 | 仅在 sidecar trace 存在时 `source=gateway`；无 trace 则 error 且不写产物 |
| m5 | METRICS：first-chunk 含 model 延迟；两个 `n_chunks` 来源 |
| m6 | Rust TCP sidecar 参数透传；产物 `transport`；非法 transport exit 2 |
