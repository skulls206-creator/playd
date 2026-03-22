import { create } from 'zustand';
import type { Track, QueueItem, EqPreset } from '@workspace/api-client-react';

interface PlayerState {
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
  toggleMiniPlayer: () => void;
  toggleEq: () => void;
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

export const useAudioPlayer = create<PlayerState>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  volume: 1,
  isMuted: false,
  progress: 0,
  duration: 0,
  queue: [],
  queueIndex: -1,
  
  isMiniPlayer: false,
  isEqOpen: false,
  repeatMode: 'off',
  isShuffle: false,
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
  setVolume: (vol) => set({ volume: vol, isMuted: vol === 0 }),
  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),
  setQueue: (items) => set({ queue: items }),
  
  toggleMiniPlayer: () => set((state) => ({ isMiniPlayer: !state.isMiniPlayer })),
  toggleEq: () => set((state) => ({ isEqOpen: !state.isEqOpen })),
  
  setRepeatMode: (mode) => set({ repeatMode: mode }),
  toggleShuffle: () => set((state) => ({ isShuffle: !state.isShuffle })),
  
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
