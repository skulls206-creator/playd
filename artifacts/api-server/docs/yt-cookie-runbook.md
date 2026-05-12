# Runbook: Refresh `YT_COOKIES_TXT`

YouTube playback in PLAY+ depends on a logged-in cookie jar pasted into
the `YT_COOKIES_TXT` Replit secret. Google rotates the short-lived
`__Secure-1PSIDTS` / `__Secure-3PSIDTS` cookies roughly every 1–4 weeks.
When SIDTS expires, every `GET /api/yt/stream/*` call fails with a 500
until the secret is rotated.

The API server now monitors cookie health automatically. This document is
the human side of that loop: how to detect expiry early and how to mint a
fresh jar when the monitor warns.

## How the warnings show up

The server boot calls `startCookieMonitor()` from `lib/yt-cookies.ts`,
which evaluates the jar every 6 hours and emits a structured pino log
with `event: "yt_cookie_health"`. Severities:

| Severity     | Trigger                                                    | Log level |
|--------------|------------------------------------------------------------|-----------|
| `ok`         | All login + rotating cookies present, expiry > 7 days      | `info`    |
| `warn`       | Earliest rotating cookie expires within 7 days             | `warn`    |
| `critical`   | Earliest rotating cookie expires within 48 hours           | `error`   |
| `expired`    | Any login or rotating cookie expiry is in the past         | `error`   |
| `logged_out` | Login cookies missing OR Innertube `session.logged_in=false` | `error` |
| `missing`    | `YT_COOKIES_TXT` secret is unset                           | `error`   |

You can also fetch the current snapshot from any authed client:

```http
GET /api/yt/cookie-status            # cached, returned by background monitor
GET /api/yt/cookie-status?refresh=1  # force a fresh evaluation
```

The endpoint returns 200 for `ok` / `warn` and 503 for `critical` /
`expired` / `logged_out` / `missing`, so it can be wired into any
external uptime checker (UptimeRobot, BetterStack, etc.) — point it at
the URL and alert on any non-200 response.

## How to mint a fresh cookie jar

1. Open Chrome (or Brave / Edge) on a personal device, in a normal
   profile that is signed into the YouTube account PLAY+ should appear
   as.
2. Visit <https://www.youtube.com/> and confirm the avatar in the top
   right shows your account (i.e. you really are logged in).
3. Install the **Get cookies.txt LOCALLY** extension (chromewebstore.google.com).
   It is open-source and runs entirely client-side — it does not upload
   cookies anywhere.
4. With <https://www.youtube.com/> in the active tab, click the
   extension icon → **Export As → Netscape**. You should get a file
   starting with `# Netscape HTTP Cookie File`.
5. Open the file and verify it contains all of these names (the monitor
   checks for them by name):
   - `SAPISID`, `__Secure-3PAPISID`, `__Secure-3PSID`, `SID`, `LOGIN_INFO`
   - `__Secure-1PSIDTS`, `__Secure-3PSIDTS`
   If any are missing, you exported from a logged-out tab — repeat from
   step 2.
6. Paste the **entire file contents** (including the comment header and
   tabs) into the `YT_COOKIES_TXT` Replit secret. The flatten-on-paste
   behaviour is fine — `cookieFromEnv()` reconstructs newlines from the
   tab pattern.
7. Redeploy the `api-server` artifact. On boot you should see a
   `YouTube cookie jar healthy` info log with `severity: "ok"`.
8. Verify with the §5 contract from `AGENTS.md`:
   ```sh
   curl -H "Authorization: Bearer $JWT" \
     "$REPLIT_DEV_DOMAIN/api/yt/stream/CvYnLqPN4SM"
   ```
   The `streamUrl` field must contain `googlevideo.com` and the audio
   must play in `<audio src=...>` for ~10 seconds.

## Why we don't auto-refresh

A fully automated refresh would require either:

- Storing a Google account password + 2FA seed in Replit secrets so a
  headless Chromium can re-log-in. That is a much worse secret to leak
  than a 1–4 week cookie jar, and Google actively flags datacentre IPs
  performing username/password login as suspicious — the account would
  get locked.
- Hosting an OAuth refresh-token flow on a long-lived browser profile
  somewhere outside Replit. That just moves the rotation problem.

So we monitor early and surface a clear remediation step instead. The
6-hour polling cadence + 7-day warning window gives an operator a full
working week to act before anything breaks.

## Wiring an external alert (optional)

The `/api/yt/cookie-status` endpoint returns 503 the moment the jar
becomes unusable, so any HTTP uptime checker can drive paging:

- **UptimeRobot**: add an HTTPS monitor on
  `https://<your-deploy>/api/yt/cookie-status`, expected status `200`,
  with a valid bearer token in the custom header.
- **BetterStack / Pingdom**: same shape — expect `200`, alert on `503`.
- **Replit deployment logs**: filter for `event=yt_cookie_health` and
  `level>=40` to surface every warn-or-worse snapshot.
