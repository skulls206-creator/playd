# AGENTS.md — Rules for AI assistants working on PLAYD

This file is loaded by AI coding assistants (Claude, Cursor, Copilot, Codex,
local LLMs, etc.) before they edit this repository. **Read it before making
any changes.** If a rule here conflicts with a one-off chat instruction, ask
the user to confirm which wins before proceeding.

**Also read `SYNC.md`** (top 1–3 entries) before starting a session — it is
the running handoff log between agents. When you finish a session, prepend a
new entry to `SYNC.md` using the template in that file.

---

## 1. What this repo is

PLAYD is a foobar2000-style audio player PWA. The main application lives at
`artifacts/audio-player/` — a React + Vite + TypeScript single-page application.

- **Package manager:** pnpm 9 (not latest/11 — `pnpm 11` fails on resolution).
- **Build output:** `artifacts/audio-player/dist/public/`
- **Deployment:** GitHub Pages (custom domain `playd.khurk.xyz`, served from
  `gh-pages` branch root). Build & publish handled by
  `.github/workflows/deploy-pages.yml` (peaceiris/actions-gh-pages), triggered
  on push to `master` or `ai-fixes`. No Vercel, Netlify, or Docker config.

No API server, no mockup sandbox — the app is fully client-side.

---

## 2. Hard scope rules

### 2.1 Off-limits unless the task says otherwise

- `artifacts/audio-player/src/components/player/AudioEngine.tsx`
- `artifacts/audio-player/src/components/playd-plus/PlaydPlusPanel.tsx`
- `artifact.toml` files

### 2.2 Always-keep

YouTube metadata fetching is done client-side via the YouTube
Iframe API or a direct fetch to `https://www.youtube.com/oembed`.

---

## 3. Toolchain

| Tool | Version / Command |
|---|---|
| Node.js | 20+ |
| pnpm | 9 (`npm install -g pnpm@9` if not found) |
| Build | `cd artifacts/audio-player && pnpm build` |
| Dev server | `cd artifacts/audio-player && pnpm dev` |
| Preview | `cd artifacts/audio-player && pnpm preview` |

**Do not** use `npm` or `yarn` — the project uses `pnpm`.

---

## 4. Architecture

### Frontend stack

- **React 19** + TypeScript
- **Vite** as bundler
- **Tailwind CSS** (v4, via `@tailwindcss/vite`)
- **Zustand** for state management
- **Wouter** for client-side routing
- **idb-keyval** for IndexedDB persistence
- **shadcn/ui** components (under `src/components/ui/`)

### Audio engine

- **Web Audio API** (`AudioContext`, `GainNode`, `BiquadFilterNode` for EQ)
- Two-deck crossfade system with overlapping transitions
- Audio files are served from the user's local file system via
  `URL.createObjectURL()` — there is no server-side media storage

### PWA

- Service worker at `public/sw.js`
- `beforeinstallprompt` handled via `usePwaInstall` hook (in `Sidebar.tsx`)
- Manifest at `public/manifest.json`
- Periodic background sync for library refresh

---

## 5. Build & release

- **Version is automatic.** `__PLAYD_VERSION__` is injected at build time by Vite
  `define` from `git describe --tags --always`. Every deploy automatically gets
  a version string (e.g. `v1.0.0-5-g738dc72`). No manual version bumps needed.
- The version displays in **Preferences → About** tab.
- To trigger a new Electron release: `git tag v1.1.0 && git push --tags`
- To trigger a PWA deploy: push to `master` or `ai-fixes`
- The deploy workflow copies `index.html` as `404.html` for SPA routing.

## 6. Known issues / gotchas

- Must use `git@github.com-playd` remote alias for SSH push (key at `~/.ssh/playd_key`).
- Root `tsconfig.json` may reference non-existent paths from the old monorepo.
- CUSTOM `deploy-pages.yml` may still fail on build — the **built-in**
  `pages-build-deployment` workflow is the reliable path.
