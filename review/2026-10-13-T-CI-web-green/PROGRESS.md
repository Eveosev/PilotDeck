# T-CI-web-green 进度

- 分支：`pilotdeck-rust/T-CI-web-green`
- 基线：`761572d7ff548eb41f27ebdb9a70faaccc73fdb8`
- draft PR：https://github.com/Eveosev/PilotDeck/pull/12
- 源失败：run `38340992186`
- **当前 head / tip：`e63e2661036c01d0ec9bb39e6fc626a67a32ddee`**
- QA 代码门禁 tip（PASS）：`c17f18747ebb2f3ee9b9eef0652972d196317639`。相对它 **只有 `review/**` 有 diff**（`git diff c17f1874..HEAD -- . ':(exclude)review'` 为空）。
- 门禁 `non-review.diff` sha256：`d25b9599d7dc48f79e100698336bdfc4493a7a39e8faa0bf4447a7c902a87d59`
- FE B/C：`582d563adb535be93b8c4ffab3ec6dd9aacf1d99`（测试对齐）+ `c17f1874`（记录 gitSha）；证据在 `review/2026-10-13-T-CI-web-green-fe/`
- QA gate **PASS** @ `c17f1874`：run `38348207846` attempts **1/2/3** 全绿；slim qa-gate 入库后 tip 为 `e63e2661`（及本轮 F7/F5 文档提交）。
  - web：268 files / 2204 tests，**0 fail**
  - `node --test`：8 文件，40/0
  - D memory true/false ×3 见下（A/D 本地）
  - 链接：https://github.com/Eveosev/PilotDeck/actions/runs/38348207846 （attempts/1 /attempts/2 /attempts/3）
- QA SUMMARY 已入库：`review/2026-10-13-T-CI-web-green/qa-gate-c17f1874/SUMMARY.md`（slim extracts + `non-review.diff`）。完整 zip/full logs 在共享盘，见该目录 `RAW_LOGS_SHA256.txt`。

## 本轮

| 项 | 状态 | 说明 |
|---|---|---|
| 骨架 / draft PR-W | done | `e4719694` 先推，B/C 可并行 |
| A 组 vitest 排除 + `node --test` CI | done | 扫描 `from/import 'node:test'`；CI step 打印 8 个路径后 `node --test`。`ui/vite.config.js` 内联扫描器。F3：与 CI 发现集已对齐（同正则、同 8 文件）；本轮不改 CI（避免 re-gate）。 |
| D 组计时取证 + 根因修复 | done | 产品代码未改 `loadPilotConfig.ts` |
| D 组连续 3 次绿 | done | 1) true 839ms / false 671ms 2) 962 / 772 3) 895 / 785。三次均 `2 passed` |
| FE B/C 推送 | done | `582d563a` + `c17f1874`；B 9/9、C 2/2 |
| 全量 web suite | done | A/D 当时本地：`2 failed \| 266 passed (268)` / `7 failed \| 2197 passed (2204)`（仅 B+C）。QA @ `c17f1874`：268 / 2204，**0 fail** |
| QA 3× CI | done | `38348207846` attempts 1/2/3 success（docker + web） |
| Reviewer 包 | done | 本目录 DECISION / PROGRESS / evidence / REVIEW_PROMPT |
| 原始日志 | A/D 不入库（sha256）；B/C 在 `-fe/`；QA 见 `qa-gate-c17f1874/` |

## 收集 gitSha

- A/D 实现：`8578c925671b41d0b7ec97b040a6e8c5c6e54843`
- FE B/C：`582d563adb535be93b8c4ffab3ec6dd9aacf1d99`
- 全 PR-W 代码 tip（QA PASS）：`c17f18747ebb2f3ee9b9eef0652972d196317639`
- 当前 head（review 文档，含 slim qa-gate）：`e63e2661036c01d0ec9bb39e6fc626a67a32ddee`（本轮 F7/F5 再叠一层 review-only）
- 基线：`761572d7`

## Before / after（摘要）

### A 组

- Before（CI 38340992186）：8 个文件 vitest 收集失败，`Cannot bundle built-in module "node:test"`，0 用例运行。
- After（本地 `node --test` 同一 8 文件）：`# tests 40` `# pass 40` `# fail 0` `# duration_ms 142.7`。
- After（`vitest list` 点名 8 文件）：无输出（已排除）。
- CI @ `c17f1874`：step 打印 8 路径，`# tests 40` `# pass 40` `# fail 0`。
- 发现器（cwd=`ui`）恰好 8 条：
  - `server/adapters/staffdeck-request-context.test.js`
  - `server/module-request-abort.test.js`
  - `server/public-knowledge-model-selection.test.mjs`
  - `server/staffdeck-approval-authority.test.mjs`
  - `server/staffdeck-public-capabilities.test.mjs`
  - `server/staffdeck-publish-route.test.js`
  - `server/staffdeck-publish-runtime.test.mjs`
  - `server/staffdeck-runtime-readiness.test.mjs`

### B/C 组（FE）

