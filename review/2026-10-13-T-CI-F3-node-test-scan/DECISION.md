# T-CI-F3 — Web `node --test` 扫描集与 vitest exclude 对齐

- 基线：`rust_standalone_alpha1@d6ec73d824e74009c47c0254c86db194ad7ce66d`
- 分支：`pilotdeck-rust/T-CI-F3-node-test-scan`
- 范围：只改 CI / 测试配置 / 工具。不改产品代码，不改任何测试断言。

## `ui/vite.config.js` 实际改了什么

不是「只动 test 块」。相对基线：

- 文件顶部：删掉内联 `vitestExcludeNodeTestFiles` 扫描器，改为 `import { listNodeTestFiles } from '../scripts/lib/web-node-test-files.mjs'`
- `test.exclude`：仍展开同一扫描结果（`...vitestExcludeNodeTestFiles(__dirname)`）
- build / server / plugins：**未改**
- 曾为触发 Desktop `ui/**` 加过一句 test 块注释；F7 已删。Desktop 改为 path filter 含 `scripts/lib/**`（F5）

## 决策

1. `scripts/lib/web-node-test-files.mjs`：唯一 `from/import 'node:test'` 扫描；CI `--print` 用它跑 `node --test`。
2. `ui/vite.config.js` 与根 `vitest.config.js` 都 import 它展开 `test.exclude`。
3. `scripts/check-web-node-test-scan.mjs` **加载生效配置**：
   - `vite.loadConfigFromFile` 读 `ui/vite.config.js`
   - `import()` 读 `vitest.config.js`（`scripts/lib/resolve-from-ui.mjs` 把 `vitest`/`vite` 指到 `ui/node_modules`；解析失败打明确错误，F6）
   - 读两边 `config.test.exclude`，去掉 `e2e` / `node_modules` / `dist` 基线 glob，用 **picomatch**（root `devDependency` `^4.0.4`，lockfile 只改 `importers`）解析成 `ui/` 测试文件集
   - 各与 `node --test` 集比较；任一侧多或少都非 0
4. F1 负向：temp worktree **真改** `test.exclude` 的 glob（`?` 或零深度 `**`），不能手写 regex 自注入。

当前解析结果仍是那 8 个 `ui/server/**` 文件。
