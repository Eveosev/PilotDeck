# T-CI-web-green 进度

- 分支：`pilotdeck-rust/T-CI-web-green`
- 基线：`761572d7ff548eb41f27ebdb9a70faaccc73fdb8`
- draft PR：https://github.com/Eveosev/PilotDeck/pull/12
- 源失败：run `38340992186`
- 最新 CI：https://github.com/Eveosev/PilotDeck/actions/runs/38345669771 （`ef51dec3`）docker **success**；web **failure** 仅 B+C（`2 failed | 266 passed` files，`7 failed | 2197 passed` tests）。`node --test` step：8 文件可见，`# tests 40` `# pass 40` `# fail 0`。

## 本轮

| 项 | 状态 | 说明 |
|---|---|---|
| 骨架 / draft PR-W | done | `e4719694` 先推，B/C 可并行 |
| A 组 vitest 排除 + `node --test` CI | done | 扫描 `from/import 'node:test'`；CI step 打印 8 个路径后 `node --test`。`ui/vite.config.js` 内联扫描器（不 import 根 `vitest.config.js`），避免 Docker `vite build` 解析失败。 |
| D 组计时取证 + 根因修复 | done | 见下；产品代码未改 |
| D 组连续 3 次绿 | done | 1) true 839ms / false 671ms 2) 962 / 772 3) 895 / 785。三次均 `2 passed` |
| 全量 web suite | done | 与 CI 相同 exclude：`Test Files  2 failed | 266 passed (268)`；`Tests  7 failed | 2197 passed (2204)`。仅剩 B（DesktopAboutSections 6）+ C（moduleLabels 1）。A 未再被收集；D 未出现在失败列表。 |
| 原始日志 | 不入库 | sha256 见下 |

## 收集 gitSha

实现 tip：`8578c925671b41d0b7ec97b040a6e8c5c6e54843`。基线对照：`761572d7`。

## Before / after（摘要）

### A 组

- Before（CI 38340992186）：8 个文件 vitest 收集失败，`Cannot bundle built-in module "node:test"`，0 用例运行。
- After（本地 `node --test` 同一 8 文件）：`# tests 40` `# pass 40` `# fail 0` `# duration_ms 142.7`。
- After（`vitest list` 点名 8 文件）：无输出（已排除）。
- 发现器（与 CI step 相同，cwd=`ui`）恰好 8 条：
  - `server/adapters/staffdeck-request-context.test.js`
  - `server/module-request-abort.test.js`
  - `server/public-knowledge-model-selection.test.mjs`
  - `server/staffdeck-approval-authority.test.mjs`
  - `server/staffdeck-public-capabilities.test.mjs`
  - `server/staffdeck-publish-route.test.js`
  - `server/staffdeck-publish-runtime.test.mjs`
  - `server/staffdeck-runtime-readiness.test.mjs`

### D 组计时（修复前，隔离跑 `config.test.js` `-t "can reload memory inheritance"`）

`enabled=true`：clone 0.1ms → createDiskConfigApp 121.3ms → preview 31ms → apply 19ms → yaml 2.1ms → **dynamic-import-loadPilotConfig.ts 2110.9ms** → loadPilotConfig-call 10.5ms。总 2298ms。
`enabled=false`：import 36.4ms（缓存）→ call 1.7ms。总 68ms。

`--testTimeout=1800`：true 在 import 阶段超时；import 在 FAIL 之后仍打出 `+2234.1ms`。false 随后 530.5ms import + 10.4ms call 通过。证明超时点是 Vite 动态 import，且超时不能取消该 import。

tsx 直载同一 TS：`import_ms 901.8` / `load_ms 0.7`，无 TDZ。

修复后连续 3 次（各含一次新进程 tsx）：

| 次 | true | false | 文件结果 |
|---|---:|---:|---|
| 1 | 839ms | 671ms | 2 passed / 121 skipped |
| 2 | 962ms | 772ms | 2 passed / 121 skipped |
| 3 | 895ms | 785ms | 2 passed / 121 skipped |

## 原始日志 sha256（不入库）

| 文件 | sha256 |
|---|---|
| `d-group-timing-1.log` | `007742e293fa09dddcf1969e0d469bc4a4eb9359331d68da3bce54aaad5353d9` |
| `d-group-timeout-tdz.log` | `6009339c52f3e11083f892584c2c7d5429c991939a975d874a92b1e5cc17916f` |
| `d-group-timeout-1800.log` | `a82481db150d87c3be7d51730cfcc9f5152e81b3e4fb29fcf0ee3381d762162a` |
| `tdz-repro.log` | `c6ef081567021e9c4b0de7aefa678818535c98e22a980b4580a2c3ebcb8ccf00` |
| `tdz-repro-concurrent.log` | `ddd5f4ca2e451571b4d8f7551bd77651350ac0ac6c2c5df7daeb4212cc7b11cb` |
| `tsx-import-timing.log` | `b606b2f6af6c0d0e6e8e038610665ef89eca3e5a0688d7c287ae4cb279c15e5d` |
| `d-group-after-1.log` | `67d91eb9ae3e6a387a9089edaa5c0b3955384dc2b59a2bc58cd2a1b13b9ac85f` |
| `d-group-after-2.log` | `9c6652ab5286b9518012c7f7f730548c93dfb7d977eb939bef99ba7f8cd37f51` |
| `d-group-after-3.log` | `75fdc5fc28d2e980937b5c8053d5741ba1703ff9690ef9593dd45b09d735c396` |
| `node-test-8-before.log` | `5b4a07b9f3fbfa355b0f659f57f46fd02f43f8c23a4254b26427a6af718bb86c` |
| `node-test-8-after.log` | `0057205009e700f22b4065dc9764b87942ef42e6ca9102284bad804bf1502677` |
| `web-suite-full.log` | `856e87a812b7906ca9ac7c626c021481a97213a7b9746519837be644c22353ac` |
