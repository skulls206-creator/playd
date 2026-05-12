/**
 * youtubei.js wrapper for PLAY+
 *
 * Singleton Innertube instance (cached for process lifetime).
 * PO tokens are managed by the opentracer module (lib/opentracer.ts)
 * and fed into Innertube on session creation.
 *
 * Response shapes mirror the old yt-dlp Python helper so the frontend
 * (AudioEngine.tsx, PlaydPlusPanel.tsx) needs zero changes.
 */

import { Innertube, FormatUtils, UniversalCache } from "youtubei.js";

type IStreamingData = NonNullable<Parameters<typeof FormatUtils.chooseFormat>[1]>;
import { getPoTokenAndVisitor, onTokenUpgrade } from "./opentracer";
import { installJsEvaluator } from "./js-evaluator";
import { recordLiveLoggedIn } from "./yt-cookies";

// Install the Node `vm`-based JavaScript evaluator that youtubei.js uses to
// run YouTube's player.js sig/n decipher script. Without this, every WEB-class
// client comes back with `signature_cipher` formats but no way to turn them
// into a googlevideo URL.
installJsEvaluator();

// ── Types ──────────────────────────────────────────────────────────────────

export interface Track {
  videoId: string;
  title: string;
  artist: string | null;
  duration: number | null;
  thumbnail: string | null;
}

export interface StreamResult {
  videoId: string;
  streamUrl: string;
  title: string;
  duration: number | null;
  thumbnail: string | null;
}

export interface SearchResult {
  tracks: Track[];
}

export interface PlaylistResult {
  tracks: Track[];
}

// ── Cookie helpers ─────────────────────────────────────────────────────────

function cookieFromEnv(): string | undefined {
  const raw = process.env.YT_COOKIES_TXT;
  if (!raw) return undefined;

  // Reconstruct newlines if the secret-store flattened them into a single line
  // (Replit's secret-store strips \n but preserves \t).
  let normalized = raw;
  if (raw.includes("\t") && !raw.includes("\n")) {
    normalized = raw.replace(
      /([^\t#])\s+([\w.-]+)\t(TRUE|FALSE)\t/g,
      "$1\n$2\t$3\t",
    );
  }

  // Innertube's `cookie` option is the value of an HTTP `Cookie:` header,
  // not a Netscape cookies.txt file. Parse the Netscape format and emit
  // `name=value; name2=value2`. Each non-comment line has 7 tab fields:
  //   domain  flag  path  secure  expiry  name  value
  const pairs: string[] = [];
  for (const line of normalized.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 7) continue;
    const name = parts[5];
    const value = parts[6];
    if (!name) continue;
    pairs.push(`${name}=${value ?? ""}`);
  }
  if (pairs.length === 0) return undefined;
  return pairs.join("; ");
}

// ── Singleton Innertube ────────────────────────────────────────────────────

let innertubeInstance: Innertube | null = null;
let initPromise: Promise<Innertube> | null = null;

// Drop the cached session whenever opentracer mints a fresher token, so the
// next request rebuilds Innertube with the upgraded po_token + visitor_data
// instead of staying bound to the cold-start pair forever.
onTokenUpgrade(() => {
  innertubeInstance = null;
  initPromise = null;
});

async function getInnertube(): Promise<Innertube> {
  if (innertubeInstance) return innertubeInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const cookie = cookieFromEnv();
    const cache = new UniversalCache(true);
    const { token: poToken, visitor_data: visitorData } = await getPoTokenAndVisitor();

    const yt = await Innertube.create({
      cookie,
      cache,
      po_token: poToken || undefined,
      visitor_data: visitorData || undefined,
    });

    innertubeInstance = yt;
    try {
      recordLiveLoggedIn(Boolean(yt.session.logged_in));
    } catch {
      // Don't let cookie-monitor bookkeeping break Innertube creation.
    }
    return yt;
  })();

  return initPromise;
}

// ── Thumbnail helpers ─────────────────────────────────────────────────────

