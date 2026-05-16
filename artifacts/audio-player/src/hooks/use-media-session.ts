/**
 * useMediaSession — enhances navigator.mediaSession with:
 * 1. Periodic setPositionState() updates (live lock-screen progress)
 * 2. Extra action handlers: stop, seekbackward, seekforward
 * 3. Updates playbackState based on store
 *
 * AudioEngine.tsx (off-limits per AGENTS.md §2.1) already registers:
 * - play, pause, previoustrack, nexttrack, seekto action handlers
 * - playbackState updates on isPlaying change
 *
 * This hook complements those without touching AudioEngine.tsx.
 */

import { useEffect, useRef } from 'react';
import { useAudioPlayer } from './use-audio-player';
import { setMediaSessionPositionState, registerExtraMediaSessionHandlers } from '@/lib/media-session';

const POSITION_UPDATE_INTERVAL_MS = 1000; // every second

export function useMediaSession() {
  const isPlaying = useAudioPlayer((s) => s.isPlaying);
  const progress = useAudioPlayer((s) => s.progress);
  const duration = useAudioPlayer((s) => s.duration);
  const seek = useAudioPlayer((s) => s.seek);
  const pause = useAudioPlayer((s) => s.pause);

  // ── Position state polling ─────────────────────────────────────────────
  // Updates the lock screen with current playback position every second
  // while a track is playing.
  useEffect(() => {
    if (!isPlaying) {
      setMediaSessionPositionState(0, 0, 0);
      return;
    }

    const id = setInterval(() => {
      const state = useAudioPlayer.getState();
      if (!state.isPlaying) return;
      setMediaSessionPositionState(state.duration, state.progress);
    }, POSITION_UPDATE_INTERVAL_MS);

    return () => clearInterval(id);
  }, [isPlaying]);

  // ── Extra action handlers (registered once) ────────────────────────────
  useEffect(() => {
    registerExtraMediaSessionHandlers({
      onStop: () => {
        pause();
      },
      onSeekBackward: (amount = 10) => {
        const state = useAudioPlayer.getState();
        const newTime = Math.max(0, state.progress - amount);
        seek(newTime);
      },
      onSeekForward: (amount = 10) => {
        const state = useAudioPlayer.getState();
        const newTime = Math.min(state.duration, state.progress + amount);
        seek(newTime);
      },
    });
  }, [seek, pause]);

  // ── playbackState sync ────────────────────────────────────────────────
  // AudioEngine.tsx already does this on isPlaying changes, but this ensures
  // the state is also set to 'playing' during initial hydration / track changes.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);
}
