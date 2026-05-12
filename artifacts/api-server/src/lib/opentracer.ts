/**
 * opentracer — PO Token engine for PLAY+
 *
 * Generates and manages Proof-of-Origin tokens for YouTube's
 * InnerTube API.  Modules that need a PO token import `getPoToken`
 * (async) or `getPoTokenSync` (fast cached path).
 *
 * When a cold-start token is all that's available it is returned
 * immediately; the module then tries a real BotGuard attestation
 * in the background and promotes the token on success.
 */
import * as BG from "bgutils-js";
import { UniversalCache } from "youtubei.js";

// ── Constants ──────────────────────────────────────────────────────────────

/** YouTube BotGuard request key (the "unbound" engagement type). */
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";

/** How often to refresh the PO token relative to its TTL (50%). */
const REFRESH_RATIO = 0.5;

/** Persistent cache shared with the Innertube session. */
const cache = new UniversalCache(true);

// ── State ──────────────────────────────────────────────────────────────────

let poToken: string | null = null;
let initPromise: Promise<string> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let lastGenerated: string | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function generateIdentifier(): string {
  const raw = crypto.getRandomValues(new Uint8Array(11));
  const b64 = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const ts = Math.floor(Date.now() / 1000);
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, ts);
  const tsEnc = btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${b64}${tsEnc}`;
}

// ── Cold-start token ───────────────────────────────────────────────────────

function mintColdStartToken(): string {
  const identifier = generateIdentifier();
  return BG.PoToken.generateColdStartToken(identifier);
}

// ── Full BotGuard attestation ──────────────────────────────────────────────

async function mintFullPoToken(): Promise<string> {
  const challenge = await BG.Challenge.create({
    fetch: globalThis.fetch.bind(globalThis),
    globalObj: globalThis as Record<string, unknown>,
    identifier: generateIdentifier(),
    requestKey: REQUEST_KEY,
    useYouTubeAPI: false,
  });

  if (
    !challenge ||
    !challenge.interpreterJavascript
      .privateDoNotAccessOrElseSafeScriptWrappedValue
  ) {
    throw new Error("No interpreter script in challenge response");
  }

  new Function(
    challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue,
  )();

  const result = await BG.PoToken.generate({
    program: challenge.program,
    bgConfig: {
      fetch: globalThis.fetch.bind(globalThis),
      globalObj: globalThis as Record<string, unknown>,
      identifier: generateIdentifier(),
      requestKey: REQUEST_KEY,
    },
    globalName: challenge.globalName,
  });

  if (result.integrityTokenData.integrityToken) {
    await cache.set(
      "opentracer_integrity",
      JSON.stringify(result.integrityTokenData),
    );
  }

  return result.poToken;
}

// ── Refresh scheduler ──────────────────────────────────────────────────────

function scheduleRefresh(ttlSecs: number) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const delayMs = Math.max(
    300_000,
    (ttlSecs || 7200) * 1000 * REFRESH_RATIO,
  );
  refreshTimer = setTimeout(async () => {
    try {
      console.log("[opentracer] Refreshing PO token...");
      poToken = await mintFullPoToken();
      console.log("[opentracer] PO token refreshed");
      scheduleRefresh(7200);
    } catch (err) {
      console.warn("[opentracer] Refresh failed, retrying in 15 min:", err);
      scheduleRefresh(900);
    }
  }, delayMs);
}

async function tryUpgrade() {
  try {
    console.log("[opentracer] Attempting full BotGuard attestation...");
    const full = await mintFullPoToken();
    if (full) {
      poToken = full;
      lastGenerated = new Date().toISOString();
      console.log("[opentracer] Upgraded to real PO token");
      scheduleRefresh(7200);
    }
  } catch (err) {
    console.warn(
      "[opentracer] Full attestation failed, keeping cold-start token:",
      (err as Error).message,
    );
    scheduleRefresh(900);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface OpentracerStatus {
  started: boolean;
  hasRealToken: boolean;
  hasColdStartToken: boolean;
  lastGenerated: string | null;
}

export function getStatus(): OpentracerStatus {
  const isColdStart =
    poToken !== null && poToken.length > 0 && poToken.length < 100;
  return {
    started,
    hasRealToken: poToken !== null && !isColdStart,
    hasColdStartToken: poToken !== null && isColdStart,
    lastGenerated,
  };
}

export function getPoTokenSync(): string | null {
  return poToken;
}

export async function getPoToken(): Promise<string> {
  if (poToken) return poToken;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const cold = mintColdStartToken();
    poToken = cold;
    lastGenerated = new Date().toISOString();
    console.log("[opentracer] Cold-start PO token minted");
    tryUpgrade();
    return poToken!;
  })();

  return initPromise;
}

export function start(subject?: string, code?: string, _runId?: string) {
  if (started) return;
  started = true;

  console.log(
    `[opentracer] Starting (subject=${subject ?? "default"}, code=${code ?? "none"})`,
  );

  initPromise = (async () => {
    const cold = mintColdStartToken();
    poToken = cold;
    lastGenerated = new Date().toISOString();
    console.log("[opentracer] Cold-start PO token minted");
    return cold;
  })();

  initPromise.then(() => tryUpgrade());
}
