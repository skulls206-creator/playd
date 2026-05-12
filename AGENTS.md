# AGENTS.md — Rules for AI assistants working on PLAYD

This file is loaded by AI coding assistants (Claude, Cursor, Copilot, Codex,
local LLMs, etc.) before they edit this repository. **Read it before making
any changes.** If a rule here conflicts with a one-off chat instruction, ask
the user to confirm which wins before proceeding.

---

## 1. What this repo is

PLAYD is a foobar2000-style audio player PWA in a pnpm monorepo. Three
artifacts live under `artifacts/`:

| Artifact | Path | Purpose |
|---|---|---|
| `audio-player` (web) | `artifacts/audio-player` | The PWA frontend (React + Vite). |
| `api-server` (api) | `artifacts/api-server` | Express backend serving `/api/*`. |
| `mockup-sandbox` (design) | `artifacts/mockup-sandbox` | Vite preview server for component mockups. NOT a feature. |

Deployment target is **Replit Autoscale** (`.replit` `deploymentTarget = "autoscale"`).
Do **not** add Vercel, Netlify, Render, Fly, Docker, or other deployment configs
unless the user explicitly asks for them.

---

## 2. Hard scope rules

### 2.1 Off-limits unless the task says otherwise

- `artifacts/audio-player/src/components/player/AudioEngine.tsx`
- `artifacts/audio-player/src/components/playd-plus/PlaydPlusPanel.tsx`
- `.replit`
- `artifact.toml` files (use the artifacts skill if you must)
- Anything under `.local/` other than reading task plans

### 2.2 Always-keep

- The `/api/yt/*` HTTP contract in section 4. Don't change methods, paths, or
  response shapes without explicit approval — the frontend depends on them.
- The Spotify code path stays in Python (`scripts/ytmdl_helper.py`,
  `cmd: "resolve-spotify"`). Do not port it to Node.
- The per-user rate limiter (`ytUserRateLimit`, 20 req/min) and the
  `MAX_PLAYLIST_ITEMS = 200` cap.
- `userId` is a **number** throughout the backend. Don't retype it as `string`.

### 2.3 Don't touch without a task

- Auth (`requireAuth`, JWT, session-scoped stream JWTs).
- Database schema (Drizzle migrations).
- Workflow configs (`pnpm-workspace.yaml`, build scripts).

---

## 3. Source of truth for what to build

The user's chat with the main agent (Replit Agent) drives planning. Active
work plans live in `.local/tasks/*.md`. **Always read the relevant plan file
before implementing.** A plan file's "Note to the code reviewer" section is
non-negotiable — it captures decisions made in chat that aren't visible
elsewhere.

If asked to "do task #N" or "do plan N" without a path, look in
`.local/tasks/` for a file referencing that task.

---

## 4. `/api/yt/*` HTTP contract (FROZEN)

Router is mounted at `/api`. So a route declared as `router.get("/yt/foo")`
serves at **`GET /api/yt/foo`**. Don't add `/api` inside the route paths.

| Method | Path | Auth | Rate-limited | Request | Response (200) | Errors |
|---|---|---|---|---|---|---|
| `GET` | `/api/yt/search?q=&limit=` | yes | yes | query params; `limit` capped at 25 | `{ tracks: [{videoId,title,artist,duration,thumbnail}] }` | 400 missing q · 500 search failed |
| `GET` | `/api/yt/stream/:videoId` | yes | yes | `videoId` matches `/^[\w-]{5,20}$/` | `{ videoId, streamUrl, title, duration, thumbnail }` | 400 invalid videoId · 500 stream failed |
| `POST` | `/api/yt/resolve-url` | yes | yes | `{ url: string }` (auto-detects YouTube vs Spotify by hostname) | `{ tracks: [...] }` (same Track shape) | 400 missing/invalid url · 400 unsupported host · 422 Spotify not configured · 500 |
| `GET` | `/api/yt/history?limit=` | yes | no | query `limit` capped at 200 | `{ history: [...] }` | 500 |
| `DELETE` | `/api/yt/history` | yes | no | none | `{ ok: true }` | 500 |
| `DELETE` | `/api/yt/history/:id` | yes | no | numeric `id` | `{ ok: true, deleted }` | 400 invalid id · 404 not found · 500 |

