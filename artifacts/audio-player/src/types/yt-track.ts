export interface YtTrack {
  videoId: string;
  title: string;
  artist: string;
  duration: number | null;
  thumbnail: string | null;
  spotifyId?: string | null;
  source?: 'youtube' | 'spotify';
}

export interface YtHistoryItem {
  id: number;
  query: string;
  createdAt: string;
}

interface TrackLike {
  id: number;
  title: string;
  artist: string;
  album: string;
  year?: number | null;
  genre?: string | null;
  duration: number;
  trackNumber?: number | null;
  fileName: string;
  folderPath: string;
  albumArtDataUrl?: string | null;
  rating: number;
  source: string;
  subsonicId?: string | null;
  subsonicServerId?: number | null;
  replaygainGain?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export function ytTrackToFakeTrack(yt: YtTrack): TrackLike {
  return {
    id: -(Math.abs(hashCode(yt.videoId)) || Date.now()),
    title: yt.title || 'Unknown Title',
    artist: yt.artist || 'Unknown Artist',
    album: yt.source === 'spotify' ? 'Spotify / YouTube' : 'YouTube',
    year: null,
    genre: null,
    duration: yt.duration ?? 0,
    trackNumber: null,
    fileName: yt.videoId,
    folderPath: '__youtube__',
    albumArtDataUrl: yt.thumbnail ?? null,
    rating: 0,
    source: 'youtube',
    subsonicId: yt.spotifyId ?? null,
    subsonicServerId: null,
    replaygainGain: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as TrackLike;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}
