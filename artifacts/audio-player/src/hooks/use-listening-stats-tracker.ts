/**
 * useListeningStatsTracker — wires the listening stats store to playback state.
 *
 * Runs a tick every 5 seconds while a track is playing to accumulate time.
 * Starts a new session on track change, ends on pause/stop.
 */

import { useEffect, useRef } from 'react';
import { useAudioPlayer } from './use-audio-player';
import { useListeningStats } from '@/lib/listening-stats';

const TICK_INTERVAL_MS = 5000; // every 5 seconds

export function useListeningStatsTracker() {
  const currentTrack = useAudioPlayer((s) => s.currentTrack);
  const isPlaying = useAudioPlayer((s) => s.isPlaying);
  const { load, startSession, endSession, tickSession } = useListeningStats();
  const prevTrackId = useRef<number | null>(null);
  const prevPlaying = useRef<boolean>(false);
  const initialized = useRef(false);

  // Load stats once on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    load();
  }, [load]);

  // Track the running session — 5-second tick
  useEffect(() => {
    if (!isPlaying) return;

    const id = setInterval(() => {
      tickSession();
    }, TICK_INTERVAL_MS);

    return () => clearInterval(id);
  }, [isPlaying, tickSession]);

  // Track changes: start new session or end current one
  useEffect(() => {
    if (!initialized.current) return;

    if (isPlaying && currentTrack) {
      if (prevTrackId.current !== currentTrack.id) {
        // Track changed while playing — start new session
        startSession(currentTrack);
        prevTrackId.current = currentTrack.id;
      }
    } else if (!isPlaying && prevPlaying.current) {
      // Was playing, now paused — end session
      endSession();
    }

    prevPlaying.current = isPlaying;
  }, [isPlaying, currentTrack, startSession, endSession]);

  // End session on unmount
  useEffect(() => {
    return () => {
      endSession();
    };
  }, [endSession]);
}
