# Legacy Linux DEB chrome e2e — pre-existing `data-desktop-no-drag`

Collected on the clean PR head, then added in this commit.

- gitSha / collectSha: `524cb673362ca04ce02cab17b22f9d69b6a07b55`
- gitDirty: `false` (recorded before these files were written)
- recordedAt: `2026-10-12T13:13:12Z`
- compare: `1da663a21d40ef5e309c86423a235550c79f91ff` vs `524cb673362ca04ce02cab17b22f9d69b6a07b55`

No UI code was changed in this PR.

## The PR does not touch `ui/`

`git diff --name-only 1da663a2 524cb673 -- ui/` is empty. The PR file list is desktop packaging, new desktop script tests, and `review/` evidence only (`pr-files.txt`).

These blobs are identical on both SHAs (`blob-ids.txt`):

| Path | blob |
|---|---|
| `ui/src/components/app-shell/MainAreaV2.tsx` | `c612d38d…` |
| `ui/src/components/app-shell/MainAreaV2.test.tsx` | `76513460…` |
| `ui/e2e/desktop-chrome.smoke.mjs` | `b9c477aa…` |

Neither `h1` in `MainAreaV2.tsx` (L59, L267–274) has `data-desktop-no-drag` on 1da663a2 or 524cb673. See `h1-1da663a2.txt` and `h1-524cb673.txt`.

## Unit test (L131)

`pnpm --dir ui exec vitest run src/components/app-shell/MainAreaV2.test.tsx`

| Tree | Exit | Assertion |
|---|---|---|
| clean worktree `1da663a2` | **1** | `expect(title.hasAttribute('data-desktop-no-drag')).toBe(true)` → expected `true`, received `false` |
| PR head `524cb673` | **1** | same file, same line, same expected/received |

Transcripts: `unit-1da663a2.txt`, `unit-524cb673.txt`.

## E2E smoke (L237)

`bash apps/desktop/scripts/run-linux-chrome-smoke.sh x11` (xvfb)

| Tree | Exit | Result |
|---|---|---|
| PR head `524cb673` | **1** | `desktop-chrome.smoke.mjs:237` `toHaveAttribute('data-desktop-no-drag', '')` — locator resolved to `<h1 title="Native title review" …>` with **unexpected value "null"** |
| worktree `1da663a2` | **1** | Electron `firstWindow` timed out (30s) in the isolated worktree; the smoke script and `MainAreaV2.tsx` are the same blobs as 524cb673, and the unit test already failed identically on that checkout |

The 524cb673 e2e failure is the same assertion CI reports on Linux DEB x64/arm64. Transcripts: `e2e-524cb673.txt`, `e2e-1da663a2.txt`.
