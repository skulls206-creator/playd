# Workspace

## Agent Working Principles

### Orchestration vs. Execution
Delegate complex, multi-file, or parallelizable work to subagents. For simple targeted changes (a one-line fix, a single config update), execute directly — spawning a subagent for trivial work adds latency with zero benefit. The job is to think, plan, and coordinate. Know when delegation serves the work and when it just adds ceremony.

### Resourcefulness Before Escalation
Before saying "I don't have access" or "I can't do that" — check every env file, every config, every credential store, read the docs, look at the actual running code. Exhaust every avenue first. Asking the user should be a last resort, not a first reflex.

### Accuracy Over Agreement
Truth takes precedence over social smoothness. If a claim is wrong, outdated, oversimplified, or missing critical context — say so directly. Politeness is fine; flattery and false agreement are not. Agreement is only warranted when supported by evidence, sound reasoning, or established knowledge.

### Never Guess at Config
Read the docs first. Validate before applying. Back up before editing anything destructive. If something breaks, roll it back immediately — don't paper over it.

### Memory is Mandatory
Every time something is learned about how the user works, what they need, or how the system behaves — write it down here immediately. The user should never have to teach the same thing twice. This file is the memory store.

### PLAYD+ Architecture Notes
- Python helper at `scripts/ytmdl_helper.py` — use `--get-url` not `--dump-json` for stream URLs. `--dump-json` returns storyboard thumbnail URLs in the last format entry; `--get-url -f bestaudio[ext=m4a]/bestaudio/best` returns the real HLS/CDN audio URL.
- `best_thumbnail()` helper filters `/sb/` storyboard URLs from yt-dlp thumbnail arrays.
- `yt_search_history` table must be manually created if migrations don't run it. SQL: `CREATE TABLE IF NOT EXISTS yt_search_history (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, query TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`
- Stream URLs are HLS manifests (`manifest.googlevideo.com`) — browsers play these natively, seeking works.
- **YT playback persistence** (`use-audio-player.ts`): `currentYtTrack` and `playdPlusQueue` are persisted to localStorage under keys `playd_plus_current` and `playd_plus_queue`. Mutations in `playYtTrack`, `addToYtQueue`, `setPlaydPlusQueue`, and `clearYtPlayback` all call `savePref` to keep them in sync. Restored on store init via `loadPref`.
- **YT/local hybrid queue** (`addToYtQueue`): appends a YT track to both `playdPlusQueue` and the main playback `queue` (as a fakeTrack). Lets users mix YouTube tracks into their local library queue without switching modes. AudioEngine routes by `currentTrack.source === 'youtube'`.
- **YT source badge**: `<YtSourceBadge>` in `TransportBar.tsx` — shown next to track title in all 3 transport layouts (hero/desktop/mobile) when `currentTrack?.source === 'youtube'`.

### Testing Protocol
Always sign into the test account before testing or reviewing any feature. Credentials are in env secrets `TEST_ACCOUNT_NAME` / `TEST_ACCOUNT_PASS` (username: `tester`). Never screenshot the login page — get past it first, then screenshot the actual feature being tested.

### Show, Don't Describe
After making changes: take a screenshot, run a test, curl an endpoint. Don't describe what you did and ask if it worked — verify it yourself first.

### No Silent Fallbacks
Code should fail explicitly when something goes wrong, not silently degrade to a default state. Silent fallbacks hide bugs and make debugging hell.

### Parallel by Default
When multiple tool calls don't depend on each other's output, batch them into a single response. Serializing independent calls wastes time.

---

## User Preferences & Learned Context

- **Logo history**: Rejected thin bars ("looks like chart"), thick-tube SVG ("ugly"), oval-cup SVG. Accepted AI-generated PNG style (clean 3D purple headphones, Beats/Sony aesthetic). In-app logo is now an inline SVG using `currentColor` to follow the active theme.
- **iOS audio**: Never chain `play()` after `resume()` — `resume()` Promise stays pending in background. Pattern: `ctx.resume().catch(()=>{}); deck.audio.play().catch(()=>{})` — fire-and-forget + immediate. Silent keep-alive MUST be routed through Web Audio graph via a gain-0 node or iOS interrupts the context between tracks.
- **Android Chrome background audio (critical)**: Calling `play()` on an already-playing `HTMLAudioElement` from a React effect (outside a trusted event handler) is treated as a fresh autoplay request. Chrome gives it ~1 second then kills it — this is the "plays 1 second then stops" bug. Fix: guard with `audio.paused` before calling `play()`. All `ctx.resume()` calls must have `.catch(()=>{})`. Explicitly call `silentAudioRef.current?.play()` at every track-transition site inside `ended` event handlers so Chrome never sees a gap in audio focus.
- **Favicons**: SVG favicons eliminate transparent-corner bleed issues and bypass aggressive browser PNG caching. Always prefer SVG for the `<link rel="icon">` with PNG fallback.
- **Subsonic**: All Subsonic API calls are client-side (browser fetches directly from Subsonic server). This bypasses server-side NAT/port issues with home servers on non-standard ports.

---

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `artifacts/audio-player` (`@workspace/audio-player`)

