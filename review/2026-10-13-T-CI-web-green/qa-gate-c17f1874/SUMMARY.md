# QA Gate SUMMARY — PR #12 (PR-W) tip `c17f1874`

- **PR:** https://github.com/Eveosev/PilotDeck/pull/12
- **Tip:** `c17f18747ebb2f3ee9b9eef0652972d196317639`
- **Base:** `rust_standalone_alpha1` @ `761572d7`
- **Draft:** yes (`isDraft: true`) — not ready, not merged
- **Gate overall:** **PASS**
- **Evidence dir:** `/workspace/pilotdeck-rust/review/2026-10-13-T-CI-web-green/qa-gate-c17f1874/`
- **Checked at:** 2026-10-13 ~13:00 CST (UTC+8)

## Gate 1 — Structure

Non-review files vs `761572d7` (exactly the allowed set):

1. `.github/workflows/web-regression.yml` — A-group CI step `Test Web UI node:test files`
2. `ui/vite.config.js` / `vitest.config.js` — exclude `node:test` files from vitest
3. `ui/server/routes/config.test.js` — D-group (fresh `node --import tsx` worker; product unchanged)
4. `ui/src/components/settings/view/about/DesktopAboutSections.test.tsx` — B-group
5. `ui/src/components/settings/moduleLabels.test.tsx` — C-group

- Worktree porcelain: **0**
- Product `src/pilot/config/loadPilotConfig.ts`: **not in diff** (only referenced from the test worker)
- Diff artifact: `non-review.diff` (sha256 `d25b9599…87d59`)

## Gate 5 — No bypasses

Ban-scan on added (`+`) lines of `non-review.diff`:

- timeout API / `testTimeout` / numeric timeout bumps: **none**
- `skip` / `only`: **none**
- `retry` / `retries`: **none**
- Comment mentioning “timeout” in D-group rationale only (not an API change)

Assert counts tip vs `761572d7` (unchanged):

| file | tip | base |
|------|-----|------|
| `ui/server/routes/config.test.js` | 362 | 362 |
| `moduleLabels.test.tsx` | 4 | 4 |
| `DesktopAboutSections.test.tsx` | 16 | 16 |

## Gate 2 — Web job green (workflow `web-regression.yml`)

Single run id **38348207846**, headSha `c17f1874…`, three consecutive attempts all **success**:

| Attempt | Conclusion | Web job | Docker | Vitest | Fails file |
|---------|------------|---------|--------|--------|------------|
| 1 | success | success | success | 268 files / 2204 tests passed | `ci-runs/run1.fails.txt` (empty) |
| 2 | success | success | success | 268 / 2204 | `ci-runs/run2.fails.txt` (empty) |
| 3 | success | success | success | 268 / 2204 | `ci-runs/run3.fails.txt` (empty) |

URLs (same run, attempts):

- Attempt 1: https://github.com/Eveosev/PilotDeck/actions/runs/38348207846/attempts/1
- Attempt 2: https://github.com/Eveosev/PilotDeck/actions/runs/38348207846/attempts/2
- Attempt 3: https://github.com/Eveosev/PilotDeck/actions/runs/38348207846/attempts/3
- Canonical: https://github.com/Eveosev/PilotDeck/actions/runs/38348207846

Packaging run `38348207851` ignored for this gate (out of scope).

## Gate 3 — A-group `node --test` in CI

Step **`Test Web UI node:test files`** present and **success** on all 3 attempts.

Printed file list (**8 files**, every attempt):

1. `server/adapters/staffdeck-request-context.test.js`
2. `server/module-request-abort.test.js`
3. `server/public-knowledge-model-selection.test.mjs`
4. `server/staffdeck-approval-authority.test.mjs`
5. `server/staffdeck-public-capabilities.test.mjs`
6. `server/staffdeck-publish-route.test.js`
7. `server/staffdeck-publish-runtime.test.mjs`
8. `server/staffdeck-runtime-readiness.test.mjs`

Summary each attempt: `# tests 40` / `# pass 40` / `# fail 0`

Evidence: `ci-runs/run1.node-test.txt`, `run2.node-test.txt`, `run3.node-test.txt`

## Gate 4 — D-group `config.test.js` memory true/false × 3 CI attempts

Same tip, same run, 3 consecutive CI attempts (attempt 1 = natural PR run; 2–3 = full `gh run rerun`):

| Attempt | memory enabled=true | memory enabled=false |
|---------|---------------------|----------------------|
| 1 | ✓ (2048ms) | ✓ (1453ms) |
| 2 | ✓ (2088ms) | ✓ (1523ms) |
| 3 | ✓ (1649ms) | ✓ (1135ms) |

Evidence: `ci-runs/run1.config-memory.txt`, `run2.evidence.txt`, `run3.evidence.txt`

Local suite alone was **not** used for this gate.

## Overall

**PASS** — all 5 gates satisfied; no blockers.

Next (for humans / Payne, not done by QA):

1. Reviewer on PR-W (note: product `loadPilotConfig.ts` untouched; D fix is test-side worker).
2. Payne merge PR-W.
3. Sync #7 to mainline, real-run CI full green, then ready+merge.
4. #7 and #12 stay **draft** until then.
