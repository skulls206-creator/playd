# Overview

This is a pnpm workspace monorepo using TypeScript, designed to build a foobar2000-style audio player PWA. The project aims to provide a robust and feature-rich platform for music playback and discovery, supporting both local files and integration with services like YouTube and Subsonic. It includes a dedicated API server, a database layer with Drizzle ORM, and various utility scripts. The core vision is to offer a highly customizable and performant audio experience, with a focus on user data isolation and advanced features like ReplayGain normalization, a client-side audio editor, and smart playlists.

# User Preferences

### Agent Working Principles

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

### Testing Protocol
Always sign into the test account before testing or reviewing any feature. Credentials are in env secrets `TEST_ACCOUNT_NAME` / `TEST_ACCOUNT_PASS` (username: `tester`). Never screenshot the login page — get past it first, then screenshot the actual feature being tested.

### Show, Don't Describe
After making changes: take a screenshot, run a test, curl an endpoint. Don't describe what you did and ask if it worked — verify it yourself first.

### No Silent Fallbacks
Code should fail explicitly when something goes wrong, not silently degrade to a default state. Silent fallbacks hide bugs and make debugging hell.

### Parallel by Default
When multiple tool calls don't depend on each other's output, batch them into a single response. Serializing independent calls wastes time.

# System Architecture

The project is a pnpm workspace monorepo built with Node.js 24 and TypeScript 5.9.

**Core Technologies:**
- **API Framework**: Express 5
- **Database**: PostgreSQL with Drizzle ORM
- **Validation**: Zod
- **API Codegen**: Orval (from OpenAPI spec)
- **Build Tool**: esbuild

**Monorepo Structure:**
- `artifacts/`: Deployable applications (e.g., `api-server`, `audio-player` PWA)
- `lib/`: Shared libraries (e.g., `api-spec`, `api-client-react`, `api-zod`, `db`)
- `scripts/`: Utility scripts

**TypeScript Configuration:**
- All packages extend `tsconfig.base.json` with `composite: true`.
- Root `tsconfig.json` lists all packages as project references for correct cross-package typechecking and build ordering.
- `emitDeclarationOnly` is used; actual JS bundling is handled by esbuild.

**Key Applications & Libraries:**

- **`api-server`**: Express 5 API server handling routes, CORS, JSON parsing, and authentication. It uses `@workspace/db` for persistence and `@workspace/api-zod` for validation.
- **`db`**: Database layer with Drizzle ORM for PostgreSQL. Manages schema definitions and exports a Drizzle client instance.
- **`api-spec`**: Contains the OpenAPI 3.1 specification (`openapi.yaml`) and Orval configuration for generating API clients and Zod schemas.
- **`api-zod`**: Generated Zod schemas from the OpenAPI spec, used for request/response validation.
- **`api-client-react`**: Generated React Query hooks and fetch client from the OpenAPI spec.
- **`audio-player`**: A PWA with a three-panel layout (sidebar, queue, transport bar).
    - **Authentication**: JWT Bearer auth with tokens stored in `localStorage`. Features per-user data isolation.
    - **Local Mode**: Utilizes File System Access API for local file playback and tag parsing.
    - **Subsonic Mode**: All Subsonic API calls are client-side to bypass server-side NAT/port issues.
    - **Audio Playback**: HTML5 `<audio>` element piped through Web Audio API (crossGain, 10-band EQ, ReplayGain, AnalyserNode, masterGain).
    - **Media Integration**: Supports Media Session API for OS controls and Web Notifications for persistent now-playing status.
    - **Advanced Features**: 10-band EQ, smart playlists, duplicate detection, tag editing, keyboard shortcuts, ReplayGain normalization (with `OfflineAudioContext` scanning).
    - **Clip Studio**: A full-screen, client-side audio editor for local tracks, offering trim, fade, and normalize operations with waveform visualization and `AudioContext.decodeAudioData`.
    - **State Management**: Zustand for application state; React Query for data fetching.

**PLAYD+ Search & Stream API (`/api/yt/*`):**
- JWT-protected endpoints for YouTube music discovery.
- **`yt/search`**: YouTube search via `yt-dlp`, saves queries to history.
- **`yt/stream/:videoId`**: Resolves direct CDN audio URLs for YouTube videos.
- **`yt/resolve-url`**: Smart dispatcher for YouTube playlist URLs or Spotify URLs (track/playlist/album) to retrieve metadata and video IDs.
- **`yt/history`**: Manages user search history.
- **Python helper**: `scripts/ytmdl_helper.py` (spawned via `child_process.spawn`) handles `yt-dlp` and `spotipy` interactions.

**UI/UX Decisions:**
- **Logo**: AI-generated PNG style (clean 3D purple headphones), in-app logo uses inline SVG with `currentColor`.
- **Favicons**: SVG favicons are preferred to eliminate transparent-corner bleed and caching issues.
- **Custom right-click context menu**: Browser default suppressed app-wide.

**PLAYD+ Architecture Notes:**
- Python helper uses `--get-url` for stream URLs, filtering storyboard thumbnails.
- YT playback persistence: `currentYtTrack` and `playdPlusQueue` are stored in `localStorage`.
- YT/local hybrid queue: allows mixing YouTube tracks into the local library queue.
- YT source badge: `<YtSourceBadge>` indicates YouTube tracks in the transport bar.
- iOS audio: `ctx.resume().catch(()=>{}); deck.audio.play().catch(()=>{})` pattern for playback. Silent keep-alive through Web Audio gain-0 node.
- Android Chrome background audio: Guard `play()` with `audio.paused` and explicitly call `silentAudioRef.current?.play()` at track transitions to maintain audio focus.

# External Dependencies

- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **API Codegen**: Orval
- **YouTube Integration**: `yt-dlp` (system-wide dependency)
- **Spotify Integration**: `spotipy` (Python library), Spotify Web API (Client Credentials flow)
- **Web APIs**: File System Access API, IndexedDB, Media Session API, Web Notifications API, Web Audio API
- **UI/Animation**: `framer-motion`
- **Utility Libraries**: `idb-keyval`, `date-fns`, `bcryptjs`, `jsonwebtoken`
- **Zustand** for state management
- **React Query** for data fetching