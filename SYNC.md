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

## 2026-05-16 — Satoshi — Playlist folders / nesting

**Branch:** feat/media-keys-and-stats (unmerged)
**Commits since last entry:** d32cfc4..HEAD

### What changed
- **New data model:** `PlaylistFolder` interface (id, name, parentId) + `folderId` on
  `LocalPlaylist` — persisted to IndexedDB under key `playlist-folders`
- **New store actions:** `createPlaylistFolder`, `renamePlaylistFolder`,
  `deletePlaylistFolder`, `getPlaylistsInFolder`, `getFolders`. `createPlaylist`
  and `updatePlaylist` now accept an optional `folderId`.
- **Sidebar rework — playlists section:**
  - Folders render as collapsible headers with amber accent color + chevron toggle
  - Playlists inside a folder are indented below it
  - "New Folder" button alongside "New Playlist" / "Smart Playlist" buttons
  - Folder context menu: rename, new playlist here, delete (cascade: removes
    folder, moves contained playlists to root, deletes sub-folders)
  - Playlist context menu now includes "Move to folder" options (root + all folders)
  - Smart playlist creation popover also has a folder selector
  - Folder creation inline input (amber border)
  - Supports 1 level of folder nesting (parentId)
- **Extracted `PlaylistItem` component** — used for both root-level and
  folder-contained playlists (reduces duplication)
- **Dynamic import for m3u-parser** in PlaylistItem — Vite auto-splits into
  separate chunk, slightly reduces main bundle

### Why
- The 8+ playlist limit becomes real once smart + regular playlists accumulate
- Folder organization mirrors how users naturally group music (genres, moods, eras)

### Verified
- `pnpm typecheck` passes
- `pnpm build` succeeds (main chunk 731 KB, m3u-parser auto-split to 0.89 KB)

### Pending / Open questions
- [ ] Folders currently support 1 level of nesting (parentId). Could extend to
  deeper nesting with recursive rendering if wanted.

### Off-limits reminder
AGENTS.md §2.1 respected.

---

## 2026-05-16 — Satoshi — Folder Watch / Auto-import

**Branch:** feat/media-keys-and-stats (unmerged)
**Commits since last entry:** eafcc18..HEAD

### What changed
- **New `hooks/use-folder-watch.ts`** — lightweight polling-based folder watch:
  - Enumerates file names from stored folder handles (no metadata parsing — fast)
  - Compares against known track store keys (folderPath/fileName)
  - When new audio files are detected, calls `rescanAll()` to import them
  - Visibility-aware: pauses polling when the tab is hidden
  - Configurable interval (10s–10min, default 60s)
  - Enabled/disabled + interval persisted to localStorage
- **Added Folder Watch UI to Preferences → Sources tab**:
  - Toggle switch to enable/disable
  - Slider for interval (10–600 seconds, shows human-readable label)
  - Last-check timestamp + "Check Now" button
  - All behind the toggle (only shows when enabled)

### Why
- No native File System Observer API available cross-browser
- Polling is the reliable approach: directory enumeration is lightweight
  (just listing names, no file reading) until new files are actually found
- Reuses existing `rescanAll()` for the actual import

### Verified
- `pnpm typecheck` passes (zero TS errors)
- `pnpm build` succeeds

### Pending / Open questions
- [ ] If a folder has thousands of files, the enumeration pass is still fast
  (~ms) since we only read file names, not file contents.

### Off-limits reminder
AGENTS.md §2.1 respected — AudioEngine.tsx, PlaydPlusPanel.tsx, artifact.toml
untouched.

---

## 2026-05-16 — Satoshi — Global Media Keys (MediaSession API) + wiring

**Branch:** feat/media-keys-and-stats (unmerged)
**Commits since last entry:** (new branch, not yet pushed)

### What changed
- **New `lib/media-session.ts`** — centralised MediaSession helper with:
  - `updateMediaSessionMetadata()` — sets metadata + artwork (resolved from IndexedDB) —
    replaces the inline async-artwork logic that was in `use-audio-player.ts`
  - `setMediaSessionPositionState()` — lock-screen progress/elapsed/duration
  - `registerExtraMediaSessionHandlers()` — `stop`, `seekbackward`, `seekforward`
- **Enhanced `use-audio-player.ts`** — calls `updateMediaSessionMetadata()` from
  all track-change code paths: `play`, `togglePlay` (auto-select), `next`, `prev`,
  `_advanceToIndex`. This fixes the old race condition where artwork was set async
  after metadata creation and could resolve on the wrong track.
- **New `hooks/use-media-session.ts`** — complements AudioEngine.tsx (off-limits):
  - 1-second interval calling `setPositionState()` while playing
  - Registers stop/seekbackward/seekforward handlers (AudioEngine does play/pause/next/prev/seekto)
  - Ensures `playbackState` is synced
- **Wired into MainPlayer.tsx**

### Why
- AudioEngine.tsx already had basic MediaSession handlers but was missing:
  - Live lock-screen position updates
  - Artwork that actually follows track changes (was a one-time async fire)
  - stop/seekbackward/seekforward action handlers
  - `setPositionState()` calls
- Since AudioEngine.tsx is off-limits (AGENTS.md §2.1), wrapped the gaps in a hook
  + shared lib

### Verified
- `pnpm typecheck` passes (zero TS errors)
- `pnpm build` succeeds (Vite 7 build, same chunk size ~722 KB)
- Cleaned up dead `resolveArtUrl()` and unused `idb-keyval/get` import from `use-audio-player.ts`

### Pending / Open questions
- [ ] Artwork is resolved async from IndexedDB — on first load (cold cache) there may be
  a ~100ms delay before the lock screen shows the cover. Acceptable for a local PWA.

### Off-limits reminder
AGENTS.md §2.1 respected — `AudioEngine.tsx`, `PlaydPlusPanel.tsx`, `artifact.toml`
untouched. The new `use-media-session.ts` hook and `lib/media-session.ts` lib
complement AudioEngine from outside.

---

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
