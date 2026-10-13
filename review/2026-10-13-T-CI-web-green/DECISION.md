# T-CI-web-green (PR-W) — A/B/C/D 决策

- 基线：`rust_standalone_alpha1@761572d7ff548eb41f27ebdb9a70faaccc73fdb8`
- 目标：Web Regression（`.github/workflows/web-regression.yml`，step `Test Web UI and server`）全绿
- 范围：A（`node:test` 误收）+ B（DesktopAbout 按钮文案）+ C（moduleLabels Router）+ D（config reload 超时 / TDZ）
- 门禁：不加超时、不 skip/only、不重试、不删断言
- QA PASS / code tip：`c17f18747ebb2f3ee9b9eef0652972d196317639` — run `38348207846` attempts 1/2/3 全绿
- slim qa-gate tip：`e63e2661036c01d0ec9bb39e6fc626a67a32ddee`
- F7/F5 clear-conditional tip：`8d2245248ebe676004db48f94dc8cae1573f9092`
- 当前 tip / head：`CURRENT_TIP_SHA_PLACEHOLDER`（本 tip-label 回填；相对 `c17f1874` 仍 **只有 `review/**`**，non-review delta = 0）
- 门禁 `non-review.diff` sha256：`d25b9599d7dc48f79e100698336bdfc4493a7a39e8faa0bf4447a7c902a87d59`（树内 `qa-gate-c17f1874/non-review.diff`）

B/C 根因与改动自 `review/2026-10-13-T-CI-web-green-fe/README.md` **原文照录**，不改写。

F3：CI `node --test` 发现与 vitest 排除用同一正则 `/(?:from|import)\s+['"]node:test['"]/`；cwd=`ui` 下命中集就是那 8 个 `server/**` 文件（CI run1 列表 = `vitest list` 排除集）。本轮不改 workflow/config（避免相对 `c17f1874` 的 non-review delta）。

## 归属（run 38340992186 / 主线 761572d7）

