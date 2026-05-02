# Threat Model

## Project Overview

PLAYD is a pnpm workspace monorepo for a foobar2000-style audio player PWA. The production system includes an Express 5 TypeScript API server, a React/Vite audio-player frontend, PostgreSQL accessed through Drizzle ORM, Cloudflare R2-compatible object storage for encrypted vault uploads, and a Python helper invoked by the API server for YouTube and Spotify resolution. Users authenticate with username/password and JWT bearer tokens; the frontend stores tokens in `localStorage` and uses them for API calls.

The mockup sandbox is development-only and should be ignored for production security findings unless it is proven reachable in a production deployment. The backend Subsonic route file currently exists in source but is not mounted by `artifacts/api-server/src/routes/index.ts`, so Subsonic-only server findings should be treated as out of production scope until that router is mounted. In production, assume `NODE_ENV=production`, platform TLS is provided, and Replit handles certificate renewal.

## Assets

- **User accounts and sessions** -- usernames, optional email addresses, password hashes, JWT signing secrets, and bearer tokens. Compromise allows account impersonation and access to each user's music metadata and vault records.
- **User music metadata** -- tracks, playlists, queue state, EQ presets, YouTube search history, and vault track metadata. These must remain isolated per authenticated user.
- **Vault content and keys** -- encrypted audio blobs in R2 plus per-track encrypted keys, IVs, blob sizes, object paths, and per-user key salts. The server should only handle ciphertext and authorization metadata; plaintext audio and vault master keys should stay client-side.
- **Third-party credentials and tokens** -- JWT secret, database URL, R2 credentials, Spotify client credentials, and any future user-provided media-service credentials. Leakage enables account forgery, storage abuse, or access to external services.
- **Server compute and network access** -- authenticated endpoints can spawn Python/yt-dlp processes and make server-side outbound HTTP requests. These must not be usable for resource exhaustion or internal network probing.

## Trust Boundaries

- **Browser to API** -- all `/api/*` requests cross from untrusted clients to the Express server. Protected endpoints must validate JWTs and scope all reads and writes to `req.userId`.
- **API to PostgreSQL** -- route handlers use Drizzle ORM for persistence. Queries must remain parameterized, and all user-owned tables must be filtered by authenticated user.
- **API to R2 object storage** -- vault upload URL generation and authenticated download streaming cross into object storage. Object keys, upload size, content type, and download authorization must be constrained by server-side ownership checks.
- **API to external music services** -- YouTube and Spotify integration code spawns helper processes. User-controlled URLs and search terms must be validated and bounded. Server-side Subsonic routes are currently unmounted and out of production scope until mounted.
- **Public to authenticated boundary** -- health, login, and registration are public; tracks, playlists, queue, EQ presets, vault, and YouTube/Spotify operations are authenticated.
- **Client local storage/session storage boundary** -- JWTs are persisted in `localStorage`, and vault master keys are temporarily persisted as extractable JWKs in `sessionStorage`. Any XSS would convert directly into account and vault compromise.
- **Development to production boundary** -- `artifacts/mockup-sandbox`, unmounted server route files, attached assets, generated cache files, and development-only Vite plugins are not production scan targets unless deployment configuration proves they are shipped.

## Scan Anchors

- Production API entry points: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, and mounted routers in `artifacts/api-server/src/routes/index.ts`.
- Authentication: `artifacts/api-server/src/middlewares/auth.ts`, `artifacts/api-server/src/routes/auth.ts`, and `artifacts/audio-player/src/hooks/use-auth.ts`.
- Highest-risk mounted server integrations: `artifacts/api-server/src/routes/yt.ts`, `scripts/ytmdl_helper.py`, `artifacts/api-server/src/routes/vault.ts`, and `artifacts/api-server/src/lib/r2.ts`.
- User data isolation: `artifacts/api-server/src/routes/tracks.ts`, `playlists.ts`, `queue.ts`, `eq_presets.ts`, `vault.ts`, `yt.ts`, and Drizzle schemas under `lib/db/src/schema`.
- Client-side vault crypto: `artifacts/audio-player/src/hooks/use-vault-crypto.ts`, `artifacts/audio-player/src/components/vault/VaultUnlockModal.tsx`, and upload/download call sites.
- Dev-only or not currently production-mounted areas normally excluded: `artifacts/mockup-sandbox`, `artifacts/api-server/src/routes/subsonic.ts` unless mounted, local cache/build artifacts, `node_modules`, and attached assets.

## Threat Categories

### Spoofing

JWT bearer tokens identify users across API requests. The API must use a strong production-only signing secret, must not commit live secrets to repository or Replit config files, and must reject startup when required production secrets are missing. Login and registration endpoints should resist brute force and account enumeration.

### Tampering

The client is untrusted and can send arbitrary track, playlist, queue, YouTube, and vault metadata. API routes must validate request bodies with generated Zod schemas where available, ignore client-supplied user ownership fields, and ensure all updates and deletes are scoped to the authenticated user.

### Information Disclosure

API responses must not expose another user's tracks, playlists, vault object paths, search history, or account data. Error messages and logs must not expose passwords, JWTs, R2 credentials, Spotify secrets, or URL query tokens. Vault downloads must stream only after ownership checks.

### Denial of Service

Public authentication endpoints, helper-process endpoints, and vault upload URL generation can consume CPU, network, storage, or external service quota. The application needs rate limits, request size limits, process timeouts, bounded playlist work, and server-side storage size controls.

### Elevation of Privilege

A flaw in JWT signing, authorization filters, playlist/queue ownership checks, object-key handling, or helper controls could let a user impersonate others, access other users' data, or abuse the API server's privileges. All database operations and external work must enforce user ownership and minimize server privileges.
