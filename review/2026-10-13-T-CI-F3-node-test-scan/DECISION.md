# T-CI-F3 — Web `node --test` 扫描集与 vitest exclude 对齐

- 基线：`rust_standalone_alpha1@d6ec73d824e74009c47c0254c86db194ad7ce66d`
- 分支：`pilotdeck-rust/T-CI-F3-node-test-scan`
- 范围：只改 CI / 测试配置 / 工具。不改产品代码，不改任何测试断言。
- `ui/vite.config.js` 只动 `test` 块（一句注释）。不改 build / server / plugins。

## 决策

1. `scripts/lib/web-node-test-files.mjs`：唯一 `from/import 'node:test'` 扫描；CI `--print` 用它跑 `node --test`。
2. `ui/vite.config.js` 与根 `vitest.config.js` 都 import 它展开 `test.exclude`。
3. `scripts/check-web-node-test-scan.mjs` **加载生效配置**，不是自己和自己比：
   - `vite.loadConfigFromFile` 读 `ui/vite.config.js`（Vite/Vitest 真正用的 exclude；裸 `import` 会被 `lightAppearance` TS 挡住）
   - `import()` 读 `vitest.config.js`（`scripts/lib/resolve-from-ui.mjs` 把 `vitest` 指到 `ui/node_modules`，Web-only install 也能加载）
   - 读两边 `config.test.exclude`，去掉 `e2e` / `node_modules` / `dist` 基线 glob，解析成 `ui/` 下测试文件集
   - 各与 `node --test` 集比较；任一侧多或少都非 0
4. 负向证明必须在 temp worktree **真改** `ui/vite.config.js` 的 `test.exclude`（加一条 / 删一条），不能用 `--extra-exclude` 自注入。

当前解析结果仍是那 8 个 `ui/server/**` 文件。
