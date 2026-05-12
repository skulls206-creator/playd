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
import * as BG from "bgutils-js";
import { UniversalCache } from "youtubei.js";

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

// ── BotGuard browser-global polyfill ───────────────────────────────────────

/**
 * The BotGuard interpreter script (`new Function(script)()`) expects
 * browser globals: `document`, `window`, `navigator`, `location`.
 *
 * On Node.js those don't exist, so the interpreter crashes with a
 * ReferenceError.  We stub just enough of the DOM surface for the
 * interpreter to boot and register its global side-channel.
 *
 * The polyfills are idempotent — safe to call on every attestation
 * attempt.
 */
function installBotGuardPolyfills(): void {
  const g = globalThis as Record<string, unknown>;

  if (!g.document) {
    g.document = {
      createElement: () => ({}),
      documentElement: { style: {} },
      head: { appendChild: () => {} },
      body: { appendChild: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      getElementsByTagName: () => [],
      cookie: "",
      referrer: "",
      title: "",
      hidden: false,
      visibilityState: "visible",
    };
  }

  if (!g.window) {
    g.window = g;
  }

  if (!g.navigator) {
    g.navigator = {
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
      platform: "Linux x86_64",
      language: "en-US",
      languages: ["en-US", "en"],
      cookieEnabled: true,
      onLine: true,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      vendor: "Google Inc.",
      webdriver: false,
      maxTouchPoints: 0,
    };
  }

  if (!g.location) {
    g.location = {
      href: "https://www.youtube.com/",
      protocol: "https:",
      host: "www.youtube.com",
      hostname: "www.youtube.com",
      port: "",
      pathname: "/",
      search: "",
      hash: "",
      origin: "https://www.youtube.com",
      ancestorOrigins: { length: 0 } as unknown as DOMStringList,
      assign: () => {},
      replace: () => {},
      reload: () => {},
    };
  }

  if (!g.performance) {
    g.performance = {
      now: () => Date.now(),
      timing: { navigationStart: Date.now() - 5000 },
      getEntriesByType: () => [],
      mark: () => {},
      measure: () => {},
    };
  }

  if (!g.screen) {
    g.screen = {
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1050,
      colorDepth: 24,
      pixelDepth: 24,
    };
  }
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

  // 1. Fetch the attestation challenge from WAA
  const challenge = await BG.Challenge.create({
    fetch: globalThis.fetch.bind(globalThis),
    globalObj: globalThis as Record<string, unknown>,
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

  // 2. Polyfill browser globals so the BotGuard VM script can boot on Node
  installBotGuardPolyfills();

  // 3. Execute the BotGuard VM script into global scope
  new Function(
    challenge.interpreterJavascript
      .privateDoNotAccessOrElseSafeScriptWrappedValue,
  )();

  // 4. Generate the real PO token
  const result = await BG.PoToken.generate({
    program: challenge.program,
    bgConfig: {
      fetch: globalThis.fetch.bind(globalThis),
      globalObj: globalThis as Record<string, unknown>,
      identifier,
      requestKey: REQUEST_KEY,
    },
    globalName: challenge.globalName,
  });

  if (result.integrityTokenData.integrityToken) {
    // Store integrity token data for faster refresh next time
    await cache.set(
      "opentracer_integrity",
      JSON.stringify(result.integrityTokenData),
    );
  }

  return { token: result.poToken, visitor_data: identifier };
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
