# SYNC.md — Cross-Agent After-Action Report

> **Purpose:** This file is the running handoff log between the Replit agent
> and the other AI builder (working from GitHub directly). Whoever finishes a
> session updates the **Latest entry** at the top. Whoever starts a session
> reads this file first, *after* `AGENTS.md`.
>
> **Rules:**
> - Append new entries at the top (newest first). Do not rewrite history.
> - Keep each entry short: what changed, why, what's pending, open questions.
> - Never commit secrets, tokens, or paths to local keys here.
> - The Replit agent never pushes — the user merges via the Git pane.

---

## How to use this file

Each session, the finishing agent adds one entry using the template below.
The next agent reads the top 1–3 entries to catch up before doing anything.

If an entry's **Pending / Open questions** section has items, the next agent
should address them or explicitly defer them with a reason.

### Entry template

```md
## YYYY-MM-DD — <Agent name> — <short title>

**Branch:** master (or other)
**Commits since last entry:** <hash..hash> or "none"

### What changed
- bullet
- bullet

### Why
- one or two lines of context

### Verified
- e.g. `pnpm build` passes / dev server clean / tested in browser

### Pending / Open questions
- [ ] item the next agent should look at
- [ ] item

### Off-limits reminder
Confirm AGENTS.md §2.1 was respected (AudioEngine.tsx, PlaydPlusPanel.tsx,
artifact.toml untouched) — or list the explicit exception.
```

---

# Entries (newest first)

## 2026-05-14 — AI builder (GitHub) — Implement 10 feature suggestions

**Branch:** master
**Commits since last entry:** none yet (user merges manually)

### What changed
- **Drag-drop queue reorder** (QueuePanel.tsx): HTML5 DnD with visual feedback, context menu improvements
- **Gapless playback toggle** (use-audio-player.ts, PreferencesPanel.tsx): store state + persistence, toggle UI in Playback tab
- **M3U import/export** (lib/m3u-parser.ts, Sidebar.tsx): parse/generate M3U8, export/import per playlist from context menu
- **Virtual scroll perf** (TrackListPanel.tsx): `content-visibility: auto` on row container for native browser virtualization
- **Smart playlists** (track-store.ts, Sidebar.tsx): rules-based (field + operator + value), match all/any, auto-evaluate on create, refresh from context menu
- **Auto-ReplayGain on import** (use-file-system.ts): `scanReplaygain()` called per file during `processTracks`, results attached before `upsertTracks` — no separate scan step needed
- **Keyboard shortcut customization** (use-keyboard-shortcuts.ts, PreferencesPanel.tsx): full shortcut map stored in localStorage, click-to-record UI, per-shortcut key capture, reset-to-defaults
- **Waveform click-to-seek** (WaveformCanvas.tsx, ClipStudioModal.tsx): `onSeek` prop, click during playback repositions playhead and restarts preview at clicked time
- **Deploy workflow fix**: set `node-version: 20` (was 24, mismatched local)

### Verified
- `pnpm typecheck` passes (no TS errors)
- `pnpm build` succeeds (Vite 7, 6.47s, 2273 modules)

### Pending / Open questions
- [ ] The `playd.khurk.xyz` site loads fine (verified). If the raw `skulls206-creator.github.io/playd` URL shows "no site here" it's because the custom domain redirects — GitHub Pages is active.
- [ ] Pnpm 9 preinstall script (`sh -c ...`) fails on Windows — non-blocking for pnpm workspace installs.
- [ ] Consider reducing chunk size with code-splitting (Vite warned about 720 KB main chunk).

### Off-limits reminder
AGENTS.md §2.1 respected — `AudioEngine.tsx`, `PlaydPlusPanel.tsx`, `artifact.toml` untouched. Gapless playback added at store/UI level only (AudioEngine is off-limits, so the actual crossfade logic remains in the existing `crossfadeSec` flow).

---

## 2026-05-14 — Replit agent — Fix CI lockfile (pnpm 9 vs 10 mismatch)

**Branch:** master
**Commits since last entry:** b5ed405, a167ca3 (SYNC.md introduction)

### What changed
- Regenerated `pnpm-lock.yaml` with pnpm 9 (CI version).
- Hardened `scripts/post-merge.sh` to auto-install `pnpm@9` if a newer
  pnpm is detected, so future merges don't silently rewrite the lockfile
  in a CI-incompatible way.

### Why
- GitHub Actions deploy (`.github/workflows/deploy-pages.yml`) pins
  `pnpm/action-setup@v4` to version 9 and runs frozen install. The local
  environment had pnpm 10.26.1, and the previous post-merge `pnpm install`
  rewrote the lockfile with pnpm 10's overrides format. pnpm 9 in CI
  rejected it with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.

### Verified
- `pnpm --version` → 9.15.9 locally.
- `cd artifacts/audio-player && pnpm install --frozen-lockfile` passes
  (this is what CI runs).
- Dev server (`Start application`) still running.

### Pending / Open questions
- [ ] Other AI builder: please use pnpm 9 for any local installs. If you
      see pnpm 10/11 install prompts, decline and `npm i -g pnpm@9` first.

### Off-limits reminder
AGENTS.md §2.1 respected — `AudioEngine.tsx`, `PlaydPlusPanel.tsx`,
`artifact.toml` untouched.

---

## 2026-05-14 — Replit agent — Introduced SYNC.md handoff log

**Branch:** master
**Commits since last entry:** n/a (first entry)

### What changed
- Added `SYNC.md` (this file) as the running AAR / handoff log between agents.
- No application code touched.

### Why
- User asked for an AAR-style sync mechanism so the Replit agent and the
  other AI builder can stay coordinated across sessions without stepping on
  each other.

### Verified
- File-only change; no build or runtime impact.
- Dev server (`Start application` workflow) still serving `/playd/` cleanly.

### Pending / Open questions
- [ ] Other AI builder: please add your next entry on top when you finish a
      session on GitHub, even if it's a one-liner. That's the whole contract.
- [ ] If you'd like a stricter schema (e.g. JSON frontmatter, labels), say so
      in your next entry and the Replit agent will adapt.

### Off-limits reminder
AGENTS.md §2.1 respected — `AudioEngine.tsx`, `PlaydPlusPanel.tsx`, and
`artifact.toml` were not modified.

### Repo state confirmations (post code review)
- `origin/master` tip: `3d47630` (`fix: add missing SpectrumBar import...`).
- Local `master` is ahead only by Replit auto-checkpoint commits; no
  application code diverges from upstream. User pushes via Git pane.
- Upstream `artifacts/` contains **only** `audio-player/`. The previously
  configured `api-server` and `mockup-sandbox` workflows are intentionally
  N/A — those packages were removed upstream. `.replit` correctly defines
  only the `Start application` workflow for `audio-player`.
- `pnpm-lock.yaml` platform-pruning overrides (~20 entries set to `'-'`)
  come from upstream and are expected; they do not need local fixes.

---

## Prior context (pre-SYNC.md, summarized)

- **Task #30/#31:** Workspace hard-reset to `origin/master`. Stale dirs removed
  (`artifacts/api-server`, `artifacts/mockup-sandbox`, `attached_assets`). App
  is now fully client-side.
- **Post-merge hook:** `scripts/post-merge.sh` runs `pnpm install` on merge;
  wired into `.replit` with a 120s timeout.
- **Toolchain pinned:** pnpm 9 (not 11). Node 20+. Build output at
  `artifacts/audio-player/dist/public/`.
- **YouTube metadata:** client-side `oembed` fetch only — no proxy, no API
  server.
