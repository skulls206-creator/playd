import { useState, useEffect } from 'react';
import { get } from 'idb-keyval';
import type { Track } from '@workspace/api-client-react';

const ART_STORE_KEY = 'track-art';

/**
 * Resolves album art for a track.
 * - Local tracks have art stored in IndexedDB (extracted during import).
 * Returns null while loading, then the data URL or null if no art found.
 */
export function useTrackArt(track: Track | null): string | null {
  const [artUrl, setArtUrl] = useState<string | null>(
    track?.albumArtDataUrl ?? null,
  );

  useEffect(() => {
    if (!track) { setArtUrl(null); return; }

    // Subsonic / already-resolved URL
    if (track.albumArtDataUrl) { setArtUrl(track.albumArtDataUrl); return; }

    // Local file — look up from IDB art cache
    if (track.source === 'local' && track.fileName && track.folderPath) {
      const key = `${track.folderPath}/${track.fileName}`;
      get(ART_STORE_KEY).then((store: Record<string, string> | undefined) => {
        setArtUrl(store?.[key] ?? null);
      });
    } else {
      setArtUrl(null);
    }
  }, [track?.id]);

  return artUrl;
}
