/**
 * Media Session API helpers — manages navigator.mediaSession metadata,
 * artwork, and position state updates.
 *
 * AudioEngine.tsx (off-limits) already registers the basic action handlers
 * (play, pause, previoustrack, nexttrack, seekto). This module fills the
 * gaps: artwork resolution, position state, and stop/seekbackward/seekforward.
 */

import type { LocalTrack } from './track-store';
import { get } from 'idb-keyval';

const ART_STORE_KEY = 'track-art';

async function resolveArtUrl(track: LocalTrack): Promise<string | undefined> {
  if (track.albumArtDataUrl) return track.albumArtDataUrl;
  if (track.source === 'local' && track.fileName && track.folderPath) {
    const store: Record<string, string> | undefined = await get(ART_STORE_KEY);
    return store?.[`${track.folderPath}/${track.fileName}`];
  }
  return undefined;
}

/**
 * Update navigator.mediaSession.metadata for the given track.
 * Resolves artwork from the IndexedDB art store once and sets it.
 */
export async function updateMediaSessionMetadata(
  track: LocalTrack,
  prevTrackIdRef?: { current: number | null },
): Promise<void> {
  if (!('mediaSession' in navigator)) return;

  // Skip if already set for this track (avoids redundant DOM updates)
  if (prevTrackIdRef && prevTrackIdRef.current === track.id) return;
  if (prevTrackIdRef) prevTrackIdRef.current = track.id;

  const artUrl = await resolveArtUrl(track);

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Unknown Title',
      artist: track.artist || 'Unknown Artist',
      album: track.album || 'Unknown Album',
      artwork: artUrl
        ? [
            { src: artUrl, sizes: '512x512', type: 'image/jpeg' },
            { src: artUrl, sizes: '256x256', type: 'image/jpeg' },
          ]
        : [],
    });
  } catch {
    // Some browsers throw if called before user gesture; fail silently.
  }
}

/**
 * Update the lock-screen position state (elapsed time, duration, playback rate).
 * Call this periodically (e.g., every second) while a track is playing.
 */
export function setMediaSessionPositionState(
  duration: number,
  position: number,
  playbackRate: number = 1,
): void {
  if (!('mediaSession' in navigator)) return;
  if (!navigator.mediaSession.setPositionState) return;

  try {
    navigator.mediaSession.setPositionState({
      duration: duration || 0,
      position: position || 0,
      playbackRate,
    });
  } catch {
    // Browsers may throw if duration is 0 or invalid
  }
}

/**
 * Register extra Media Session action handlers that AudioEngine.tsx doesn't set:
 * - stop
 * - seekbackward
 * - seekforward
 *
 * Call once on mount. The caller provides callbacks.
 */
export function registerExtraMediaSessionHandlers(handlers: {
  onStop?: () => void;
  onSeekBackward?: (amount?: number) => void;
  onSeekForward?: (amount?: number) => void;
}): void {
  if (!('mediaSession' in navigator)) return;

  const { onStop, onSeekBackward, onSeekForward } = handlers;

  try {
    navigator.mediaSession.setActionHandler('stop', () => {
      onStop?.();
    });
  } catch {
    // Not supported on all browsers
  }

  try {
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      onSeekBackward?.(details.seekOffset ?? 10);
    });
  } catch {
    // Not supported on all browsers
  }

  try {
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      onSeekForward?.(details.seekOffset ?? 10);
    });
  } catch {
    // Not supported on all browsers
  }
}
