# T-P0a-07 PROGRESS

- 任务：T-P0a-07 Module Protocol 同步门禁（文档先行）
- 分支：`pilotdeck-rust/T-P0a-07-protocol-change-gate`
- PR：#7 draft → `rust_standalone_alpha1@1da663a2`
- 禁止：rebase / force-push / ready / merge；不改 `src/`、`.github/`、`crates/`、lockfile

## Commits

| # | 角色 | SHA |
| --- | --- | --- |
| — | R2 审阅点 | `9da4ee1df3df9169df8a7f1f8ad327a0ecb2ceaa` |
| 1 | 文档（R2-1…R2-7） | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| 2 | 本证据提交（parent = 采集 SHA） | （落地后 = 本提交） |
| 3 | F-7 删除 `review/**/evidence` 原始件 | （后继提交） |

采集时 **`gitDirty=false`**，`gitSha=14b1a71ee8a63371c79a830f656482657e2a25a6`。

## R2 修复

| ID | 处理 |
| --- | --- |
| R2-1 | 触发列表补 schema JSON / replay 报告 / 门禁文档 / `package.json` / `pnpm-lock.yaml`；gate 与 CONTRIBUTING 逐字相同 |
| R2-2 | 命令块用 `bash -e`；`replay_exit` 先 restore 再 exit；块内无 `#` 注释 |
| R2-3 | 本文件 + `evidence/README.md` 恢复 G2/G3 明细、enum 说明、临时分支 SHA、`not pushed` / `ls-remote` 为空 |
| R2-4 | 检查 4 子 shell；`pnpm build || exit 2` |
| R2-5 | Node 22 engines `>=22.13.0 <23`；exit 9 = Node < 22.6 |
| R2-6 | 补全 `protocol.ts is missing …` / `function … is not closed` |
| R2-7 | 写明两处命令必须一起改，以 CONTRIBUTING 为准 |

## 子目录 → 采集 SHA（R2-3）

