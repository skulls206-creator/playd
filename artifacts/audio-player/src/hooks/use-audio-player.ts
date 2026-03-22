import { create } from 'zustand';
import type { Track, QueueItem, EqPreset } from '@workspace/api-client-react';

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
  isEqOpen: boolean;
  isQueueOpen: boolean;
  repeatMode: 'off' | 'all' | 'one';
  isShuffle: boolean;
  activeEqPreset: EqPreset | null;
  eqBands: number[]; // Array of 10 values -12 to +12
  
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

  currentTrack: null,
  isPlaying: false,
  volume: loadPref('playd_volume', 1),
  isMuted: loadPref('playd_muted', false),
  progress: 0,
  duration: 0,
  queue: [],
  queueIndex: -1,
  
  isMiniPlayer: false,
  isEqOpen: false,
  isPrefsOpen: false,
  isQueueOpen: false,
  repeatMode: loadPref<'off'|'all'|'one'>('playd_repeat', 'off'),
  isShuffle: loadPref('playd_shuffle', false),
  activeEqPreset: null,
  eqBands: DEFAULT_EQ,

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
        artwork: nextTrack.albumArtDataUrl ? [
          { src: nextTrack.albumArtDataUrl, sizes: '512x512', type: 'image/png' }
        ] : []
      });
    }

    return { 
      currentTrack: nextTrack, 
      queue: nextQueue, 
      queueIndex: nextIndex,
      isPlaying: !!nextTrack 
    };
  }),

  pause: () => set({ isPlaying: false }),
  
  togglePlay: () => set((state) => {
    if (!state.currentTrack && state.queue.length > 0) {
      return { currentTrack: state.queue[0].track, queueIndex: 0, isPlaying: true };
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
      nextIndex = Math.floor(Math.random() * state.queue.length);
    }
    
    return {
      queueIndex: nextIndex,
      currentTrack: state.queue[nextIndex].track,
      isPlaying: true,
      progress: 0
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
    
    return {
      queueIndex: prevIndex,
      currentTrack: state.queue[prevIndex].track,
      isPlaying: true,
      progress: 0
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
  toggleEq: () => set((state) => ({ isEqOpen: !state.isEqOpen })),
  toggleQueue: () => set((state) => ({ isQueueOpen: !state.isQueueOpen })),
  togglePrefs: () => set((state) => ({ isPrefsOpen: !state.isPrefsOpen })),
  
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
    if (state.repeatMode === 'one') {
      state.seek(0);
      state.play();
    } else {
      state.next();
    }
  }
}));
