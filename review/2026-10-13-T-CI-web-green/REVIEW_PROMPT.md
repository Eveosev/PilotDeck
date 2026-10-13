# REVIEW_PROMPT — T-CI-web-green / PR-W

请只读审阅，不要 fetch 之外的写操作、不要评论到 PR 线程除非 Payne 要求、**不要 mark ready / merge**。PR 必须保持 **draft**。

## 身份

- PR：https://github.com/Eveosev/PilotDeck/pull/12 （draft）
- 分支：`pilotdeck-rust/T-CI-web-green` → base `rust_standalone_alpha1`
- tip：`c17f18747ebb2f3ee9b9eef0652972d196317639`
- base：`761572d7ff548eb41f27ebdb9a70faaccc73fdb8`
- 源失败：Web Regression run `38340992186`（15 条 = A8 + B4/6 + C1 + D2）
- QA PASS：run `38348207846` attempts 1/2/3 全绿；web 268 files / 2204 tests 0 fail；`node --test` 8 文件 40/0

## 范围

Web Regression step `Test Web UI and server` 全绿。四组都在本 PR：

| 组 | 改动面 | 不要指望看到的东西 |
|---|---|---|
| A | `ui/vite.config.js`、`vitest.config.js`、`.github/workflows/web-regression.yml` | 不改那 8 个 `node:test` 用例正文 |
| B | 仅 `DesktopAboutSections.test.tsx` | 不改 `DesktopAboutSections.tsx` |
| C | 仅 `moduleLabels.test.tsx` | 不改 `SettingsContent.tsx` |
| D | 仅 `ui/server/routes/config.test.js` | **不改** `src/pilot/config/loadPilotConfig.ts` |

对照：`git diff 761572d7..c17f1874 -- ':!review'`。

## 约束（违规即 fail）

- 不加超时、不 `skip`/`only`、不重试、不删断言
- 产品 `loadPilotConfig.ts` 未改（见 DECISION「产品代码改动」专节）
- 不 force-push / rebase；保持 draft

## 请核对

1. **根因 vs diff**：DECISION.md 每条 ID 的根因是否被对应 diff 证成。B/C 根因以 `review/2026-10-13-T-CI-web-green-fe/README.md` 为准（本包照录，勿用别的故事覆盖）。
2. **A**：vitest 排除规则是否只匹配 `from/import 'node:test'`；CI step `Test Web UI node:test files` 是否打印 8 条路径并 `node --test`（排除而不跑 = fail）。
3. **D**：`spawnSync(node --import tsx)` 是否仍调用真实 Gateway loader、断言未删；超时/TDZ 证据是否支持“Vite 图 + resetModules”而不是产品 init order。计时摘要在 PROGRESS.md。
4. **B**：按钮文案是否与组件 `pending ? updating : canInstall ? updateAndRestart : checkAgain` 对齐；不可安装路径找 `checkAgain`；可安装路径仍找 `updateAndRestart`。
5. **C**：`SettingsContent` 是否包 `<MemoryRouter>`；Sidebar 不包；`getByText('设置')` + `getAllByText('通用').length === 2` 仍在。
6. **QA**：`review/2026-10-13-T-CI-web-green/qa-gate-c17f1874/SUMMARY.md`（若已推送到分支）。若缺，PROGRESS 已注明期望路径；可用 GitHub run `38348207846` attempts 1/2/3 对照，不要编造 SUMMARY 正文。`evidence/qa-gate.txt` 只链路径。
7. **证据**：`evidence/index.md`；A/D stub 只有 sha256（全文是 PR artifact）；B/C 指向 `-fe/*.txt`。

## 结论格式

给出 **conditional_pass** 或 **fail**，附具体 findings（文件:行 + 为什么）。有存活的门禁违规（加超时 / skip / 删断言 / 改了 `loadPilotConfig.ts` 却无产品门槛证据）→ **fail**。仅文档缺口且代码门禁仍立得住 → 可 **conditional_pass**，写明要补什么。

写到本目录 `REVIEW_RESULT.md`（若你的流程要求），不要改代码、不要标 ready。
