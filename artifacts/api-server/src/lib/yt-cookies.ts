/**
 * yt-cookies — health monitor for the YT_COOKIES_TXT secret.
 *
 * YouTube playback in PLAY+ depends on a logged-in cookie jar pasted into
 * the YT_COOKIES_TXT Replit secret. Google rotates the short-lived
 * `__Secure-1PSIDTS` / `__Secure-3PSIDTS` cookies roughly every 1–4 weeks,
 * and the long-lived login cookies expire after ~2 years. When SIDTS
 * rotates past its expiry, every `/api/yt/stream/*` call breaks until a
 * human pastes a fresh jar.
 *
 * This module:
 *   1. Parses the Netscape cookies.txt and extracts expiry timestamps for
 *      the cookies YouTube actually requires for a LOGGED_IN session.
 *   2. Verifies that the live Innertube session is still authenticated.
 *   3. Periodically logs a structured warning at increasing severity as
 *      expiry approaches (or after the live check stops returning
 *      LOGGED_IN), so operators can rotate the secret before stream calls
 *      start failing.
 *   4. Exposes the latest snapshot via getCookieHealth() so the
 *      `/api/yt/cookie-status` route can surface it for alerting.
 *
 * We don't auto-mint cookies via headless Chromium because that would
 * require storing a Google account password / 2FA seed in Replit secrets
 * for an account that owns YouTube history — far worse than the current
 * manual rotation. Instead we surface the warning early so the runbook in
 * docs/yt-cookie-runbook.md can be followed before anything breaks.
 */

import { logger } from "./logger";

// ── Cookie classification ─────────────────────────────────────────────────

/**
 * Long-lived login cookies. Any of these missing means the secret was
 * pasted from a logged-out browser session and YouTube will treat us as
 * anonymous (no membership-gated content, harsher rate limits, more PO
 * token challenges).
 */
const LOGIN_COOKIES = [
  "SAPISID",
  "__Secure-3PAPISID",
  "__Secure-3PSID",
  "SID",
  "LOGIN_INFO",
] as const;

/**
 * Short-lived rotating cookies. These are what Google rotates every 1–4
 * weeks; once they expire YouTube refuses authenticated requests even
 * though the long-lived cookies are still valid.
 */
const ROTATING_COOKIES = ["__Secure-1PSIDTS", "__Secure-3PSIDTS"] as const;

// ── Severity thresholds ───────────────────────────────────────────────────

const SEVEN_DAYS_SECS = 7 * 24 * 60 * 60;
const TWO_DAYS_SECS = 2 * 24 * 60 * 60;

// ── Types ─────────────────────────────────────────────────────────────────

interface ParsedCookie {
  domain: string;
  name: string;
  value: string;
  /** Unix seconds; 0 means session cookie (no expiry). */
  expires: number;
}

export type CookieSeverity =
  | "ok"
  | "warn"
  | "critical"
  | "expired"
  | "logged_out"
  | "missing";

export interface CookieHealth {
  /** YT_COOKIES_TXT secret was set and parseable. */
  present: boolean;
  /** Long-lived login cookies are present in the jar. */
  hasLoginCookies: boolean;
  /** Short-lived rotating cookies are present in the jar. */
  hasRotatingCookies: boolean;
  /** Names of LOGIN_COOKIES that were missing from the jar. */
  missingLoginCookies: string[];
  /** Names of ROTATING_COOKIES that were missing from the jar. */
  missingRotatingCookies: string[];
  /** ISO timestamp of the earliest rotating-cookie expiry (null if none). */
  earliestRotatingExpiry: string | null;
  /** ISO timestamp of the earliest login-cookie expiry (null if none). */
  earliestLoginExpiry: string | null;
  /** Seconds until the earliest rotating cookie expires (negative = expired). */
  secondsUntilRotatingExpiry: number | null;
  /** Seconds until the earliest login cookie expires (negative = expired). */
  secondsUntilLoginExpiry: number | null;
  /**
   * Result of the live Innertube `session.logged_in` check. `null` means
   * we have not yet probed Innertube (cold start) or the probe errored.
   */
  loggedIn: boolean | null;
  /** Overall severity — operators should alert on `warn` and worse. */
  severity: CookieSeverity;
  /** Human-readable remediation steps for the current severity. */
  remediation: string;
  /** ISO timestamp of when this snapshot was computed. */
  checkedAt: string;
}

// ── Cookie-jar parsing ────────────────────────────────────────────────────

/**
 * Parse the YT_COOKIES_TXT Replit secret into structured cookies.
 * Mirrors the newline-reconstruction logic in lib/youtube.ts so both
 * call-sites see the same jar.
 */