foobar2000-style audio player PWA. Served at `/`.

- Three-panel layout: sidebar (library tree + playlists), queue panel, bottom transport bar
- **Auth**: JWT Bearer auth (bcryptjs hashes, jsonwebtoken signs). Token stored in `localStorage` under `playd_token`. `setAuthTokenGetter` wired in `api-client-react` so all React Query hooks include `Authorization: Bearer` automatically. `useAuth` zustand store handles init/login/register/logout. `AuthGate` in App.tsx blocks the app until auth is verified.
- **Per-user isolation**: every DB table (tracks, playlists, eq_presets, subsonic_servers, queued_tracks) has a nullable `user_id` FK. All API queries filter by `req.userId` (set by `requireAuth` middleware). Users never see each other's data.
- **Local mode**: File System Access API (`window.showDirectoryPicker()`), folder handles persisted in IndexedDB via `idb-keyval`, tags parsed by native TS parsers (ID3v2, FLAC, Vorbis, WAV)
- **Subsonic mode**: ALL Subsonic API calls (test, sync, stream) are client-side — the browser fetches directly from the Subsonic server. The API has a JWT-protected `/api/subsonic-servers/:id/config` endpoint that returns credentials; the browser uses them to build stream URLs and sync the library. This bypasses server-side NAT/port restrictions that blocked home servers on non-standard ports.
- Playback via HTML5 `<audio>` → Web Audio API pipeline: crossGain → 10× BiquadFilterNode (EQ) → ReplayGain GainNode → AnalyserNode → masterGain
- Media Session API for OS media keys, lock screen controls, system transport widget
- Web Notifications API for persistent now-playing notification
- Custom right-click context menu (browser default suppressed app-wide)
- 10-band EQ with 8 built-in presets seeded in DB (per user)
- Smart playlists with query language (evaluated server-side)
- Duplicate detection, tag editing, multi-column sort, keyboard shortcuts
- **ReplayGain normalization**: `src/lib/replaygain-scanner.ts` uses `OfflineAudioContext` to measure RMS dBFS for each local file; gain stored in `tracks.replaygain_gain` (real, nullable); Preferences → Playback → "ReplayGain Normalization" section with scan-library button + per-track progress; `rgGainRef` GainNode in AudioEngine applies `10^(gain/20)` when enabled; `replaygainEnabled` persisted in `localStorage`
- **Clip Studio**: full-screen offline audio editor (right-click any local track → "Edit in Clip Studio")
  - Decodes audio via `AudioContext.decodeAudioData` — no server round-trips
  - Interactive canvas waveform with draggable trim handles (orange)
  - Operations: Trim, Fade In, Fade Out (cosine ramps), Peak Normalize
  - Preview playback with animated playhead (`AudioBufferSourceNode`)
  - Save-back via File System Access API `createWritable()`, or fallback to `showSaveFilePicker()`, or download
  - Revert to original at any time; warns on close with unsaved changes
  - Key files: `src/lib/wav-encoder.ts`, `src/lib/audio-editor.ts`, `src/components/editor/WaveformCanvas.tsx`, `src/components/editor/ClipStudioModal.tsx`
- State managed by Zustand; data fetched via React Query hooks from `@workspace/api-client-react`
- Key packages: zustand, framer-motion, idb-keyval, date-fns, bcryptjs, jsonwebtoken

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.

## PLAYD+ Search & Stream API (`/api/yt/*`)

Search-first music discovery backend. All endpoints are JWT-protected via `requireAuth` (or `requireStreamAuth` for stream).

| Endpoint | Method | Description |
|---|---|---|
| `/api/yt/search?q=` | GET | YouTube search via yt-dlp. Returns title, artist, duration, thumbnail, videoId. Also saves query to search history. |
| `/api/yt/stream/:videoId` | GET | Resolves a direct CDN audio URL for the given YouTube videoId. Accepts JWT via `?token=` param for `<audio>` element use. |
| `/api/yt/resolve-url` | POST | Smart dispatcher: accepts a YouTube playlist URL or Spotify URL (track/playlist/album). YouTube → yt-dlp flat playlist dump. Spotify → Spotify Web API metadata + yt-dlp search to get videoIds. |
| `/api/yt/history` | GET | Returns user's search history (most recent first). |
| `/api/yt/history` | DELETE | Clears all search history for the authenticated user. |
| `/api/yt/history/:id` | DELETE | Removes a specific search history entry (only the owner can delete). |

**Python helper**: `scripts/ytmdl_helper.py` — accepts a JSON command on stdin (`search`, `stream`, `resolve-youtube-playlist`, `resolve-spotify`), returns JSON on stdout. Spawned by Express via `child_process.spawn`. Requires `yt-dlp` (system) and `spotipy` (pip).

**Spotify**: Uses Client Credentials flow via `spotipy`. Requires `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` env secrets. If not set, `/api/yt/resolve-url` returns HTTP 422 with a clear error instead of crashing.

**DB**: `yt_search_history` table (`id`, `user_id`, `query`, `created_at`). Schema in `lib/db/src/schema/yt_search_history.ts`.