function pickThumbnail(
  thumbnails: { url: string; width?: number; height?: number }[] | undefined | null
): string | null {
  if (!thumbnails || thumbnails.length === 0) return null;
  const real = thumbnails.filter(
    (t) => !t.url.includes("/sb/") && !t.url.includes("i.ytimg.com/sb")
  );
  if (real.length === 0) return thumbnails[0]?.url || null;
  real.sort((a, b) => (b.width || 0) - (a.width || 0));
  return real[0]?.url || null;
}

// ── Stream URL extraction ─────────────────────────────────────────────────

async function extractStreamUrl(
  streamingData: IStreamingData | undefined,
  yt: Innertube
): Promise<string> {
  if (!streamingData) throw new Error("No streaming data available");

  const format = FormatUtils.chooseFormat({ type: "audio" }, streamingData);

  if (format.url) return format.url;

  if (typeof format.decipher === "function") {
    const deciphered = await format.decipher(yt.session.player);
    if (deciphered) return deciphered;
  }

  throw new Error("Unable to extract audio stream URL");
}

// ── Public API ─────────────────────────────────────────────────────────────

interface VideoInfo {
  id?: string;
  video_id?: string;
  title?: { toString(): string };
  duration?: { seconds: number };
  thumbnails?: { url: string; width?: number; height?: number }[];
  author?: { name: string };
}

export async function searchYouTube(query: string, limit: number = 10): Promise<SearchResult> {
  const yt = await getInnertube();

  const results = await yt.search(query, { type: "video" });
  const videos = (results.videos || []) as VideoInfo[];

  const tracks: Track[] = videos.slice(0, Math.min(limit, 25)).map((v: VideoInfo) => ({
    videoId: v.id || v.video_id || "",
    title: v.title ? String(v.title) : "",
    artist: v.author?.name || null,
    duration: v.duration?.seconds ?? null,
    thumbnail: pickThumbnail(v.thumbnails),
  }));

  return { tracks };
}

export async function getStreamUrl(videoId: string): Promise<StreamResult> {
  const yt = await getInnertube();

  // Strategy: try clients in order. With a real (chromium-minted) PO token
  // and logged-in cookies, MWEB / WEB_CREATOR / TV / YTMUSIC return formats
  // with `signature_cipher` that the installed Node vm evaluator can decode
  // into a usable googlevideo URL. WEB itself now ships only SABR/UMP
  // formats (no per-format URL or cipher), so it lives at the back of the
  // line as a last resort. IOS/ANDROID currently 400 without an attested
  // mobile request, so they're skipped entirely.
  const clients: ("MWEB" | "WEB_CREATOR" | "TV" | "YTMUSIC" | "WEB")[] = [
    "MWEB",
    "WEB_CREATOR",
    "TV",
    "YTMUSIC",
    "WEB",
  ];
  let lastErr: unknown = null;

  for (const client of clients) {
    try {
      const info = await yt.getInfo(videoId, { client });
      const basicInfo = info.basic_info || {};
      const thumb = basicInfo.thumbnail as { url: string }[] | undefined;
      const streamUrl = await extractStreamUrl(info.streaming_data, yt);
      return {
        videoId,
        streamUrl,
        title: (basicInfo.title as string) || "",
        duration: (basicInfo.duration as number) || null,
        thumbnail: thumb && thumb.length > 0 ? thumb[0]?.url || null : null,
      };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("Unable to extract stream URL with any client");
}

export async function resolvePlaylist(url: string, maxItems: number = 200): Promise<PlaylistResult> {
  const yt = await getInnertube();

  const parsed = new URL(url);
  const playlistId = parsed.searchParams.get("list");
  if (!playlistId) throw new Error("Could not extract playlist ID from URL");

  const playlist = await yt.getPlaylist(playlistId);
  const videos = (playlist.videos || []) as VideoInfo[];

  const cap = Math.min(maxItems, 200);
  const tracks: Track[] = videos.slice(0, cap).map((v: VideoInfo) => ({
    videoId: v.id || v.video_id || "",
    title: v.title ? String(v.title) : "",
    artist: v.author?.name || null,
    duration: v.duration?.seconds ?? null,
    thumbnail: pickThumbnail(v.thumbnails),
  }));

  return { tracks };
}
