# PR-W evidence index（F-7：只留小文本）

对照 DECISION.md 失败 ID。原始大日志不重复入库；A/D 仅 sha256 + PR artifact；B/C 指向 FE 目录；QA 指向 `qa-gate-c17f1874/`。

| ID | 根因（一句） | before | sha256 | after | sha256 |
|---|---|---|---|---|---|
| A-1…A-8 | vitest 误收 `node:test`，Vite 无法打包内置模块 | `a-group-before.txt` | `5b4a07b9f3fbfa355b0f659f57f46fd02f43f8c23a4254b26427a6af718bb86c` | `a-group-after.txt` | `0057205009e700f22b4065dc9764b87942ef42e6ca9102284bad804bf1502677` |
| B-1…B-4 | 不可安装时按钮是 `checkAgain`（disabled），测试找 `updateAndRestart` | `b-group-before.txt` → `../../2026-10-13-T-CI-web-green-fe/b-group-before.txt` | `54054696b10ff9a477f1da44685e6d4628d3af6e9150fd2aca5fb6993b08d62b` | `b-group-after.txt` → FE | `0bcbeb40e5a939d85da28d1816987634cff4c86dd00a186014ae546491552044` |
| C-1 | `SettingsContent` 用 `useLocation()`，测试未包 Router | `c-group-before.txt` → FE | `78a20feb2d25f5f975b3f5b718f5a951ed63e44d50b5844cd4691d459cafd9c7` | `c-group-after.txt` → FE | `882fbf45723a737a7ad72511afa286207a13fc622f50dc6f1a95c9d6725ed9b3` |
| D-1 | Vite 动态 import `loadPilotConfig.ts` 在 5s 用例内超时 | `d-group-before.txt`（timing + 1800ms timeout） | timing `007742e2…5353d9`；timeout-1800 `a82481db…2162a` | `d-group-after.txt` | after-1 `67d91eb9…ac85f`；after-2 `9c6652ab…7f51`；after-3 `75fdc5fc…d396` |
| D-2 | 超时泄漏的 Vite SSR factory + `vi.resetModules()` → `existsSync` TDZ | 同上（连带）；tsx 对照 `tsx-import-timing.log` | tsx `b606b2f6…15e5d` | 同上（离开 Vite 模块图） | 同上 |

QA 门禁（全量绿，不是单失败对照）：

| 项 | 路径 | 说明 |
|---|---|---|
| SUMMARY | `../qa-gate-c17f1874/SUMMARY.md` | 已入库（slim） |
| 3× CI | `../qa-gate-c17f1874/` + run `38348207846` attempts 1/2/3 | 已核实 GitHub：三次 conclusion=success，head `c17f1874` |
| node:test list | `../qa-gate-c17f1874/` | 8 文件 / 40 pass / 0 fail |
| non-review.diff | `../qa-gate-c17f1874/non-review.diff` | 相对 base `761572d7` 的非 review 代码 diff |
| stub | `qa-gate.txt` | 只写路径，不编造日志正文 |

完整 sha256 表见 `../PROGRESS.md`。
