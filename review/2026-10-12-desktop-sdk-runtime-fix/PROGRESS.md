# Desktop SDK runtime packaging — progress

R2 follow-ups from the 2026-10-12 review. Required items land in this PR; F-* stay tracked here.

## This round

| ID | Status | Notes |
|---|---|---|
| R2-1 | done | Export `rewriteUiServerSourceImports` and `verifyRuntime` from `build-runtime.mjs`. Tests import those real functions (no source-copied rewrite/verify). Added a test that the relative-import verifier throws when a transitively imported file is missing. Local verifier mutation recorded as FAIL; mutation not committed. |
| R2-2 | done | `isExecutedAsMain()` realpaths both `process.argv[1]` and the `import.meta.url` path before comparing. Test runs the script via a symlink (`--probe-main`). |

## Follow-up plan

| ID | Owner / next | Plan |
|---|---|---|
| F-2 | separate UI PR | Linux DEB chrome e2e (`ui/e2e/desktop-chrome.smoke.mjs:237`) expects `.workspace-header h1[data-desktop-no-drag=""]`. Same miss on base `1da663a2` and this PR: neither `h1` in `MainAreaV2.tsx` (L59, L267–274) has the attribute. Unit `MainAreaV2.test.tsx:131` fails identically on both SHAs. Do not mix a UI attribute fix into desktop packaging. Evidence: `round2/legacy-deb-e2e/`. |
| F-5 | CI / maintainer | Windows arm64 PortableGit 504 (job `114797233974`) could not be rerun (`gh run rerun` and Actions API returned 403 / "job cannot be rerun"). Re-run on a later push with a token that can retry failed jobs, or wait for the next Desktop Windows arm64 workflow. Not a packaging-code defect. |
| F-6 | separate UI PR | Pre-existing Web Regression on `rust_standalone_alpha1`: `ui/src/components/settings/view/about/DesktopAboutSections.test.tsx` cannot find the `updateAndRestart` button role. Outside desktop packaging scope. |
| F-7 | pending decision | Do not delete `review/2026-10-12-desktop-sdk-runtime-fix/` yet. New evidence must be small text files only (no new screenshots or binaries). |

## R2 evidence

Collected on clean `6ecd3221` (`gitDirty=false`). Mutation of the transitive walk was restored and not committed.

- `round2/r2-followup/r2-imports-after.txt` — 4/4 pass
- `round2/r2-followup/r2-1-mutation-fail.txt` — R2-1 FAIL (`Missing expected exception.`)
- `round2/r2-followup/desktop-tests.summary.txt` — desktop suite 152 pass / 0 fail / 1 skip

