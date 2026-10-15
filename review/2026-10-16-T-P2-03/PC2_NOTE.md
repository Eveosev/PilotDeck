# PC2_NOTE · T-P2-03

本轮不关闭 PC2。

采集的是 stdio：rust-core、native，以及同样「每 turn 拉起」的 TS-stdio。stdio 含每 turn 进程启动。TCP 重采要等 T-P2-05 之后的常驻 TCP，不能用这次的数字代替。

这些数字不能用来对照 #37 的 Rust-tcp 表，也不能写成「换 rust-core 就会过 PC2」。

Q2 与本轮 D4 的读数只写在 `STDIO_PERF.md`，用来决定是否把 T-P2-04 排进日程。本 PR 不自动开 T-P2-04。PC1#3 与 PC3 仍单独成行，本轮不关闭它们。
