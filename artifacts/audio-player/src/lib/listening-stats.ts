/**
 * Listening stats store — tracks play time, top tracks/artists, active hours.
 *
 * Data persisted to IndexedDB as a serialized blob. Updated periodically while
 * a track is playing (every 5 seconds), and on track change.
 */

import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { LocalTrack } from './track-store';

const STATS_KEY = 'playd_listening_stats';

export interface PlaySession {
  trackId: number;
  artist: string;
  album: string;
  title: string;
  /** Duration of this play session in seconds */
  elapsedSec: number;
  /** When the session started (ISO) */
  startedAt: string;
  /** Last update timestamp (ISO) — for resuming interrupted sessions */
  lastUpdatedAt: string;
}

export interface ListeningStats {
  /** Total seconds listened, all time */
  totalSeconds: number;
  /** Per-track play time in seconds, keyed by trackId */
  trackTime: Record<number, number>;
  /** Track display name keyed by trackId — survives library rescans */
  trackName: Record<number, string>;
  /** Per-artist play time in seconds */
  artistTime: Record<string, number>;
  /** Per-album play time in seconds */
  albumTime: Record<string, number>;
  /** Per-hour active listening count (0-23), resets weekly */
  hourActivity: number[];
  /** Per-weekday active listening count (0-6, Sun=0), resets weekly */
  weekdayActivity: number[];
  /** Track IDs, sorted by play time descending */
  topTrackIds: number[];
  /** Artist names, sorted by play time descending */
  topArtists: string[];
  /** Last updated timestamp */
  lastUpdated: string;
  /** ISO week start (Monday) for the current activity week */
  activityWeekStart: string;
  /** Total sessions tracked */
  sessionCount: number;
  /** Current playlist session (null if not actively tracking) */
  currentSession: PlaySession | null;
  /** First use date (ISO) */
  firstUsedAt: string;
}

function createEmptyStats(): ListeningStats {
  const now = new Date().toISOString();
  return {
    totalSeconds: 0,
    trackTime: {},
    trackName: {},
    artistTime: {},
    albumTime: {},
    hourActivity: new Array(24).fill(0),
    weekdayActivity: new Array(7).fill(0),
    topTrackIds: [],
    topArtists: [],
    lastUpdated: now,
    activityWeekStart: getWeekStart(),
    sessionCount: 0,
    currentSession: null,
    firstUsedAt: now,
  };
}

function getWeekStart(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString();
}

function isSameWeek(storedWeekStart: string): boolean {
  return storedWeekStart === getWeekStart();
}

function resetWeeklyActivity(stats: ListeningStats): void {
  stats.hourActivity = new Array(24).fill(0);
  stats.weekdayActivity = new Array(7).fill(0);
  stats.activityWeekStart = getWeekStart();
}

interface ListeningStatsStore {
  stats: ListeningStats;
  loaded: boolean;

  load: () => Promise<void>;
  /** Start tracking a new play session */
  startSession: (track: LocalTrack) => void;
  /** End the current session and log elapsed time */
  endSession: () => void;
  /** Tick: update running session elapsed time */
  tickSession: () => void;
  /** Reset all stats */
  resetStats: () => Promise<void>;

  // Derived values
  totalHours: () => string;
  topTracks: (limit?: number) => Array<{ trackId: number; seconds: number }>;
  topArtistsList: (limit?: number) => Array<{ name: string; seconds: number }>;
  todaySeconds: () => number;
  thisWeekSeconds: () => number;
}