| ID | 失败 | 根因 | 修复 | 文件:行 | 状态 |
|---|---|---|---|---|---|
| A-1 | `ui/server/module-request-abort.test.js` 整文件 `Cannot bundle built-in module node:test` | vitest 默认 include 收了 `import { test } from 'node:test'` 文件；Vite 无法打包 Node 内置模块。与业务无关。 | `vitestExcludeNodeTestFiles()` 扫描 `from/import 'node:test'`，写入 `ui/vite.config.js`（内联，Docker 的 `vite build` 不能依赖根 `vitest.config.js`）+ 根 `vitest.config.js` 的 `test.exclude`。CI 新增 step `Test Web UI node:test files` 用同一规则发现并 `node --test`（日志打印文件列表）。 | `ui/server/module-request-abort.test.js:3`；排除：`ui/vite.config.js` `test.exclude`；运行：`.github/workflows/web-regression.yml` 新 step | done |
| A-2 | `ui/server/public-knowledge-model-selection.test.mjs` 同上 | 同上 | 同上 | `:2` | done |
| A-3 | `ui/server/staffdeck-approval-authority.test.mjs` 同上 | 同上 | 同上 | `:1` | done |
| A-4 | `ui/server/staffdeck-public-capabilities.test.mjs` 同上 | 同上 | 同上 | `:1` | done |
| A-5 | `ui/server/staffdeck-publish-route.test.js` 同上 | 同上 | 同上 | `:2` | done |
| A-6 | `ui/server/staffdeck-publish-runtime.test.mjs` 同上 | 同上 | 同上 | `:1` | done |
| A-7 | `ui/server/staffdeck-runtime-readiness.test.mjs` 同上 | 同上 | 同上 | `:1` | done |
| A-8 | `ui/server/adapters/staffdeck-request-context.test.js` 同上 | 同上 | 同上 | `:2` | done |
| B-1 | `disables unavailable updates` ×3（`noCompatibleInstaller` / `hasUpdate:false` / `checkFailed`） | 测试找 `updateAndRestart`。三组都使 `canInstall===false`，按钮文案是 `checkAgain` 且 disabled。 | 按角色名找 `checkAgain`。 | `ui/src/components/settings/view/about/DesktopAboutSections.test.tsx:26` | done |
| B-2 | `keeps updating disabled until main-process status is known` | 首次 `getUpdateStatus` reject → `statusFailed`、`update===null` → `canInstall===false` → `checkAgain` disabled。轮询成功后才是可安装的 `updateAndRestart` enabled。 | 未知状态断言 `checkAgain` disabled；状态已知后仍断言 `updateAndRestart` enabled。 | `DesktopAboutSections.test.tsx:53` | done |
| B-3 | `explains checksumMismatch and enforces its retry policy` | `state:'failed'` 使 `canInstall===false`，文案是 `checkAgain`。无 `onCheckUpdates` 时 `disabled===true`。旧期望 `updateAndRestart` + `disabled===false` 与当前组件不符。i18n / 主进程对 checksumMismatch 的“可再检查”策略在本测试 setup 下不能表现为可点的安装按钮。 | 找 `checkAgain`；期望 `disabled===true`。 | `DesktopAboutSections.test.tsx:59` | done |
| B-4 | `explains installFailed and enforces its retry policy` | 同上：`failed` → `checkAgain` disabled。主进程会锁死再安装；UI 无 check handler 时同样不能点。 | 找 `checkAgain`；期望仍 `disabled===true`。 | `DesktopAboutSections.test.tsx:59` | done |
| C-1 | `uses contribution translation keys for module navigation and headings` | `SettingsContent` 新增 `useLocation()` 读 `?reference=`。测试裸 `render` 没有 Router。 | `SettingsContent` 包 `<MemoryRouter>`。Sidebar 不用 location，不包。 | `ui/src/components/settings/view/SettingsContent.tsx:103`；测试 `moduleLabels.test.tsx:34` | done |
| D-1 | `can reload memory inheritance after removal (memory enabled=true)` `Test timed out in 5000ms` | 用例内 `await import('../../../src/pilot/config/loadPilotConfig.ts')` 走 Vite SSR。隔离跑该 import **2110.9ms**（`createDiskConfigApp` 仅 121ms，HTTP 各 19–31ms，`loadPilotConfig()` 调用 10.5ms）。全量 suite 下同一条 Vite 图 >5s。`--testTimeout=1800` 稳定在 import 阶段超时，且超时后 import 仍继续完成（+2234ms 打在 FAIL 之后）。 | 不再在 5s 用例里让 Vite 动态 import 该 TS 图。测试改为 `spawnSync(node --import tsx)` 在**新进程**里加载同一 `loadPilotConfig.ts`（更接近“重启应用”）。断言未改、未加超时。 | 原 `ui/server/routes/config.test.js:1628` 动态 import；现 `loadPilotConfig()` helper ~L31 | done |
| D-2 | `... (memory enabled=false)` `ReferenceError: Cannot access 'existsSync' before initialization` at `loadPilotConfig.ts:221` | TDZ **出现在 Vite SSR + `vi.resetModules` 的 vitest 路径**（`afterEach` / `createDiskConfigApp` 都会 `resetModules`）。**在 Vite 外不复现**：tsx / 新 Node 进程加载同一文件并调用 `loadPilotConfig()` 成功（`import_ms 901.8`）。`existsSync` 是 L1 真实 `node:fs` 绑定，`ui/` 无 `vi.mock('node:fs')`。证据不足以写成已证明的“超时 factory 半初始化重入”因果链；只记录观察环境与对照。 | 同上：测试不再经 Vite 求值该模块。**不改** `loadPilotConfig.ts`。 | 报错点 `src/pilot/config/loadPilotConfig.ts:221` ← `:80` ← 原 `config.test.js:1629` | done |

B 组未改的 3 个用例（一键更新、恢复进度、取消再试）本来就按可安装路径找 `updateAndRestart`。C 组第二条字面量 label 用例未改。

## 产品代码改动（Reviewer 专节）

**本轮不改 `src/pilot/config/loadPilotConfig.ts`。**

QA 要求的三条产品改动门槛均不满足：

1. TDZ **只在 Vite SSR + `vi.resetModules` 下被观察到**；tsx / 新进程（无 Vite）加载同一文件**不复现**。没有“去掉测试 mock 仍稳定复现、且根因在产品 init order”的日志。
2. 因此没有“只动 TDZ init order”的产品 diff。L1 `import { existsSync, readFileSync } from "node:fs"` 是合法 ESM。不把 Vite 变换细节写成已证实的产品缺陷。
3. 修复在测试侧：`config.test.js` 用独立 Node+tsx 进程加载真实 Gateway loader。

B/C 同样**未改** `DesktopAboutSections.tsx` / `SettingsContent.tsx`（FE README：失败是断言与既有文案/Router 约定不一致，不是组件回归）。

若未来在**非 Vite / 非 resetModules** 路径上稳定打出同一 TDZ，再回头看产品 init order。
