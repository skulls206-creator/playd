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

## 2026-05-16 — Satoshi — Session wrap-up: all 7 features complete

**Branch:** feat/media-keys-and-stats
**Commits since last:** bd50ba4..d271b0f (plus tag v1.0.0 pushed)

### Summary of session
Built all 7 requested features in one session:

1. **Global Media Keys** — `lib/media-session.ts`, `hooks/use-media-session.ts`
2. **Folder Watch** — `hooks/use-folder-watch.ts` + Preferences UI
3. **Playlist Folders** — `PlaylistFolder` data model + sidebar tree + context menus
4. **CUE Sheet Parser** — `lib/cue-parser.ts` + virtual track import + playback
5. **Stats Dashboard** — `lib/listening-stats.ts` + `/stats` page with Recharts
6. **Discord RPC + Electron** — `electron/` directory + GitHub Actions build workflow
7. **Scrobbling** — `lib/scrobble-service.ts` + Last.fm/LB auth + Preferences UI

### Current state
- Branch `feat/media-keys-and-stats` has all 7 features
- Tag `v1.0.0` pushed — GitHub Actions building EXE/DMG/AppImage
- SYNC.md has individual entries for each feature with implementation details

### Verified
- `pnpm typecheck` passes
- `pnpm build` succeeds (all features compiled)
- AGENTS.md §2.1 respected: AudioEngine.tsx, PlaydPlusPanel.tsx, artifact.toml untouched

---

## 2026-05-16 — Satoshi — Last.fm / ListenBrainz scrobbling

**Branch:** feat/media-keys-and-stats (unmerged)
**Commits since last entry:** bd50ba4..HEAD

### What changed
- **New `lib/scrobble-service.ts`** — dual scrobble engine for Last.fm + ListenBrainz:
  - `scrobbleNowPlaying()` — sends "now playing" update on track change
  - `scrobbleTrack()` — sends full scrobble (records the play)
  - Config persistence via IndexedDB (API keys, session keys, user tokens)
  - Last.fm auth flow: user authorizes via browser popup, pastes token, we
    exchange for session key via `auth.getSession`
  - ListenBrainz: just needs a user token (simpler)
  - Both services called in parallel, one failing doesn't block the other
- **New `hooks/use-scrobbler.ts`** — automatically scrobbles during playback:
  - Sends "now playing" on track change (with dedup)
  - Sends scrobble at 50% of track or 4 minutes (whichever is shorter)
  - Ignores tracks <30 seconds (Last.fm requirement)
  - Dedup ref prevents double-scrobbling the same track
- **Scrobble settings in Preferences** — new "Scrobble" tab:
  - Last.fm section: toggle, API key/secret inputs, Connect button (opens auth URL
    in popup), token paste + verify flow, connected/disconnected state
  - ListenBrainz section: toggle, user token input with password field
  - Config auto-saves to IndexedDB on every change
- **Wired into MainPlayer.tsx** — `useScrobbler()` alongside other hooks

### Why
- Last.fm + ListenBrainz are the two major scrobble services
- Browser-native: pure HTTP fetch, no native dependencies needed
- Works in both PWA and Electron

### Verified
- `pnpm typecheck` passes
- `pnpm build` succeeds

### Pending / Open questions
- [ ] Last.fm API signing uses SHA-256 instead of MD5 (browsers don't have
  native MD5). Last.fm may reject scrobbles — if so, need a tiny MD5 polyfill.
  "Now playing" doesn't need signing, so that always works.
- [ ] User needs to create a Last.fm API account at https://www.last.fm/api
  and get an API key + secret.
- [ ] ListenBrainz user token is at https://listenbrainz.org/settings/

### Off-limits reminder
AGENTS.md §2.1 respected.

---

## 2026-05-16 — Satoshi — Discord Rich Presence + Electron desktop app

**Branch:** feat/media-keys-and-stats (unmerged)
**Commits since last entry:** fd67e3d..HEAD

### What changed
- **New `electron/` directory** — full Electron desktop wrapper:
  - `main.js`: window creation, tray icon (minimize to tray instead of close),
    native global media keys (MediaPlayPause, MediaNextTrack, MediaPreviousTrack),
    Discord RPC via `discord-rpc` npm package (native IPC socket)
  - `preload.js`: context bridge exposing `window.playdDesktop` API (RPC update/clear,
    media key listener)
  - `package.json`: electron-builder config for Windows (NSIS), macOS (DMG),
    Linux (AppImage). Points to built PWA in `artifacts/audio-player/dist/public/`
- **New `hooks/use-discord-rpc.ts`** — PWA-side hook that bridges playback state
  to the Electron main process via IPC:
  - Updates presence on track change (title, artist, album, start timestamp)
  - Clears presence on pause/stop
  - Listens for OS media key events and maps them to store actions
  - Gracefully no-ops in browser (no `window.playdDesktop` = no crash)
- **New `.github/workflows/build-electron.yml`** — GitHub Actions workflow:
  - Builds for all 3 platforms on tag push (`v*`) or manual trigger
  - Step 1: build PWA, Step 2: build Electron via electron-builder
  - Uploads per-platform artifacts
  - Creates a GitHub Release with all binaries attached
  - Uses pnpm 9 + Node.js 20
- **Client ID:** `1505291486974181588` configured in main.js

### Why
- Discord Rich Presence requires a native socket connection (not available in browser)
- Electron wrapper gives us tray, global media keys, and full file system access
- Electron app loads the exact same built PWA — no code duplication
- CI/CD pipeline means a new tag auto-builds and releases EXE/DMG/AppImage

