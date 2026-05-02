import { create } from 'zustand';
import { get } from 'idb-keyval';
import type { Track, QueueItem, EqPreset } from '@workspace/api-client-react';
import type { LyricLine } from '@/lib/lrc-parser';
import type { YtTrack } from '@/types/yt-track';
import { ytTrackToFakeTrack } from '@/types/yt-track';

/** Resolve currentYtTrack for a track being switched to. Returns YT match or null (clears badge for local tracks). */
function syncYtForTrack(track: Track | null, ytQueue: YtTrack[]): YtTrack | null {
  if (!track || track.source !== 'youtube') return null;
  return ytQueue.find((yt) => yt.videoId === track.fileName) ?? null;
}

/** Monotonic ID generator — avoids Date.now() collisions on rapid clicks. */
let _queueItemIdCounter = Date.now();
function nextQueueItemId(): number {
  _queueItemIdCounter += 1;
  return _queueItemIdCounter;
}

/** Sync localStorage read — used by store actions that change currentTrack. */
function loadLyricsFromStorage(trackId: number): { lyrics: LyricLine[] | null; lyricsTrackId: number | null } {
  try {
    const stored = localStorage.getItem(`playd_lyrics_${trackId}`);
    if (stored) {
      const parsed: LyricLine[] = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return { lyrics: parsed, lyricsTrackId: trackId };
    }
  } catch {}
  return { lyrics: null, lyricsTrackId: null };
}

const ART_STORE_KEY = 'track-art';

async function resolveArtUrl(track: Track): Promise<string | null> {
  if (track.albumArtDataUrl) return track.albumArtDataUrl;
  if (track.source === 'local' && track.fileName && track.folderPath) {
    const store: Record<string, string> | undefined = await get(ART_STORE_KEY);
    return store?.[`${track.folderPath}/${track.fileName}`] ?? null;
  }
  return null;
}

export interface LibraryFilter {
  type: 'all' | 'artist' | 'album' | 'playlist';
  value?: string;
  label?: string;
}

interface PlayerState {
  // Library navigation
  libraryFilter: LibraryFilter;
  setLibraryFilter: (filter: LibraryFilter) => void;

  // Core Playback
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  progress: number;
  duration: number;
  queue: QueueItem[];
  queueIndex: number;
  
  // Modes & Settings
  isMiniPlayer: boolean;
  isCompactMiniPlayer: boolean;
  isEqOpen: boolean;
  isQueueOpen: boolean;
  repeatMode: 'off' | 'all' | 'one';
  isShuffle: boolean;
  activeEqPreset: EqPreset | null;
  eqBands: number[]; // Array of 10 values -12 to +12

  // Crossfade & Visualizer
  crossfadeSec: number;       // 0 = disabled, 1–12 seconds
  setCrossfadeSec: (sec: number) => void;
  showSpectrum: boolean;
  setShowSpectrum: (show: boolean) => void;

  // Sleep Timer
  sleepTimerExpiry: number | null;   // Unix ms — null when inactive
  sleepTimerMode: 'time' | 'track' | null;
  setSleepTimer: (ms: number) => void;
  setSleepTimerEndOfTrack: () => void;
  clearSleepTimer: () => void;

  // ReplayGain
  replaygainEnabled: boolean;
  setReplaygainEnabled: (enabled: boolean) => void;

  // PLAYD+ mode
  playdPlusMode: boolean;
  togglePlaydPlusMode: () => void;

  // PLAYD+ YouTube playback
  playdPlusQueue: YtTrack[];
  currentYtTrack: YtTrack | null;
  setPlaydPlusQueue: (tracks: YtTrack[]) => void;
  playYtTrack: (track: YtTrack, queue?: YtTrack[], index?: number) => void;
  addToYtQueue: (track: YtTrack) => void;
  clearYtPlayback: () => void;

  // Global search
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // Lyrics
  isLyricsOpen: boolean;
  lyrics: LyricLine[] | null;       // lines for the currently loaded track
  lyricsTrackId: number | null;     // Track.id of the loaded lyrics
  toggleLyrics: () => void;
  setLyrics: (trackId: number, lines: LyricLine[]) => void;
  clearLyrics: (trackId: number) => void;
  
