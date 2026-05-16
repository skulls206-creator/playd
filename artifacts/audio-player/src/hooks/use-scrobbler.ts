/**
 * useScrobbler — wire playback state to scrobble service.
 *
 * - On track change: sends "now playing" to Last.fm + ListenBrainz
 * - After threshold (50% of track or 4 min, whichever is shorter):
 *   sends a scrobble (records the play)
 * - Ignores tracks shorter than 30 seconds
 * - Avoids duplicate scrobbles for the same track
 */

import { useEffect, useRef } from 'react';
import { useAudioPlayer } from './use-audio-player';
import { scrobbleNowPlaying, scrobbleTrack, getScrobbleConfig } from '@/lib/scrobble-service';

const MIN_TRACK_DURATION_SEC = 30;

export function useScrobbler() {
  const currentTrack = useAudioPlayer((s) => s.currentTrack);
  const isPlaying = useAudioPlayer((s) => s.isPlaying);
  const progress = useAudioPlayer((s) => s.progress);
  const duration = useAudioPlayer((s) => s.duration);

  const scrobbledTrackRef = useRef<number | null>(null);
  const nowPlayingSentRef = useRef<number | null>(null);
  const enabledRef = useRef(false);

  // Check if scrobbling is enabled on mount
  useEffect(() => {
    getScrobbleConfig().then(cfg => {
      enabledRef.current = (
        (cfg.lastfm.enabled && !!cfg.lastfm.apiKey) ||
        (cfg.listenbrainz.enabled && !!cfg.listenbrainz.userToken)
      );
    });
  }, []);

  // Send "now playing" on track change
  useEffect(() => {
    if (!currentTrack || !enabledRef.current) return;
    if (nowPlayingSentRef.current === currentTrack.id) return;
    if (duration < MIN_TRACK_DURATION_SEC && duration > 0) return;

    nowPlayingSentRef.current = currentTrack.id;

    scrobbleNowPlaying({
      artist: currentTrack.artist || 'Unknown Artist',
      track: currentTrack.title || 'Unknown Track',
      album: currentTrack.album || undefined,
      duration: Math.round(duration || currentTrack.duration || 0),
      trackNumber: currentTrack.trackNumber ?? undefined,
    }).catch(() => {});
  }, [currentTrack?.id, duration]);

  // Send scrobble when enough time has passed
  useEffect(() => {
    if (!currentTrack || !enabledRef.current) return;
    if (scrobbledTrackRef.current === currentTrack.id) return;

    const dur = duration || currentTrack.duration || 0;
    if (dur < MIN_TRACK_DURATION_SEC) return;

    // Scrobble threshold: 50% of track or 4 min, whichever is shorter
    const threshold = Math.min(dur * 0.5, 240);

    if (progress >= threshold) {
      scrobbledTrackRef.current = currentTrack.id;

      scrobbleTrack({
        artist: currentTrack.artist || 'Unknown Artist',
        track: currentTrack.title || 'Unknown Track',
        album: currentTrack.album || undefined,
        duration: Math.round(dur),
        trackNumber: currentTrack.trackNumber ?? undefined,
      }).catch(() => {});
    }
  }, [progress, currentTrack?.id, duration]);

  // Reset scrobble flag on track change
  useEffect(() => {
    if (!currentTrack) return;
    // Reset is handled naturally by the ref-based dedup
  }, [currentTrack?.id]);
}