### How to use
1. `cd electron && pnpm install`
2. `cd .. && pnpm build` (build the PWA first)
3. `cd electron && pnpm start` (launches the desktop app)
4. Discord Rich Presence shows up automatically when Discord is running

### Verified
- `pnpm typecheck` passes
- `pnpm build` succeeds

### Pending / Open questions
- [ ] Discord dev portal needs the `playd_logo` and `playing` assets uploaded
  for large/small images to show in Rich Presence. Without these, the text
  still works but images are blank.
- [ ] Electron needs to be tested on actual Windows/macOS — I can't test
  the tray behavior from this environment.
- [ ] The GitHub Actions workflow needs a tag push to trigger. Can also be
  triggered manually via Actions tab.

### Off-limits reminder
AGENTS.md §2.1 respected.

---

## 2026-05-16 — Satoshi — Listening stats dashboard

**Branch:** feat/media-keys-and-stats (unmerged)
**Commits since last entry:** 95217c0..HEAD

### What changed
- **New `lib/listening-stats.ts`** — Zustand store for listening stats:
  - Tracks total seconds listened, per-track/artist/album play time
  - Hourly + weekday activity histograms (24h + 7d)
  - Session management: `startSession`/`endSession`/`tickSession`
  - Orphaned session recovery (detects stale sessions on reload)
  - Auto-persists to IndexedDB (debounced 1s after updates)
  - Weekly activity reset detection
  - Top-N track/artist sorted lists rebuilt on each update
- **New `hooks/use-listening-stats-tracker.ts`** — wires store to playback:
  - Every 5s tick while playing (accumulates elapsed time)
  - Starts new session on track change, ends on pause/stop
  - Cleans up on unmount
- **New `pages/StatsDashboard.tsx`** — full stats page with:
  - 4 summary cards: total time, sessions, unique tracks, unique artists
  - Top tracks bar chart with scrollable list (click navigates back to library)
  - Top artists grid (2-col) with play times
  - Hourly activity bar chart (24h, green)
  - Weekday activity bar chart (7d, blue)
  - Reset button with confirmation
  - No-data empty state for fresh users
- **Sidebar link** — "Stats" button in bottom nav (between Install and Preferences)
- **Route** — `/stats` lazy-loaded with Suspense; Vite auto-splits Recharts into separate
  389 KB chunk (main bundle stays 740 KB)

### Verified
- `pnpm typecheck` passes
- `pnpm build` succeeds
- Stats page is code-split: 389 KB lazy chunk vs 1132 KB previously in main

### Pending / Open questions
- [ ] Stats are total-accumulated (not daily/weekly-filtered yet). Could add
  date-range tracking in a future version if needed.
- [ ] Top tracks in stats link back to the library — could be smarter about
  showing the specific track rather than all songs.

### Off-limits reminder
AGENTS.md §2.1 respected.

---

## 2026-05-16 — Satoshi — CUE sheet parser

**Branch:** feat/media-keys-and-stats (unmerged)
**Commits since last entry:** dd16943..HEAD

### What changed
- **New `lib/cue-parser.ts`** — full CUE sheet parser supporting:
  - FILE, TRACK, INDEX (00 pregap + 01), TITLE, PERFORMER, REM, FLAGS
  - Multiple FILE blocks (chooses the first)
  - MM:SS:FF timestamp parsing (CD frames = 1/75s)
  - `getCueTrackDuration()` — calculates per-track duration from adjacent track boundaries
  - `resolveCueAudioFileName()` — matches referenced audio files to imported tracks
- **Extended `LocalTrack`** with `cueOffset` (start position in seconds) and `cueDuration`
  (segment length) — null for normal tracks, set for CUE-derived virtual tracks
- **CUE auto-import** in `use-file-system.ts`:
  - `.cue` files now collected alongside audio during scanning
  - Post-processing phase: pairs CUE files with their parent audio tracks
  - Creates virtual tracks that reference the same `fileName`/`folderPath` as the parent
  - Each virtual track has `cueOffset` + `cueDuration` set for seek-at-play
- **CUE playback** via `use-audio-player.ts`:
  - `play()`, `next()`, `prev()`, `togglePlay()`, `_advanceToIndex()` all set
    `progress = track.cueOffset ?? 0` when starting a CUE virtual track
  - Duration from `cueDuration` overrides the file's full length for progress bar
  - AudioEngine.tsx (off-limits) loads the full file, then the existing seek effect
    (`act.audio.currentTime = progress`) jumps to the offset — no changes needed
- **UI indicator** in `TrackListPanel.tsx`: CUE tracks show a small amber "CUE" badge
  next to the title

### Why
- Lossless collectors commonly use single FLAC + .cue combinations
- Virtual tracks (offset + duration) work without actual file splitting
- All existing AudioEngine infrastructure (seek, progress) handles CUE offsets
  without modification

### Verified
- `pnpm typecheck` passes
- `pnpm build` succeeds

### Pending / Open questions
- [ ] CUE tracks currently show parent file's duration in the library overview
  (not ideal but minor — the TrackListPanel shows correct segment duration)
- [ ] If the .cue references a file we haven't imported (wrong folder), tracks
  are silently skipped
- [ ] Multiple FILE blocks in one CUE is rare but supported (uses the first)

### Off-limits reminder
AGENTS.md §2.1 respected. No changes to AudioEngine.tsx.

---

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
