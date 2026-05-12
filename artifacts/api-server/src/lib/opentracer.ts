/**
 * opentracer — PO Token engine for PLAY+
 *
 * Generates and manages Proof-of-Origin tokens for YouTube's
 * InnerTube API, including the paired visitor_data identifier
 * that must travel with every tokenised request.
 *
 * Modules that need a PO token import `getPoTokenAndVisitor`
 * (async, returns { token, visitor_data }) or `getPoTokenSync`
 * (fast cached path, token only).
 *
 * When a cold-start token is all that's available it is returned
 * immediately; the module then tries a real BotGuard attestation
 * in the background and promotes the token on success.
 */
import { BG } from "bgutils-js";
import { UniversalCache } from "youtubei.js";
import { JSDOM } from "jsdom";

// ── Constants ──────────────────────────────────────────────────────────────

/** YouTube BotGuard request key (the "unbound" engagement type). */
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";

/** How often to refresh the PO token relative to its TTL (50%). */
const REFRESH_RATIO = 0.5;

/** How often to attempt a cold-start regeneration (ms). */
const COLD_START_REFRESH_MS = 60 * 60 * 1000; // 1 hour

/** Persistent cache shared with the Innertube session. */
const cache = new UniversalCache(true);

// ── State ──────────────────────────────────────────────────────────────────

let poToken: string | null = null;
let visitorData: string | null = null;
let initPromise: Promise<PoTokenPair> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let lastGenerated: string | null = null;

// ── BotGuard JSDOM context ─────────────────────────────────────────────────

/**
 * The BotGuard interpreter script expects a real browser environment with
 * `document`, `window`, `navigator`, `location`, etc. Stubbing these on the
 * Node `globalThis` ad-hoc is fragile — the interpreter probes many DOM
 * surfaces and silently misbehaves when they don't compose like a real DOM
 * (the cold-start token sticks and YouTube refuses to stream).
 *
 * Instead, spin up one persistent JSDOM instance and use its `window` as the
 * BotGuard `globalObj`. The interpreter script is executed *inside* that
 * window via `runScripts: "outside-only"` and `window.eval(...)`, so all the
 * globals it references resolve against the JSDOM DOM, not Node.
 */
let jsdomInstance: JSDOM | null = null;

