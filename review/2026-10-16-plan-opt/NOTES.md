# 2026-10-16 计划优化

只改文档。基线 `rust_standalone_alpha1` @ `f44b3789`（#46）。不改 `crates/`、`src/`。

结论与逐条判定在 `docs/rust_rebuild/REVIEW-RustReview-2026-10-15.md`。阶段、任务和门禁在 `docs/rust_rebuild/PLAN.md`。

补证之后：`profile_gap` 是 29 处调用加 `:3966` 的定义，不是 32 处调用。workspace 清单已核对为 edition 2024、resolver 3、rust-version 1.93、toolchain 1.99。

一句话：P2 的领域核心改为 rust-core 四个 crate，本仓探针停在已经合入的 Track A+B。切换要先过 stdio 对拍和性能两道门。Track C 是 FT-2a 按需重采，Track D 是 53/tools；PC1#3 与 PC3 另列。这几项和 PC2 仍 open。字母按 #46 UNLOCK，不把 PC1#3/PC3 记成 C/D。Payne 的 Q3 原文仍是「53 场景 live 门禁留在 P1」；现状另起一行，不改写成 Payne 把门禁留在 P2。
