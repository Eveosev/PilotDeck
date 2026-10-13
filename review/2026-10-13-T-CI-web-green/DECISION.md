# T-CI-web-green (PR-W) — A/D 组决策

- 基线：`rust_standalone_alpha1@761572d7ff548eb41f27ebdb9a70faaccc73fdb8`
- 目标：Web Regression（`.github/workflows/web-regression.yml`，step `Test Web UI and server`）全绿
- 范围：仅 A 组（8 个 `node:test` 被 vitest 误收）+ D 组（`config.test.js` memory reload 超时 / TDZ）
- 不做：B 组 `DesktopAboutSections.test.tsx`、C 组 `moduleLabels.test.tsx`（另一工程师同分支）
- 门禁：不加超时、不 skip/only、不重试、不删断言；改动限于失败测试、vitest 配置、`web-regression.yml`；产品代码仅在能证明 TDZ 根因在产品文件时才动

## 归属（run 38340992186 / 主线 761572d7）

| ID | 失败 | 根因 | 修复 | 文件:行 | 状态 |
|---|---|---|---|---|---|
| A-1 | `ui/server/module-request-abort.test.js` 整文件 `Cannot bundle built-in module node:test` | vitest 按默认 include 收了 `node:test` 文件；vite 无法打包内置模块 | 待写：vitest 排除规则 + CI `node --test` | `ui/server/module-request-abort.test.js:3` | open |
| A-2 | `ui/server/public-knowledge-model-selection.test.mjs` 同上 | 同上 | 同上 | `:2` | open |
| A-3 | `ui/server/staffdeck-approval-authority.test.mjs` 同上 | 同上 | 同上 | `:1` | open |
| A-4 | `ui/server/staffdeck-public-capabilities.test.mjs` 同上 | 同上 | 同上 | `:1` | open |
| A-5 | `ui/server/staffdeck-publish-route.test.js` 同上 | 同上 | 同上 | `:2` | open |
| A-6 | `ui/server/staffdeck-publish-runtime.test.mjs` 同上 | 同上 | 同上 | `:1` | open |
| A-7 | `ui/server/staffdeck-runtime-readiness.test.mjs` 同上 | 同上 | 同上 | `:1` | open |
| A-8 | `ui/server/adapters/staffdeck-request-context.test.js` 同上 | 同上 | 同上 | `:2` | open |
| D-1 | `can reload memory inheritance after removal (memory enabled=true)` 5000ms timeout | 待测：动态 `import` Gateway TS loader 经 Vite SSR 的耗时 / 模块图 | 待写；不加超时 | `ui/server/routes/config.test.js:1614` / `loadPilotConfig.ts` | open |
| D-2 | `... (memory enabled=false)` `ReferenceError` TDZ `existsSync` | 待测：超时用例泄漏的 pending import + `vi.resetModules()` / Vite SSR 绑定初始化顺序 | 待写；产品改动需独立 Reviewer 节 | `src/pilot/config/loadPilotConfig.ts:221` ← `:80` ← `config.test.js:1629` | open |

## 产品代码改动（Reviewer 专节）

本轮默认不改 `src/pilot/config/loadPilotConfig.ts`。若证据证明 TDZ 根因在该文件（而非测试 mock / Vite 模块图），再在此节写：

1. before-fix 日志 / 最小复现（稳定复现 TDZ，且证明不在测试 mock）
2. diff 仅触及 TDZ 相关初始化顺序
3. 全量 web suite 0 fail

当前：无产品代码改动。