export const useListeningStats = create<ListeningStatsStore>((set, get) => ({
  stats: createEmptyStats(),
  loaded: false,

  load: async () => {
    try {
      const stored = await idbGet<ListeningStats>(STATS_KEY);
      if (stored) {
        // Reset weekly activity if a new week started
        if (!isSameWeek(stored.activityWeekStart)) {
          stored.hourActivity = new Array(24).fill(0);
          stored.weekdayActivity = new Array(7).fill(0);
          stored.activityWeekStart = getWeekStart();
        }
        // Check for an orphaned session (app was closed while playing)
        if (stored.currentSession) {
          const session = stored.currentSession;
          const elapsed = (Date.now() - new Date(session.lastUpdatedAt).getTime()) / 1000;
          if (elapsed > 120) {
            // Session stale (>2 min) — count what we have and close it
            stored.totalSeconds += session.elapsedSec;
            stored.trackTime[session.trackId] = (stored.trackTime[session.trackId] || 0) + session.elapsedSec;
            stored.trackName[session.trackId] = `${session.title} — ${session.artist}`;
            stored.artistTime[session.artist] = (stored.artistTime[session.artist] || 0) + session.elapsedSec;
            stored.albumTime[session.album] = (stored.albumTime[session.album] || 0) + session.elapsedSec;
            stored.currentSession = null;
            stored.lastUpdated = new Date().toISOString();
            rebuildSortedLists(stored);
          }
          // else: keep the session alive (played recently)
        }
        set({ stats: stored, loaded: true });
      } else {
        set({ stats: createEmptyStats(), loaded: true });
      }
    } catch {
      set({ stats: createEmptyStats(), loaded: true });
    }
  },

  startSession: (track) => {
    const { stats } = get();
    // If a previous session exists and wasn't closed, finalize it first
    if (stats.currentSession) {
      get().endSession();
    }

    const now = new Date().toISOString();
    stats.currentSession = {
      trackId: track.id,
      artist: track.artist || 'Unknown Artist',
      album: track.album || 'Unknown Album',
      title: track.title || 'Unknown Title',
      elapsedSec: 0,
      startedAt: now,
      lastUpdatedAt: now,
    };
    stats.sessionCount++;
    stats.lastUpdated = now;

    // Rebuild sorted lists (cheap enough on start)
    rebuildSortedLists(stats);
    set({ stats: { ...stats } });
    persistStats(stats);
  },

  endSession: () => {
    const { stats } = get();
    if (!stats.currentSession) return;

    const session = stats.currentSession;
    // Final elapsed is what was tracked + time since last update
    const elapsed = (Date.now() - new Date(session.lastUpdatedAt).getTime()) / 1000;
    const totalElapsed = session.elapsedSec + Math.max(0, elapsed);

    if (totalElapsed > 1) {
      stats.totalSeconds += totalElapsed;
      stats.trackTime[session.trackId] = (stats.trackTime[session.trackId] || 0) + totalElapsed;
      stats.trackName[session.trackId] = `${session.title} — ${session.artist}`;
      stats.artistTime[session.artist] = (stats.artistTime[session.artist] || 0) + totalElapsed;
      stats.albumTime[session.album] = (stats.albumTime[session.album] || 0) + totalElapsed;

      // Hour/weekday activity
      const now = new Date();
      stats.hourActivity[now.getHours()] = (stats.hourActivity[now.getHours()] || 0) + 1;
      stats.weekdayActivity[now.getDay()] = (stats.weekdayActivity[now.getDay()] || 0) + 1;
    }

    stats.currentSession = null;
    stats.lastUpdated = new Date().toISOString();
    rebuildSortedLists(stats);
    set({ stats: { ...stats } });
    persistStats(stats);
  },

  tickSession: () => {
    const { stats } = get();
    if (!stats.currentSession) return;

    const now = Date.now();
    const lastUpdate = new Date(stats.currentSession.lastUpdatedAt).getTime();
    const tickElapsed = Math.max(0, (now - lastUpdate) / 1000);

    // Accumulate into session
    stats.currentSession.elapsedSec += tickElapsed;
    stats.currentSession.lastUpdatedAt = new Date(now).toISOString();

    // Also accumulate into totals incrementally (= granular tracking)
    if (tickElapsed > 0.1) {
      stats.totalSeconds += tickElapsed;
      stats.trackTime[stats.currentSession.trackId] =
        (stats.trackTime[stats.currentSession.trackId] || 0) + tickElapsed;
      stats.trackName[stats.currentSession.trackId] = `${stats.currentSession.title} — ${stats.currentSession.artist}`;
      stats.artistTime[stats.currentSession.artist] =
        (stats.artistTime[stats.currentSession.artist] || 0) + tickElapsed;
      stats.albumTime[stats.currentSession.album] =
        (stats.albumTime[stats.currentSession.album] || 0) + tickElapsed;

      // Increment hourly/weekday activity on each tick within a session
      const d = new Date();
      stats.hourActivity[d.getHours()] = (stats.hourActivity[d.getHours()] || 0) + tickElapsed;
      stats.weekdayActivity[d.getDay()] = (stats.weekdayActivity[d.getDay()] || 0) + tickElapsed;
    }

    stats.lastUpdated = new Date(now).toISOString();
    rebuildSortedLists(stats);
    set({ stats: { ...stats } });
  },

  resetStats: async () => {
    const fresh = createEmptyStats();
    await idbSet(STATS_KEY, fresh);
    set({ stats: fresh });
  },

  totalHours: () => {
    const hours = get().stats.totalSeconds / 3600;
    return hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(get().stats.totalSeconds / 60)}m`;
  },

  topTracks: (limit = 10) => {
    const { stats } = get();
    return stats.topTrackIds.slice(0, limit).map(trackId => ({
      trackId,
      seconds: stats.trackTime[trackId] || 0,
    }));
  },

  topArtistsList: (limit = 10) => {
    const { stats } = get();
    return stats.topArtists.slice(0, limit).map(name => ({
      name,
      seconds: stats.artistTime[name] || 0,
    }));
  },

  todaySeconds: () => {
    return get().stats.totalSeconds; // Approximate — in a real impl we'd track per-day
  },

  thisWeekSeconds: () => {
    return get().stats.totalSeconds; // Same approximation
  },
}));

function rebuildSortedLists(stats: ListeningStats): void {
  stats.topTrackIds = Object.entries(stats.trackTime)
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => Number(id));

  stats.topArtists = Object.entries(stats.artistTime)
    .sort(([, a], [, b]) => b - a)
    .map(([name]) => name);
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistStats(stats: ListeningStats): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    idbSet(STATS_KEY, stats).catch(() => {});
  }, 1000);
}