| 子目录 | 采集 `gitSha` | dirty |
| --- | --- | --- |
| `baseline/` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` | false |
| `dry-run-g2/` | protocol `f019dca634ab8b12419d3f8c18cea9dfbbd71a7f` / schema `6f37ee7751b43f0fe92b189a300a2a9bd0db8f04` | false |
| `dry-run-g3/` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` | false |
| `r1-verbatim/` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` | false |
| `r2-verbatim/` | `8004fb21598abccd5ad7bcae5c7d62ecc58c1458` | false |
| `r3-verbatim/` | `14b1a71ee8a63371c79a830f656482657e2a25a6` | false |

临时分支 `tmp/T-P0a-07-dry-g2` / `tmp/T-P0a-07-dry-g3` **未推送**。`git ls-remote --heads origin 'tmp/T-P0a-07*'` 为空。

### G2 为什么选 enum 而不是 optional 字段

QA 举例「加 optional 字段」。若只改 TypeScript 类型、不改 `MODULE_CALL_TARGETS` / 版本 / `isOutcome` / 锚点，1a **不会** stale（局限 **F-5**）。G2 因此选用生成器实际抽取的 enum（`notes`）。1a = **FAIL schema-stale** exit 1。

### G3

只改 `validateModuleMessage` 使 execute 的 `sessionId` 必填、不更新 schema。1a 仍 PASS（F-5 漏报）；replay **FAIL** exit 1，`expressibleMismatches=53`。清单整体 FAIL，满足 G3。

## R3 原文连跑（`bash -e`）退出码

| 步 | exit |
| --- | --- |
| 1a | 0 |
| generate / 1c `git diff --exit-code` | 0 |
| replay (`replay_exit`) | 0 |
| restore + porcelain | 0 |
| 2 | 0 |
| 3 | 0 |
| 7 | 0 |
| 整段 `bash -e` | **0** |

`r3-verbatim/verbatim-sequence.txt`：`gitSha=14b1a71e…`，`gitDirty False`。

## F-7 待删除文件清单

下一提交将删除 `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/` 下全部原始日志。保留本目录的 `DECISION.md` / `PROGRESS.md` / `REVIEW_RESULT.md` / `REVIEW_RESULT_R2.md` / `REVIEW_PROMPT.md`。

原始件已复制为 PR artifacts：`/opt/cursor/artifacts/T-P0a-07-f7-raw/`（以及 `r3_verbatim_sequence.txt`）。

sha256 为文件内容（blob bytes）的 SHA-256。


删除文件数：**81**。

| path | sha256 | collection gitSha |
| --- | --- | --- |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/README.md` | `83a27d4b4fe5bddbb3d80451c97059292cf205a535a30887f3a9c78bed4cdf46` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/baseline/cargo-test.txt` | `10ff987da763d90eddf50a5f2bdbf06c2e16b2b6dc49ef7f60a5b2fc324ed32b` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/baseline/cargo.exit.txt` | `31144927326a1166e3ae61d77ddb916dcbc8b45f707dea4120836e8cc4d4a447` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/baseline/check1a.exit.txt` | `78ea6006a1fe00c1b3ea117705335d7fe9afd3a0e633078c4d4900e3a5b69fc2` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/baseline/check1a.txt` | `61a0355f833d708acdc104edf427d70434f8d11797660340465463f64055572e` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/baseline/check1c-diff.txt` | `f7eef722a8080b305beee4a94012f16641141559cfe4b73931b49e86aec62641` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/baseline/generate-1.txt` | `5027b82fedafb2da1de3db4435246b12f8f5384a1be9952ce772363e120190a6` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/baseline/generate1.exit.txt` | `6e19935ee08c74106121ec82c22926480f6a3d03f15fa1775d369a7a7fb5e607` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/baseline/git-sha.txt` | `9e462fed6e19c327d76ad8b341ee663b465889362fe8305299061d6a952ceb90` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/baseline/git-status.txt` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/baseline/provenance.txt` | `11b96f1a4802b85f054d933dfcdb2b1c7e84569f6cc6f23272e188ff04d25a4b` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/baseline/replay.exit.txt` | `651bf1314e8c9ad97830c162ea66d4a37ffd860ac24e4b57b23bb892fd01014d` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/baseline/replay.stderr.txt` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/baseline/replay.stdout.txt` | `cb02855f3d6039f707612147bd98f2895bc5d7e3496cf0aed92e8ace2a288046` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/cargo-test.txt` | `30e9d298697f5fe2d5a57824704f3c8c6a49bd39f718ab25c35a7c1f7c2e835f` | `f019dca634ab8b12419d3f8c18cea9dfbbd71a7f` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/cargo.exit.txt` | `31144927326a1166e3ae61d77ddb916dcbc8b45f707dea4120836e8cc4d4a447` | `f019dca634ab8b12419d3f8c18cea9dfbbd71a7f` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/check1a.exit.txt` | `158315420c7e62aff2835cfdb26b2e56ba24e9c1e2c30a1137584f8fcdcffabc` | `f019dca634ab8b12419d3f8c18cea9dfbbd71a7f` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/check1a.txt` | `c576951e73f352737f667fdef39e30844c776e3604233f19868ecf5dc228d221` | `f019dca634ab8b12419d3f8c18cea9dfbbd71a7f` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/check1c.exit.txt` | `f7eef722a8080b305beee4a94012f16641141559cfe4b73931b49e86aec62641` | `6f37ee7751b43f0fe92b189a300a2a9bd0db8f04` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/commit.sha.txt` | `00be031dc7ead805a4288d929138960889359ce8aa7327a425250b1d7eccbe42` | `f019dca634ab8b12419d3f8c18cea9dfbbd71a7f` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/generate-1.exit.txt` | `6e19935ee08c74106121ec82c22926480f6a3d03f15fa1775d369a7a7fb5e607` | `f019dca634ab8b12419d3f8c18cea9dfbbd71a7f` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/generate-1.txt` | `5027b82fedafb2da1de3db4435246b12f8f5384a1be9952ce772363e120190a6` | `f019dca634ab8b12419d3f8c18cea9dfbbd71a7f` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/generate-2.exit.txt` | `440d4919acea8077569be2d88ab23929387824a9e5b56f45a0b99b708b411355` | `6f37ee7751b43f0fe92b189a300a2a9bd0db8f04` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/generate-2.txt` | `5027b82fedafb2da1de3db4435246b12f8f5384a1be9952ce772363e120190a6` | `6f37ee7751b43f0fe92b189a300a2a9bd0db8f04` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/git-status-after-commit.txt` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `f019dca634ab8b12419d3f8c18cea9dfbbd71a7f` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/protocol.diff` | `b5310a529e13c60c6e6ebb7f6617d3c7e9c0b5546c78da95318691ee191cc950` | `f019dca634ab8b12419d3f8c18cea9dfbbd71a7f` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/replay.exit.txt` | `651bf1314e8c9ad97830c162ea66d4a37ffd860ac24e4b57b23bb892fd01014d` | `6f37ee7751b43f0fe92b189a300a2a9bd0db8f04` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/replay.stderr.txt` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `6f37ee7751b43f0fe92b189a300a2a9bd0db8f04` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/replay.stdout.txt` | `a965ed62b35cae305b0285a6915229af0efcf4fa7ebb0f54111fc3a1d2f3ecc8` | `6f37ee7751b43f0fe92b189a300a2a9bd0db8f04` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/schema-after-regen.diff` | `2cec9efba9abc087b9a0d50fe37e68c89fd31648874e88a47faacf40f6979c66` | `6f37ee7751b43f0fe92b189a300a2a9bd0db8f04` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/schema-commit.sha.txt` | `d2417bd71e42333df26ed94f631267759c854526c3140cdeb5d5aef817345757` | `6f37ee7751b43f0fe92b189a300a2a9bd0db8f04` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g2/version-grep.txt` | `c2d94258dbef3e34929bc27fde104a53ab133489e39dcf2e25c6a9073ed5f374` | `f019dca634ab8b12419d3f8c18cea9dfbbd71a7f` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g3/check1a.exit.txt` | `78ea6006a1fe00c1b3ea117705335d7fe9afd3a0e633078c4d4900e3a5b69fc2` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g3/check1a.txt` | `61a0355f833d708acdc104edf427d70434f8d11797660340465463f64055572e` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g3/commit.sha.txt` | `d895c45e792c61fdd2ba8e9bc82258c6b9a7151048b6f9e61021de3a88306369` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g3/generate-1.exit.txt` | `6e19935ee08c74106121ec82c22926480f6a3d03f15fa1775d369a7a7fb5e607` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g3/generate-1.txt` | `5027b82fedafb2da1de3db4435246b12f8f5384a1be9952ce772363e120190a6` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g3/git-status-after-commit.txt` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g3/protocol.diff` | `37dfd559d09e9c3768debc552409759ce7e9aa3745afec81dba5964aab416b85` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g3/replay.exit.txt` | `998b48752e81ecabd739e033b871271b7d4948d15cc5be9be0a455424636ac12` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g3/replay.stderr.txt` | `b936512176056dcf2bce57adfb2d8c79a991ffc9dd2cea9d407f1c39aa44e109` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g3/replay.stdout.txt` | `545659efc312e3f2b2ce92ed81bd7107dfebc9c7f5035ee953f1cbea333be575` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g3/schema-diff.exit.txt` | `9c09d5fc389248de3fb8daa7c6a881bca4c1fde180445c932e765e62053aa699` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/dry-run-g3/status-after-generate.txt` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/provenance.json` | `36ebbecb34823c0055ab2b14c86abb65eb11a7a9ac3b1ec5508c3088b802d2cd` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/cargo-test.txt` | `2832b42847e81a7f25f14003bd23d1745b6ebb41e99e42526d3e7dff2fe1148f` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/cargo.exit.txt` | `31144927326a1166e3ae61d77ddb916dcbc8b45f707dea4120836e8cc4d4a447` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/collect.txt` | `ce6efaed066fdfe0a01acff4a83aec328e28dedc57b9920e6a44c3dea6b97c24` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/node20-replay.exit.txt` | `37531aa2f7a60a9fa753bcfa9881a5de2c689733e51c9fb24c57eb2c27725142` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/node20-replay.txt` | `982cc379aae8b9f671b6d9e0021c2cb4c10341b9568c77fa9721783c7a7e35ba` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/old-replay-1.txt` | `fbdd6919359ddbf39c7d3a37ab0eb137e733b9be48d70f40e25fd175a690b46d` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/old-replay-2.txt` | `2a25a5a0ae13c98479ae0f8a258463223602834a5c8bb26afed28bd75593062e` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/old-sequence-dirty.log` | `61db6e08c8843c4ad76c3e285e947cd4138dceca60fd14a8635f5e9c544a3068` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/old-sequence-dirty.txt` | `61db6e08c8843c4ad76c3e285e947cd4138dceca60fd14a8635f5e9c544a3068` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/replay-report.json` | `a7c300294b8271b419704222837b64cf0db151433ea5851808f46a893757393d` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/replay-stdout.txt` | `fbdd6919359ddbf39c7d3a37ab0eb137e733b9be48d70f40e25fd175a690b46d` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/verbatim-sequence.log` | `e5c48694b8ca9722db5f27ae85a44f0d964487bde4fd90edd99dce85c02fe377` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/verbatim-sequence.txt` | `e5c48694b8ca9722db5f27ae85a44f0d964487bde4fd90edd99dce85c02fe377` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r1-verbatim/version-grep.txt` | `9e5513b809471873113fe9cb04202337a54d89f95358a6f0bc03078da019a502` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r2-verbatim/check1a.exit.txt` | `88b991d2f2f5aacded3a4dfd7516c2b86457143fa55db7228bdc687adefb8ec6` | `8004fb21598abccd5ad7bcae5c7d62ecc58c1458` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r2-verbatim/check1c.exit.txt` | `dccd2291b1dda3bc999e550b4716ce6f9787428592ebd08d71532950cec49fd1` | `8004fb21598abccd5ad7bcae5c7d62ecc58c1458` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r2-verbatim/check2.exit.txt` | `554a45a2219e50e8ad6e221a1b764864fdc577aec3108ea68b05ba7eb9f288c9` | `8004fb21598abccd5ad7bcae5c7d62ecc58c1458` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r2-verbatim/check3.exit.txt` | `28d7f8eca2babaf26adefae487ab30229dcbfdf71f81b0c171a4601a02730041` | `8004fb21598abccd5ad7bcae5c7d62ecc58c1458` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r2-verbatim/check7.exit.txt` | `3cf6872368a33cd7fd2cc1cf315c6eae538b7164f8b7b2be46f68a54c126893a` | `8004fb21598abccd5ad7bcae5c7d62ecc58c1458` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r2-verbatim/collect.txt` | `ee14422c5545839c0fbed00d3d30d60ef70a5d048987dc7062db5df0ad55d8d8` | `8004fb21598abccd5ad7bcae5c7d62ecc58c1458` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r2-verbatim/generate1.exit.txt` | `beffd6838566fb522ef22490d8c28f684af3e0b44d52cc1bb910da8bfe8f8ac3` | `8004fb21598abccd5ad7bcae5c7d62ecc58c1458` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r2-verbatim/replay-stdout.txt` | `fb04237b4e15674a8206c56ba40e9242f684a91b0a788a6cd9671b4c6a2f294a` | `8004fb21598abccd5ad7bcae5c7d62ecc58c1458` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r2-verbatim/replay.exit.txt` | `34d58f60950a00d0335c3086d45dae6263521407d7cd87c34d15e3a75726bf37` | `8004fb21598abccd5ad7bcae5c7d62ecc58c1458` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r2-verbatim/verbatim-sequence.txt` | `fccb34fd93af42c06394f5a7f3124809f2e21eb04748044a1230963fb2235f02` | `8004fb21598abccd5ad7bcae5c7d62ecc58c1458` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r3-verbatim/check1a.exit.txt` | `78ea6006a1fe00c1b3ea117705335d7fe9afd3a0e633078c4d4900e3a5b69fc2` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r3-verbatim/check1c.exit.txt` | `3f474bef82e9ee4c72cb1883ffde15b338af60c8fda4343306db34ded1562c94` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r3-verbatim/check2.exit.txt` | `bc43cc399367d182e48ce73b8cf423ba1abd4dbd8dfcba832637fc763e314772` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r3-verbatim/check3.exit.txt` | `49c08a391b5007ad177c19d07fe0374a79d2f70a0c86f7ab57b5b2985754d91b` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r3-verbatim/check7.exit.txt` | `14ffcecac553977e878f72b6ed263eb5f0dd39c65b05df19ed80f526dd7642d9` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r3-verbatim/collect.txt` | `722318cd633628449b0298157a15fedf997771c7c63e9e37124d4b6e86bcc056` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r3-verbatim/generate1.exit.txt` | `6e19935ee08c74106121ec82c22926480f6a3d03f15fa1775d369a7a7fb5e607` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r3-verbatim/replay-report.json` | `6669a7b543c2b751b64486ac3ec2a180a3f03de33b9a7322c8b6d3fe54ddbea3` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r3-verbatim/replay-stdout.txt` | `9a2b40d42b3a574e25114cb007ccce88444f0a85f97efb44b3285ade256d6cb1` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r3-verbatim/replay.exit.txt` | `651bf1314e8c9ad97830c162ea66d4a37ffd860ac24e4b57b23bb892fd01014d` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r3-verbatim/verbatim-sequence.txt` | `ba600b964030ac86271dcf8e5abdb5fcbc7ca657a8354838d90e8a209a83506e` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
| `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/r3-verbatim/verbatim.exit.txt` | `cda8a3f8a8ef32acc7124f4baa182117bab9ab38a7659cb8adb9e422653f2180` | `14b1a71ee8a63371c79a830f656482657e2a25a6` |