function parseCookieJar(raw: string): ParsedCookie[] {
  let normalized = raw;
  if (raw.includes("\t") && !raw.includes("\n")) {
    normalized = raw.replace(
      /([^\t#])\s+([\w.-]+)\t(TRUE|FALSE)\t/g,
      "$1\n$2\t$3\t",
    );
  }

  const cookies: ParsedCookie[] = [];
  for (const line of normalized.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 7) continue;
    const domain = parts[0] ?? "";
    const expiresRaw = parts[4] ?? "0";
    const name = parts[5] ?? "";
    const value = parts[6] ?? "";
    if (!name) continue;
    const expires = Number.parseInt(expiresRaw, 10);
    cookies.push({
      domain,
      name,
      value,
      expires: Number.isFinite(expires) ? expires : 0,
    });
  }
  return cookies;
}

// ── Health computation ───────────────────────────────────────────────────

let cachedSnapshot: CookieHealth | null = null;
let liveLoggedIn: boolean | null = null;

function computeSnapshot(): CookieHealth {
  const raw = process.env.YT_COOKIES_TXT;
  const checkedAt = new Date().toISOString();

  if (!raw) {
    return {
      present: false,
      hasLoginCookies: false,
      hasRotatingCookies: false,
      missingLoginCookies: [...LOGIN_COOKIES],
      missingRotatingCookies: [...ROTATING_COOKIES],
      earliestRotatingExpiry: null,
      earliestLoginExpiry: null,
      secondsUntilRotatingExpiry: null,
      secondsUntilLoginExpiry: null,
      loggedIn: null,
      severity: "missing",
      remediation: REMEDIATION.missing,
      checkedAt,
    };
  }

  const cookies = parseCookieJar(raw);
  const byName = new Map<string, ParsedCookie>();
  for (const c of cookies) {
    // Prefer the .youtube.com entry over .google.com when both exist.
    const existing = byName.get(c.name);
    if (!existing || c.domain.includes("youtube.com")) {
      byName.set(c.name, c);
    }
  }

  const missingLoginCookies = LOGIN_COOKIES.filter((n) => !byName.has(n));
  const missingRotatingCookies = ROTATING_COOKIES.filter((n) => !byName.has(n));
  const hasLoginCookies = missingLoginCookies.length === 0;
  const hasRotatingCookies = missingRotatingCookies.length === 0;

  const nowSecs = Math.floor(Date.now() / 1000);

  function earliest(names: readonly string[]): {
    iso: string | null;
    secsLeft: number | null;
  } {
    let min: number | null = null;
    for (const n of names) {
      const c = byName.get(n);
      if (!c || c.expires <= 0) continue;
      if (min === null || c.expires < min) min = c.expires;
    }
    if (min === null) return { iso: null, secsLeft: null };
    return { iso: new Date(min * 1000).toISOString(), secsLeft: min - nowSecs };
  }

  const rotating = earliest(ROTATING_COOKIES);
  const login = earliest(LOGIN_COOKIES);

  let severity: CookieSeverity = "ok";
  if (!hasLoginCookies) {
    // Missing long-lived login cookies — the jar was exported from a
    // logged-out tab and YouTube will treat us as anonymous.
    severity = "logged_out";
  } else if (
    (rotating.secsLeft !== null && rotating.secsLeft <= 0) ||
    (login.secsLeft !== null && login.secsLeft <= 0)
  ) {
    severity = "expired";
  } else if (!hasRotatingCookies) {
    // Login cookies present but the rotating SIDTS pair is absent: the
    // session is incomplete and YouTube will reject authenticated calls.
    // Treat the same as logged_out so /api/yt/cookie-status returns 503.
    severity = "logged_out";
  } else if (liveLoggedIn === false) {
    severity = "logged_out";
  } else if (rotating.secsLeft === null) {
    // Rotating cookies are present but advertise no expiry (session
    // cookies). That should never happen for a real Google jar — flag as
    // critical so it gets investigated rather than silently passing.
    severity = "critical";
  } else if (rotating.secsLeft <= TWO_DAYS_SECS) {
    severity = "critical";
  } else if (rotating.secsLeft <= SEVEN_DAYS_SECS) {
    severity = "warn";
  }

  return {
    present: true,
    hasLoginCookies,
    hasRotatingCookies,
    missingLoginCookies,
    missingRotatingCookies,
    earliestRotatingExpiry: rotating.iso,
    earliestLoginExpiry: login.iso,
    secondsUntilRotatingExpiry: rotating.secsLeft,
    secondsUntilLoginExpiry: login.secsLeft,
    loggedIn: liveLoggedIn,
    severity,
    remediation: REMEDIATION[severity],
    checkedAt,
  };
}

// ── Remediation messages ─────────────────────────────────────────────────

const REMEDIATION: Record<CookieSeverity, string> = {
  ok: "No action needed. YouTube cookies are healthy.",
  warn:
    "Refresh YT_COOKIES_TXT within the next week. " +
    "See artifacts/api-server/docs/yt-cookie-runbook.md for steps.",
  critical:
    "Refresh YT_COOKIES_TXT in the next 48 hours — SIDTS is about to expire " +
    "and /api/yt/stream/* will start failing once it does. " +
    "See artifacts/api-server/docs/yt-cookie-runbook.md.",
  expired:
    "YT_COOKIES_TXT has expired cookies. /api/yt/stream/* will return 500s " +
    "until the secret is rotated and the API server is redeployed. " +
    "Follow artifacts/api-server/docs/yt-cookie-runbook.md immediately.",
  logged_out:
    "YT_COOKIES_TXT does not contain a logged-in YouTube session. " +
    "Re-export from a tab where you are signed in and update the Replit " +
    "secret. See artifacts/api-server/docs/yt-cookie-runbook.md.",
  missing:
    "YT_COOKIES_TXT secret is not set. Paste a Netscape-format cookies.txt " +
    "from a logged-in youtube.com session. " +
    "See artifacts/api-server/docs/yt-cookie-runbook.md.",
};

// ── Live login probe ─────────────────────────────────────────────────────

/**
 * Called by lib/youtube.ts after each successful Innertube.create() with
 * the value of `session.logged_in`. We keep this as a setter rather than
 * importing youtube.ts directly to avoid a require cycle (youtube.ts
 * depends on this file's notifier indirectly via the monitor).
 */
export function recordLiveLoggedIn(value: boolean): void {
  liveLoggedIn = value;
  cachedSnapshot = computeSnapshot();
}

// ── Public API ───────────────────────────────────────────────────────────

export function getCookieHealth(): CookieHealth {
  if (!cachedSnapshot) cachedSnapshot = computeSnapshot();
  return cachedSnapshot;
}

/** Recompute and return a fresh snapshot. */
export function refreshCookieHealth(): CookieHealth {
  cachedSnapshot = computeSnapshot();
  return cachedSnapshot;
}

// ── Background monitor ───────────────────────────────────────────────────

/** How often to re-evaluate cookie health (6 hours). */
const MONITOR_INTERVAL_MS = 6 * 60 * 60 * 1000;

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let lastLoggedSeverity: CookieSeverity | null = null;

function emitWarning(snapshot: CookieHealth): void {
  // Only escalate logs when severity changes or stays at warn-or-worse,
  // so we don't spam the same "OK" line every 6h.
  const isProblem =
    snapshot.severity !== "ok" && snapshot.severity !== undefined;

  if (!isProblem && lastLoggedSeverity === null) {
    lastLoggedSeverity = snapshot.severity;
    logger.info(
      {
        event: "yt_cookie_health",
        severity: snapshot.severity,
        earliestRotatingExpiry: snapshot.earliestRotatingExpiry,
        secondsUntilRotatingExpiry: snapshot.secondsUntilRotatingExpiry,
        loggedIn: snapshot.loggedIn,
      },
      "YouTube cookie jar healthy",
    );
    return;
  }

  if (!isProblem) {
    if (lastLoggedSeverity !== "ok") {
      logger.info(
        {
          event: "yt_cookie_health",
          severity: snapshot.severity,
          previousSeverity: lastLoggedSeverity,
        },
        "YouTube cookie jar recovered",
      );
    }
    lastLoggedSeverity = snapshot.severity;
    return;
  }

  const payload = {
    event: "yt_cookie_health",
    severity: snapshot.severity,
    hasLoginCookies: snapshot.hasLoginCookies,
    hasRotatingCookies: snapshot.hasRotatingCookies,
    missingLoginCookies: snapshot.missingLoginCookies,
    missingRotatingCookies: snapshot.missingRotatingCookies,
    earliestRotatingExpiry: snapshot.earliestRotatingExpiry,
    earliestLoginExpiry: snapshot.earliestLoginExpiry,
    secondsUntilRotatingExpiry: snapshot.secondsUntilRotatingExpiry,
    secondsUntilLoginExpiry: snapshot.secondsUntilLoginExpiry,
    loggedIn: snapshot.loggedIn,
    remediation: snapshot.remediation,
  };

  if (
    snapshot.severity === "expired" ||
    snapshot.severity === "missing" ||
    snapshot.severity === "logged_out"
  ) {
    logger.error(payload, "YouTube cookie jar unusable");
  } else if (snapshot.severity === "critical") {
    logger.error(payload, "YouTube cookies expire within 48h");
  } else {
    logger.warn(payload, "YouTube cookies expire within 7 days");
  }

  lastLoggedSeverity = snapshot.severity;
}

/**
 * Start the periodic cookie-health monitor. Call once at server boot.
 * Idempotent — repeated calls are no-ops.
 */
export function startCookieMonitor(): void {
  if (monitorTimer) return;
  emitWarning(refreshCookieHealth());
  monitorTimer = setInterval(() => {
    emitWarning(refreshCookieHealth());
  }, MONITOR_INTERVAL_MS);
  // Don't keep the event loop alive just for the monitor.
  if (typeof monitorTimer.unref === "function") monitorTimer.unref();
}

/** For tests — stop the monitor and reset cached state. */
export function stopCookieMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
  lastLoggedSeverity = null;
  cachedSnapshot = null;
  liveLoggedIn = null;
}
