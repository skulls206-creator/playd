/**
 * youtubei.js wrapper for PLAY+
 *
 * Singleton Innertube instance (cached for process lifetime).
 * Uses live sessions (not local generation) so YouTube's InnerTube API
 * handles PO Token negotiation automatically. Cookies from YT_COOKIES_TXT
 * env are passed for auth and age-gated content.
 *
 * Response shapes mirror the old yt-dlp Python helper so the frontend
 * (AudioEngine.tsx, PlaydPlusPanel.tsx) needs zero changes.
 */

import { Innertube, FormatUtils, UniversalCache } from "youtubei.js";
import type { IStreamingData } from "youtubei.js";

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
  if (raw.includes("\t") && !raw.includes("\n")) {
    return raw
      .replace(/(?= \S+\t(?:TRUE|FALSE)\t\/?\t)/g, "\n")
      .replace(/(generated file![^\n\t]*?) (?=\S+\t)/g, "$1\n");
  }
  return raw;
}

// ── Singleton Innertube ────────────────────────────────────────────────────

let innertubeInstance: Innertube | null = null;
let initPromise: Promise<Innertube> | null = null;

async function getInnertube(): Promise<Innertube> {
  if (innertubeInstance) return innertubeInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const cookie = cookieFromEnv();
    const cache = new UniversalCache(false);

    const yt = await Innertube.create({
      cookie,
      cache,
    });

    innertubeInstance = yt;
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
  streamingData: IStreamingData | null | undefined,
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

  const info = await yt.getInfo(videoId);
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