**Track shape** (used in `tracks: []` everywhere):
```ts
{ videoId: string; title: string; artist: string | null; duration: number | null; thumbnail: string | null }
```

If you need to add a new endpoint, **add it alongside** the existing ones.
Don't rename or split existing ones.

---

## 5. YouTube extraction

YouTube extraction lives in `artifacts/api-server/src/lib/youtube.ts` and uses
**youtubei.js** (not yt-dlp — yt-dlp is dead on cloud IPs due to
SABR/PO-Token requirements).

### Required wiring (don't ship without these)

1. **`bgutils-js` must actually be imported and used.** Adding it to
   `package.json` without calling `BG.PoToken.generate(...)` is the same as
   not having it.
2. **Pass BOTH `po_token` AND `visitor_data` to `Innertube.create()`.** The PO
   token is bound to the identifier/visitor_data used to mint it. Passing only
   `po_token` causes YouTube to return SABR storyboards (the original bug).
3. **BotGuard interpreter needs a DOM.** Running `BG.Challenge.create()`'s
   interpreter script via `new Function(...)()` against raw `globalThis` in
   Node will fail. Use `jsdom` and pass the JSDOM `window` as `globalObj` to
   both `BG.Challenge.create()` and `BG.PoToken.generate()`.
4. **Cache the PO token.** Generation is slow (multiple seconds). Cache for
   ~6–12h, refresh in the background.
5. **Honor `YT_COOKIES_TXT` env.** Replit secrets strip newlines but keep tabs;
   reconstruct line boundaries with the regex pattern in
   `lib/youtube.ts`'s `cookieFromEnv()` and `scripts/ytmdl_helper.py`'s
   `_cookies_file()`. Keep both versions in sync.

### How to verify before claiming "done"

Hit `GET /api/yt/stream/CvYnLqPN4SM` and `GET /api/yt/stream/jSfro6cqmcY`
with a valid JWT. The `streamUrl` field must contain `googlevideo.com` and
the audio must actually play in `<audio src=...>` for ~10 seconds. A 200
response with a storyboard URL or a 30-byte response body is **not** a pass.

---

## 6. Branching & PR workflow

The user runs **multiple AI assistants in parallel** (Replit Agent here +
local AI via GitHub).

- **Default branch:** `master`.
- **Don't push directly to `master`** unless the task explicitly says to.
  Work on a branch named `ai/<short-topic>` (e.g. `ai/fix-cookie-regex`)
  and open a PR.
- **Never force-push.** Never rewrite history on shared branches.
- **Don't merge your own PRs.** The user or the main agent merges after review.
- Before starting a new branch, `git fetch origin && git rebase origin/master`
  to avoid drift.

If your changes touch `lib/youtube.ts`, `routes/yt.ts`, or anything in
section 2.2, expect extra scrutiny on the PR.

---

## 7. Environment

Secrets that exist (DO NOT print, log, or commit values):
- `JWT_SECRET` — required, no fallback.
- `DATABASE_URL` — Postgres.
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` — for Spotify path.
- `YT_COOKIES_TXT` — Netscape cookies.txt content (flattened, see §5.5).
- `TEST_ACCOUNT_PASS` — test user `tester` password.

Don't add `.env.example` files claiming secrets that don't exist. Don't
hard-code fallbacks for any of the above.

---

## 8. Definition of done

A task is done when **all** of these hold:

1. The plan file's "Done looks like" section is satisfied.
2. The frozen API contract in section 4 is unchanged (or the contract change
   was explicitly approved in chat and the plan was updated).
3. `pnpm --filter @workspace/api-server run typecheck` passes.
4. The dev workflow restarts cleanly with no errors in the first 30s of logs.
5. For YouTube changes: the verification in §5 actually plays audio.
6. Off-limits files in §2.1 are unchanged unless the task said so.
7. No unrequested files added (no `vercel.json`, no `Dockerfile`, no rewrites
   of unrelated routes "while you were in there").

If you can't satisfy all of these, stop and ask the user — don't ship
partial work as if it's done.