function getJsdomWindow(): JSDOM["window"] {
  if (jsdomInstance) return jsdomInstance.window;
  jsdomInstance = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://www.youtube.com/",
    referrer: "https://www.youtube.com/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = jsdomInstance.window as unknown as Record<string, unknown>;
  // bgutils touches `fetch` on the global object — JSDOM doesn't ship one.
  if (!w.fetch) w.fetch = globalThis.fetch.bind(globalThis);
  return jsdomInstance.window;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function generateIdentifier(): string {
  // visitor_data format: base64url(11 random chars + 4-byte timestamp)
  // We derive a stable identifier from the cache so it survives restarts.
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

function mintColdStartToken(): PoTokenPair {
  const identifier = generateIdentifier();
  const token = BG.PoToken.generateColdStartToken(identifier);
  return { token, visitor_data: identifier };
}

// ── Full BotGuard attestation ──────────────────────────────────────────────

async function mintFullPoToken(): Promise<PoTokenPair> {
  const identifier = generateIdentifier();

  // Use a single JSDOM window for both the challenge and the generation step
  // — the interpreter script registers state on this window's globals that
  // BG.PoToken.generate then reads back.
  const jsdomWindow = getJsdomWindow() as unknown as Record<string, unknown>;

  // 1. Fetch the attestation challenge from WAA
  const challenge = await BG.Challenge.create({
    fetch: globalThis.fetch.bind(globalThis),
    globalObj: jsdomWindow,
    identifier,
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

  // 2. Execute the BotGuard VM script *inside* the JSDOM window so its
  //    references to document/window/navigator/etc. resolve against the
  //    DOM, not Node's globalThis.
  const w = jsdomWindow as unknown as { eval(src: string): unknown };
  w.eval(
    challenge.interpreterJavascript
      .privateDoNotAccessOrElseSafeScriptWrappedValue,
  );

  // 3. Generate the real PO token using the same JSDOM context
  const result = await BG.PoToken.generate({
    program: challenge.program,
    bgConfig: {
      fetch: globalThis.fetch.bind(globalThis),
      globalObj: jsdomWindow,
      identifier,
      requestKey: REQUEST_KEY,
    },
    globalName: challenge.globalName,
  });

  if (result.integrityTokenData.integrityToken) {
    // Store integrity token data for faster refresh next time
    const encoded = new TextEncoder().encode(
      JSON.stringify(result.integrityTokenData),
    );
    const buf = encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength,
    ) as ArrayBuffer;
    await cache.set("opentracer_integrity", buf);
  }

  return { token: result.poToken, visitor_data: identifier };
}

// ── Upgrade subscribers ────────────────────────────────────────────────────

const upgradeListeners: Array<() => void> = [];

/**
 * Register a callback that fires whenever the opentracer upgrades from a
 * cold-start token to a real PO token (or refreshes a real token). Consumers
 * that cache an Innertube session use this to drop their cached instance so
 * the next request rebuilds it with the freshly minted token + visitor_data.
 */
export function onTokenUpgrade(cb: () => void): void {
  upgradeListeners.push(cb);
}

function notifyUpgrade(): void {
  for (const cb of upgradeListeners) {
    try {
      cb();
    } catch (err) {
      console.warn("[opentracer] upgrade listener threw:", err);
    }
  }
}

// ── Refresh scheduler ──────────────────────────────────────────────────────

function scheduleRefresh(ttlSecs: number) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const delayMs = Math.max(
    300_000, // minimum 5 minutes
    (ttlSecs || 7200) * 1000 * REFRESH_RATIO,
  );
  refreshTimer = setTimeout(async () => {
    try {
      console.log("[opentracer] Refreshing PO token...");
      const pair = await mintFullPoToken();
      poToken = pair.token;
      visitorData = pair.visitor_data;
      lastGenerated = new Date().toISOString();
      console.log("[opentracer] PO token refreshed");
      notifyUpgrade();
      scheduleRefresh(7200); // default 2h TTL
    } catch (err) {
      console.warn("[opentracer] Refresh failed, will retry in 15 min:", err);
      scheduleRefresh(900);
    }
  }, delayMs);
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface PoTokenPair {
  token: string;
  visitor_data: string;
}

export interface OpentracerStatus {
  /** Whether the tracer has been started. */
  started: boolean;
  /** Whether a real (non-cold-start) PO token is loaded. */
  hasRealToken: boolean;
  /** Whether a cold-start token is available. */
  hasColdStartToken: boolean;
  /** Whether visitor_data is paired with the current token. */
  hasVisitorData: boolean;
  /** The current visitor_data identifier (truncated for display). */
  visitorData: string | null;
  /** Time of last successful token generation (ISO). */
  lastGenerated: string | null;
}

export function getStatus(): OpentracerStatus {
  const isColdStart =
    poToken !== null && poToken.length > 0 && poToken.length < 100;
  return {
    started,
    hasRealToken: poToken !== null && !isColdStart,
    hasColdStartToken: poToken !== null && isColdStart,
    hasVisitorData: visitorData !== null && visitorData.length > 0,
    visitorData: visitorData
      ? visitorData.slice(0, 12) + "..."
      : null,
    lastGenerated,
  };
}

/**
 * Return the current PO token synchronously (null if not yet available).
 * For the full { token, visitor_data } pair use getPoTokenAndVisitor().
 */
export function getPoTokenSync(): string | null {
  return poToken;
}

/**
 * Return the current visitor_data synchronously (null if not yet available).
 */
export function getVisitorDataSync(): string | null {
  return visitorData;
}

/**
 * Return the PO token and its paired visitor_data.
 * Waits for generation if the tracer hasn't produced a token yet.
 *
 * YouTube rejects PO tokens that arrive without the correct
 * visitor_data, so you MUST pass both values to Innertube.create().
 */
export async function getPoTokenAndVisitor(): Promise<PoTokenPair> {
  if (poToken && visitorData) return { token: poToken, visitor_data: visitorData };
  if (initPromise) return initPromise;

  // If not started, lazy-start with a cold token
  initPromise = (async (): Promise<PoTokenPair> => {
    const pair = mintColdStartToken();
    poToken = pair.token;
    visitorData = pair.visitor_data;
    lastGenerated = new Date().toISOString();
    console.log("[opentracer] Cold-start PO token + visitor_data minted");

    // Try to upgrade in background
    tryUpgrade();

    return pair;
  })();

  return initPromise;
}

/**
 * Legacy convenience — returns just the token string.
 * Prefer getPoTokenAndVisitor() so you also get visitor_data.
 */
export async function getPoToken(): Promise<string> {
  const pair = await getPoTokenAndVisitor();
  return pair.token;
}

// ── Upgrade helpers ────────────────────────────────────────────────────────

async function tryUpgrade() {
  try {
    console.log("[opentracer] Attempting full BotGuard attestation...");
    const pair = await mintFullPoToken();
    if (pair.token) {
      poToken = pair.token;
      visitorData = pair.visitor_data;
      lastGenerated = new Date().toISOString();
      console.log("[opentracer] Upgraded to real PO token + visitor_data");
      notifyUpgrade();
      scheduleRefresh(7200);
    }
  } catch (err) {
    console.warn(
      "[opentracer] Full attestation failed, keeping cold-start token:",
      (err as Error).message,
    );
    // Schedule periodic retry
    scheduleRefresh(900);
  }
}

/**
 * Start the opentracer. Call once at server boot.
 * Returns immediately with a cold-start token and upgrades in background.
 */
export function start(subject?: string, code?: string, _runId?: string) {
  if (started) return;
  started = true;

  console.log(
    `[opentracer] Starting (subject=${subject ?? "default"}, code=${code ?? "none"})`,
  );

  // Kick off cold-start immediately
  initPromise = (async (): Promise<PoTokenPair> => {
    const pair = mintColdStartToken();
    poToken = pair.token;
    visitorData = pair.visitor_data;
    lastGenerated = new Date().toISOString();
    console.log("[opentracer] Cold-start PO token + visitor_data minted");
    return pair;
  })();

  // Then try real attestation
  initPromise.then(() => tryUpgrade());
}