  // Actions
  play: (track?: Track, queue?: QueueItem[], startIndex?: number) => void;
  pause: () => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  setQueue: (items: QueueItem[]) => void;
  addToQueueNext: (track: Track) => void;
  addToQueueEnd: (track: Track) => void;
  toggleMiniPlayer: () => void;
  toggleCompactMiniPlayer: () => void;
  toggleEq: () => void;
  toggleQueue: () => void;
  togglePrefs: () => void;
  isPrefsOpen: boolean;
  setRepeatMode: (mode: 'off' | 'all' | 'one') => void;
  toggleShuffle: () => void;
  setEqBand: (index: number, value: number) => void;
  setActiveEqPreset: (preset: EqPreset | null) => void;
  
  // Internal updates
  _setProgress: (time: number) => void;
  _setDuration: (time: number) => void;
  _trackEnded: () => void;
  /** Advance the queue to a specific index — used by crossfade to pin the chosen track. */
  _advanceToIndex: (idx: number) => void;
}

const DEFAULT_EQ = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

function loadPref<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function savePref(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export const useAudioPlayer = create<PlayerState>((set, get) => ({
  libraryFilter: { type: 'all' },
  setLibraryFilter: (filter) => set({ libraryFilter: filter }),

  currentTrack: loadPref<Track | null>('playd_last_track', null),
  isPlaying: false, // never auto-play on restore — requires explicit user action
  volume: loadPref('playd_volume', 1),
  isMuted: loadPref('playd_muted', false),
  progress: 0,
  duration: 0,
  queue: [],
  queueIndex: -1,
  
  isMiniPlayer: false,
  isCompactMiniPlayer: false,
  isEqOpen: false,
  isPrefsOpen: false,
  isQueueOpen: false,
  repeatMode: loadPref<'off'|'all'|'one'>('playd_repeat', 'off'),
  isShuffle: loadPref('playd_shuffle', false),
  activeEqPreset: null,
  eqBands: DEFAULT_EQ,

  crossfadeSec: loadPref('playd_crossfade', 0),
  setCrossfadeSec: (sec) => { savePref('playd_crossfade', sec); set({ crossfadeSec: sec }); },
  showSpectrum: loadPref('playd_spectrum', true),
  setShowSpectrum: (show) => { savePref('playd_spectrum', show); set({ showSpectrum: show }); },

  replaygainEnabled: loadPref('playd_replaygain', false),
  setReplaygainEnabled: (enabled) => { savePref('playd_replaygain', enabled); set({ replaygainEnabled: enabled }); },

  playdPlusMode: loadPref('playd_plus_mode', false),
  togglePlaydPlusMode: () => set((state) => {
    const next = !state.playdPlusMode;
    savePref('playd_plus_mode', next);
    return { playdPlusMode: next };
  }),

  playdPlusQueue: loadPref<YtTrack[]>('playd_plus_queue', []),
  currentYtTrack: loadPref<YtTrack | null>('playd_plus_current', null),
  setPlaydPlusQueue: (tracks) => {
    savePref('playd_plus_queue', tracks);
    set({ playdPlusQueue: tracks });
  },
  playYtTrack: (track, queue, index) => {
    const fakeTrack = ytTrackToFakeTrack(track);
    const finalQueue = queue ?? [track];
    const fakeQueue = finalQueue.map((t, i) => ({
      id: i,
      trackId: ytTrackToFakeTrack(t).id,
      position: i,
      track: ytTrackToFakeTrack(t),
    }));
    const startIdx = index ?? 0;
    savePref('playd_plus_queue', finalQueue);
    savePref('playd_plus_current', track);
    set({ playdPlusQueue: finalQueue, currentYtTrack: track });
    get().play(fakeTrack, fakeQueue, startIdx);
  },
  addToYtQueue: (track) => set((state) => {
    const fakeTrack = ytTrackToFakeTrack(track);
    const newPlaydPlus = [...state.playdPlusQueue, track];
    savePref('playd_plus_queue', newPlaydPlus);
    const newItem: QueueItem = {
      id: nextQueueItemId(),
      trackId: fakeTrack.id,
      position: state.queue.length,
      track: fakeTrack as Track,
    };
    return { playdPlusQueue: newPlaydPlus, queue: [...state.queue, newItem] };
  }),
  clearYtPlayback: () => {
    savePref('playd_plus_queue', []);
    savePref('playd_plus_current', null);
    set({ playdPlusQueue: [], currentYtTrack: null });
  },

  // Sleep Timer — restore from localStorage, discarding expired timestamps
  sleepTimerExpiry: (() => {
    const stored = loadPref<number | null>('playd_sleep_timer_expiry', null);
    return stored && stored > Date.now() ? stored : null;
  })(),
  sleepTimerMode: (() => {
    const stored = loadPref<'time' | 'track' | null>('playd_sleep_timer_mode', null);
    const expiry = loadPref<number | null>('playd_sleep_timer_expiry', null);
    // Discard 'time' mode if expiry has already passed
    if (stored === 'time' && (!expiry || expiry <= Date.now())) return null;
    return stored;
  })(),
  setSleepTimer: (ms) => {
    const expiry = Date.now() + ms;
    savePref('playd_sleep_timer_expiry', expiry);
    savePref('playd_sleep_timer_mode', 'time');
    set({ sleepTimerExpiry: expiry, sleepTimerMode: 'time' });
  },
  setSleepTimerEndOfTrack: () => {
    savePref('playd_sleep_timer_expiry', null);
    savePref('playd_sleep_timer_mode', 'track');
    set({ sleepTimerExpiry: null, sleepTimerMode: 'track' });
  },
  clearSleepTimer: () => {
    savePref('playd_sleep_timer_expiry', null);
    savePref('playd_sleep_timer_mode', null);
    set({ sleepTimerExpiry: null, sleepTimerMode: null });
  },

  // Lyrics — initial state; hydrated per-track by LyricsPanel
  isLyricsOpen: false,
  lyrics: null,
  lyricsTrackId: null,
  setLyrics: (trackId, lines) => {
    if (lines.length > 0) {
      try { localStorage.setItem(`playd_lyrics_${trackId}`, JSON.stringify(lines)); } catch {}
      set({ lyrics: lines, lyricsTrackId: trackId });
    } else {
      try { localStorage.removeItem(`playd_lyrics_${trackId}`); } catch {}
      set({ lyrics: null, lyricsTrackId: null });
    }
  },
  clearLyrics: (trackId) => {
    try { localStorage.removeItem(`playd_lyrics_${trackId}`); } catch {}
    set((state) => state.lyricsTrackId === trackId ? { lyrics: null, lyricsTrackId: null } : {});
  },

  play: (track, newQueue, startIndex) => set((state) => {
    const nextQueue = newQueue || state.queue;
    let nextIndex = startIndex !== undefined ? startIndex : state.queueIndex;
    let nextTrack = track || state.currentTrack;

    if (!nextTrack && nextQueue.length > 0) {
      nextIndex = 0;
      nextTrack = nextQueue[0].track;
    }

    if (nextTrack && 'mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: nextTrack.title,
        artist: nextTrack.artist,
        album: nextTrack.album,
        artwork: [],
      });
      resolveArtUrl(nextTrack).then(url => {
        if (url && navigator.mediaSession.metadata) {
          navigator.mediaSession.metadata.artwork = [
            { src: url, sizes: '512x512', type: 'image/jpeg' },
          ];
        }
      });
    }

    const lyricsState = nextTrack ? loadLyricsFromStorage(nextTrack.id) : { lyrics: null, lyricsTrackId: null };
    savePref('playd_last_track', nextTrack);
    return { 
      currentTrack: nextTrack, 
      queue: nextQueue, 
      queueIndex: nextIndex,
      isPlaying: !!nextTrack,
      ...lyricsState,
    };
  }),

  pause: () => set({ isPlaying: false }),
  
  togglePlay: () => set((state) => {
    if (!state.currentTrack && state.queue.length > 0) {
      const firstTrack = state.queue[0].track;
      return { currentTrack: firstTrack, queueIndex: 0, isPlaying: true, ...loadLyricsFromStorage(firstTrack.id) };
    }
    return { isPlaying: !state.isPlaying };
  }),

  next: () => set((state) => {
    if (state.queue.length === 0) return state;
    
    let nextIndex = state.queueIndex + 1;
    if (nextIndex >= state.queue.length) {
      if (state.repeatMode === 'all') nextIndex = 0;
      else return { isPlaying: false, progress: 0 }; // End of queue
    }
    
    if (state.isShuffle) {
      const cur = state.queueIndex;
      if (state.queue.length > 1) {
        do { nextIndex = Math.floor(Math.random() * state.queue.length); } while (nextIndex === cur);
      } else {
        nextIndex = 0;
      }
    }
    
    const nextTrackN = state.queue[nextIndex].track;
    savePref('playd_last_track', nextTrackN);
    const nextYt = syncYtForTrack(nextTrackN, state.playdPlusQueue);
    savePref('playd_plus_current', nextYt);
    return {
      queueIndex: nextIndex,
      currentTrack: nextTrackN,
      currentYtTrack: nextYt,
      isPlaying: true,
      progress: 0,
      ...loadLyricsFromStorage(nextTrackN.id),
    };
  }),

  prev: () => set((state) => {
    if (state.progress > 3) {
      // Seek to start if we're past 3 seconds
      return { progress: 0 };
    }
    
    if (state.queue.length === 0) return state;
    
    let prevIndex = state.queueIndex - 1;
    if (prevIndex < 0) {
      if (state.repeatMode === 'all') prevIndex = state.queue.length - 1;
      else prevIndex = 0;
    }
    
    const prevTrack = state.queue[prevIndex].track;
    savePref('playd_last_track', prevTrack);
    const prevYt = syncYtForTrack(prevTrack, state.playdPlusQueue);
    savePref('playd_plus_current', prevYt);
    return {
      queueIndex: prevIndex,
      currentTrack: prevTrack,
      currentYtTrack: prevYt,
      isPlaying: true,
      progress: 0,
      ...loadLyricsFromStorage(prevTrack.id),
    };
  }),

  seek: (time) => set({ progress: time }),
  setVolume: (vol) => {
    savePref('playd_volume', vol);
    savePref('playd_muted', vol === 0);
    set({ volume: vol, isMuted: vol === 0 });
  },
  toggleMute: () => set((state) => {
    savePref('playd_muted', !state.isMuted);
    return { isMuted: !state.isMuted };
  }),
  setQueue: (items) => set({ queue: items }),

  addToQueueNext: (track) => set((state) => {
    const insertAt = state.queueIndex + 1;
    const newItem: QueueItem = { id: Date.now(), trackId: track.id, position: insertAt, track };
    const before = state.queue.slice(0, insertAt);
    const after  = state.queue.slice(insertAt);
    const newQueue = [...before, newItem, ...after].map((qi, i) => ({ ...qi, position: i }));
    return { queue: newQueue };
  }),

  addToQueueEnd: (track) => set((state) => {
    const newItem: QueueItem = { id: Date.now(), trackId: track.id, position: state.queue.length, track };
    return { queue: [...state.queue, newItem] };
  }),
  
  toggleMiniPlayer: () => set((state) => ({ isMiniPlayer: !state.isMiniPlayer })),
  toggleCompactMiniPlayer: () => set((state) => ({ isCompactMiniPlayer: !state.isCompactMiniPlayer })),
  toggleEq: () => set((state) => ({ isEqOpen: !state.isEqOpen })),
  toggleQueue: () => set((state) => ({ isQueueOpen: !state.isQueueOpen })),
  togglePrefs: () => set((state) => ({ isPrefsOpen: !state.isPrefsOpen })),
  toggleLyrics: () => set((state) => ({ isLyricsOpen: !state.isLyricsOpen })),

  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
  
  setRepeatMode: (mode) => { savePref('playd_repeat', mode); set({ repeatMode: mode }); },
  toggleShuffle: () => set((state) => {
    savePref('playd_shuffle', !state.isShuffle);
    return { isShuffle: !state.isShuffle };
  }),
  
  setEqBand: (index, value) => set((state) => {
    const newBands = [...state.eqBands];
    newBands[index] = value;
    return { eqBands: newBands, activeEqPreset: null };
  }),
  
  setActiveEqPreset: (preset) => set({ 
    activeEqPreset: preset, 
    eqBands: preset ? JSON.parse(preset.bands) : DEFAULT_EQ 
  }),

  _setProgress: (time) => set({ progress: time }),
  _setDuration: (time) => set({ duration: time }),
  _trackEnded: () => {
    const state = get();
    // End-of-track sleep timer: pause and clear before advancing
    if (state.sleepTimerMode === 'track') {
      state.pause();
      state.clearSleepTimer();
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('PLAYD', { body: 'Sleep timer ended — playback stopped.' });
      }
      return;
    }
    if (state.repeatMode === 'one') {
      state.seek(0);
      state.play();
    } else {
      state.next();
    }
  },
  _advanceToIndex: (idx) => set((state) => {
    if (idx < 0 || idx >= state.queue.length) return { isPlaying: false, progress: 0 };
    const advTrack = state.queue[idx].track;
    savePref('playd_last_track', advTrack);
    const advYt = syncYtForTrack(advTrack, state.playdPlusQueue);
    savePref('playd_plus_current', advYt);
    return {
      queueIndex: idx,
      currentTrack: advTrack,
      currentYtTrack: advYt,
      isPlaying: true,
      progress: 0,
      ...loadLyricsFromStorage(advTrack.id),
    };
  }),
}));
