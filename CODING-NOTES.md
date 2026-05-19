# CODING-NOTES — playd

## What This Project Is
A foobar2000-style audio player PWA — local music, 10-band EQ, smart playlists, OS media controls.

## Tech Stack
- pnpm monorepo
- React 19 + Vite + Tailwind v4
- Electron (desktop build)
- TypeScript (strict: true)

## Structure
```
/
├── artifacts/
│   └── audio-player/    # Main app (React + Vite + Tailwind)
└── package.json
```

## Build & Dev
- **Install:** `pnpm install`
- **Build:** `pnpm run build`
- **Typecheck:** `pnpm run typecheck`
- **Dev:** `cd artifacts/audio-player && pnpm run dev` (port 5173)
- **Start:** `pnpm start` (alias for dev server)

## Deploy
- GitHub Pages (web) via `.github/workflows/deploy-pages.yml`
- Electron builds via `.github/workflows/build-electron.yml`
- Electron: cross-platform builds for macOS/Windows/Linux, auto-releases via GitHub Releases

## TypeScript
- strict: true
- Uses project references (tsc --build)

## Tests & Lint
- None configured

## Known Gotchas
- pnpm required
- Electron and web builds are separate — changes to web app may not affect Electron build config
- Media API access requires HTTPS (or localhost). Deployment on GitHub Pages is HTTPS.
- OS Media Controls API requires secure context.

## Previous Bugs / Regressions
*(Fill in as they happen)*