| 组 | 文件 | Before | After | 日志 |
|---|---|---|---|---|
| B | `DesktopAboutSections.test.tsx` | 1 failed file / **6 failed \| 3 passed (9)** | 1 passed / **9 passed (9)** | `../2026-10-13-T-CI-web-green-fe/b-group-before.txt` / `b-group-after.txt` |
| C | `moduleLabels.test.tsx` | 1 failed file / **1 failed \| 1 passed (2)** | 1 passed / **2 passed (2)** | `../2026-10-13-T-CI-web-green-fe/c-group-before.txt` / `c-group-after.txt` |

### D 组计时（修复前，隔离跑 `config.test.js` `-t "can reload memory inheritance"`）

`enabled=true`：clone 0.1ms → createDiskConfigApp 121.3ms → preview 31ms → apply 19ms → yaml 2.1ms → **dynamic-import-loadPilotConfig.ts 2110.9ms** → loadPilotConfig-call 10.5ms。总 2298ms。
`enabled=false`：import 36.4ms（缓存）→ call 1.7ms。总 68ms。

`--testTimeout=1800`：true 在 import 阶段超时；import 在 FAIL 之后仍打出 `+2234.1ms`。false 随后 530.5ms import + 10.4ms call 通过。证明超时点是 Vite 动态 import，且超时不能取消该 import。

tsx 直载同一 TS：`import_ms 901.8` / `load_ms 0.7`，无 TDZ。D-2：TDZ **只在 Vite SSR + `vi.resetModules` 下观察到**；Vite 外（tsx / 新进程）不复现。不把超时 factory 重入写成已证实因果。

修复后连续 3 次（各含一次新进程 tsx）：

| 次 | true | false | 文件结果 |
|---|---:|---:|---|
| 1 | 839ms | 671ms | 2 passed / 121 skipped |
| 2 | 962ms | 772ms | 2 passed / 121 skipped |
| 3 | 895ms | 785ms | 2 passed / 121 skipped |

## 原始日志 sha256（A/D 不入库；B/C 在 `-fe/`）

| 文件 | sha256 | 位置 |
|---|---|---|
| `d-group-timing-1.log` | `007742e293fa09dddcf1969e0d469bc4a4eb9359331d68da3bce54aaad5353d9` | PR artifact / 未入库 |
| `d-group-timeout-tdz.log` | `6009339c52f3e11083f892584c2c7d5429c991939a975d874a92b1e5cc17916f` | PR artifact / 未入库 |
| `d-group-timeout-1800.log` | `a82481db150d87c3be7d51730cfcc9f5152e81b3e4fb29fcf0ee3381d762162a` | PR artifact / 未入库 |
| `tdz-repro.log` | `c6ef081567021e9c4b0de7aefa678818535c98e22a980b4580a2c3ebcb8ccf00` | PR artifact / 未入库 |
| `tdz-repro-concurrent.log` | `ddd5f4ca2e451571b4d8f7551bd77651350ac0ac6c2c5df7daeb4212cc7b11cb` | PR artifact / 未入库 |
| `tsx-import-timing.log` | `b606b2f6af6c0d0e6e8e038610665ef89eca3e5a0688d7c287ae4cb279c15e5d` | PR artifact / 未入库 |
| `d-group-after-1.log` | `67d91eb9ae3e6a387a9089edaa5c0b3955384dc2b59a2bc58cd2a1b13b9ac85f` | PR artifact / 未入库 |
| `d-group-after-2.log` | `9c6652ab5286b9518012c7f7f730548c93dfb7d977eb939bef99ba7f8cd37f51` | PR artifact / 未入库 |
| `d-group-after-3.log` | `75fdc5fc28d2e980937b5c8053d5741ba1703ff9690ef9593dd45b09d735c396` | PR artifact / 未入库 |
| `node-test-8-before.log` | `5b4a07b9f3fbfa355b0f659f57f46fd02f43f8c23a4254b26427a6af718bb86c` | PR artifact / 未入库 |
| `node-test-8-after.log` | `0057205009e700f22b4065dc9764b87942ef42e6ca9102284bad804bf1502677` | PR artifact / 未入库 |
| `web-suite-full.log` | `856e87a812b7906ca9ac7c626c021481a97213a7b9746519837be644c22353ac` | PR artifact / 未入库（A/D 后、B/C 前） |
| `b-group-before.txt` | `54054696b10ff9a477f1da44685e6d4628d3af6e9150fd2aca5fb6993b08d62b` | `../2026-10-13-T-CI-web-green-fe/` |
| `b-group-after.txt` | `0bcbeb40e5a939d85da28d1816987634cff4c86dd00a186014ae546491552044` | `../2026-10-13-T-CI-web-green-fe/` |
| `c-group-before.txt` | `78a20feb2d25f5f975b3f5b718f5a951ed63e44d50b5844cd4691d459cafd9c7` | `../2026-10-13-T-CI-web-green-fe/` |
| `c-group-after.txt` | `882fbf45723a737a7ad72511afa286207a13fc622f50dc6f1a95c9d6725ed9b3` | `../2026-10-13-T-CI-web-green-fe/` |
