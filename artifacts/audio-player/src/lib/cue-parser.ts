/**
 * CUE sheet parser — parses .cue files into structured data.
 *
 * CUE sheet spec: https://en.wikipedia.org/wiki/Cue_sheet_(computing)
 *
 * Supports:
 * - REM (comments)
 * - PERFORMER, TITLE (album-level)
 * - FILE + TRACK + INDEX (per-track)
 * - FLAGS (DCP, 4CH, PRE, SCMS)
 * - Multiple FILE blocks
 * - INDEX 00 (pregap) — used for offset calculation
 * - CDTEXTFILE (Legacy), CATALOG, etc. (silently consumed)
 *
 * Minimal parsing — extracts what we need for virtual track creation.
 */

export interface CueTrack {
  /** Track number (1-99) */
  number: number;
  /** Track title (from TITLE within TRACK) */
  title: string;
  /** Track performer (from PERFORMER within TRACK, falls back to album-level) */
  performer: string;
  /** Index 01 position in MM:SS:FF (frames = 1/75s) */
  index: number;
  /** Index 00 position (pregap start), 0 if not specified */
  pregapIndex: number;
  /** Flags like DCP, PRE, SCMS */
  flags: string[];
}

export interface CueSheet {
  /** Album title (from TITLE at top level) */
  albumTitle: string;
  /** Album performer (from PERFORMER at top level) */
  albumPerformer: string;
  /** REM GENRE */
  genre: string | null;
  /** REM DATE */
  date: string | null;
  /** REM COMMENT */
  comment: string | null;
  /** Audio file referenced */
  file: {
    fileName: string;
    format: string; // e.g. "WAVE", "MP3", "FLAC"
  };
  /** Track entries */
  tracks: CueTrack[];
  /** Total duration in seconds (calculated from last track's end) */
  totalDuration: number;
}

/**
 * Parse MM:SS:FF (minutes:seconds:frames) into total seconds.
 * Frames are 1/75th of a second (CD standard).
 */
function parseTimestamp(mmssff: string): number {
  const parts = mmssff.split(':');
  if (parts.length < 2 || parts.length > 3) return 0;
  const min = parseInt(parts[0], 10) || 0;
  const sec = parseInt(parts[1], 10) || 0;
  const frames = parts.length === 3 ? (parseInt(parts[2], 10) || 0) : 0;
  return min * 60 + sec + frames / 75;
}

/**
 * Parse a raw CUE sheet text into a CueSheet object.
 * Returns null if parsing fails (no FILE or no TRACKs found).
 */
export function parseCueSheet(cueText: string): CueSheet | null {
  const lines = cueText.split(/\r?\n/);

  let albumTitle = '';
  let albumPerformer = '';
  let genre: string | null = null;
  let date: string | null = null;
  let comment: string | null = null;

  let currentFile: string | null = null;
  let currentFormat: string | null = null;
  let currentTrack: CueTrack | null = null;
  let lastIndex01 = 0;

  const tracks: CueTrack[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('REM ')) {
      // REM comments may contain GENRE, DATE, etc.
      const upper = line.toUpperCase();
      if (upper.startsWith('REM GENRE ')) genre = line.slice(10).trim();
      else if (upper.startsWith('REM DATE ')) date = line.slice(9).trim();
      else if (upper.startsWith('REM COMMENT ')) comment = line.slice(12).trim();
      continue;
    }

    if (line.startsWith('CATALOG ') || line.startsWith('CDTEXTFILE ') ||
        line.startsWith('ISRC ') || line.startsWith('SONGWRITER ')) {
      // Consume but ignore
      continue;
    }

    if (line.startsWith('TITLE ')) {
      const title = extractQuoted(line.slice(6).trim());
      if (currentTrack) {
        currentTrack.title = title;
      } else {
        albumTitle = title;
      }
      continue;
    }

    if (line.startsWith('PERFORMER ')) {
      const performer = extractQuoted(line.slice(10).trim());
      if (currentTrack) {
        currentTrack.performer = performer;
      } else {
        albumPerformer = performer;
      }
      continue;
    }

    if (line.startsWith('FILE ')) {
      // Save current track if exists
      if (currentTrack) {
        tracks.push(currentTrack);
        currentTrack = null;
      }

      const rest = line.slice(5).trim();
      // FILE "filename" FORMAT
      const match = rest.match(/^"([^"]*)"\s+(\S+)/);
      if (match) {
        currentFile = match[1];
        currentFormat = match[2];
      } else {
        // Unquoted filename (rare)
        const spaceIdx = rest.lastIndexOf(' ');
        if (spaceIdx > 0) {
          currentFile = rest.slice(0, spaceIdx);
          currentFormat = rest.slice(spaceIdx + 1);
        }
      }
      lastIndex01 = 0;
      continue;
    }

    if (line.startsWith('TRACK ')) {
      // Save previous track
      if (currentTrack) {
        tracks.push(currentTrack);
      }

      const rest = line.slice(6).trim();
      // TRACK 01 AUDIO / MODE1/2352 etc.
      const numMatch = rest.match(/^(\d+)/);
      if (numMatch) {
        currentTrack = {
          number: parseInt(numMatch[1], 10),
          title: '',
          performer: '',
          index: 0,
          pregapIndex: 0,
          flags: [],
        };
      }
      continue;
    }

    if (line.startsWith('INDEX ')) {
      if (!currentTrack) continue;
      // INDEX 01 00:00:00
      const rest = line.slice(6).trim();
      const parts = rest.split(/\s+/);
      if (parts.length < 2) continue;
      const indexNum = parseInt(parts[0], 10);
      const timestamp = parts.slice(1).join('');

      if (indexNum === 0) {
        currentTrack.pregapIndex = parseTimestamp(timestamp);
      } else if (indexNum === 1) {
        currentTrack.index = parseTimestamp(timestamp);
        lastIndex01 = currentTrack.index;
      }
      continue;
    }

    if (line.startsWith('FLAGS ')) {
      if (currentTrack) {
        currentTrack.flags = line.slice(6).trim().split(/\s+/);
      }
      continue;
    }
  }

  // Flush last track
  if (currentTrack) {
    tracks.push(currentTrack);
  }

  if (!currentFile || tracks.length === 0) return null;

  // Calculate total duration: last track's end = (next track's index - last track's index) + padding
  // Since we don't know the actual audio file duration from CUE alone, we estimate
  // from the last track's index + typical CD gap (2 seconds)
  const lastTrack = tracks[tracks.length - 1];
  const secondLast = tracks.length > 1 ? tracks[tracks.length - 2] : null;
  let totalDuration: number;
  if (tracks.length > 1 && secondLast) {
    // Estimate from gap between last two tracks + 10s padding
    const gap = lastTrack.index - secondLast.index;
    totalDuration = lastTrack.index + Math.max(gap, 30);
  } else {
    totalDuration = lastTrack.index + 30; // +30s padding as estimate
  }

  return {
    albumTitle: albumTitle || 'Unknown Album',
    albumPerformer: albumPerformer || 'Unknown Artist',
    genre,
    date,
    comment,
    file: {
      fileName: currentFile,
      format: currentFormat || 'WAVE',
    },
    tracks,
    totalDuration,
  };
}

/**
 * Extract text between quotes, handling escaped quotes.
 */
function extractQuoted(text: string): string {
  if (text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\"/g, '"');
  }
  return text;
}

/**
 * Generate human-readable track listing string from a parsed CUE sheet.
 */
export function formatCueTracks(cue: CueSheet): string {
  return cue.tracks.map(t => {
    const min = Math.floor(t.index / 60);
    const sec = Math.floor(t.index % 60);
    const timeStr = `${min}:${String(sec).padStart(2, '0')}`;
    return `  ${String(t.number).padStart(2, '0')}. ${timeStr}  ${t.performer} — ${t.title}`;
  }).join('\n');
}

/**
 * Calculate the duration of a specific CUE track in seconds.
 * Uses the next track's index to determine the end boundary.
 */
export function getCueTrackDuration(cue: CueSheet, track: CueTrack): number {
  const idx = cue.tracks.indexOf(track);
  if (idx < 0) return 30; // fallback

  // End = next track's index, or an estimate for the last track
  if (idx < cue.tracks.length - 1) {
    const nextTrack = cue.tracks[idx + 1];
    return Math.max(nextTrack.index - track.index, 30);
  }

  // Last track: estimate by adding typical gap (45s)
  return Math.max(track.index + 45 - track.index, 45);
}

/**
 * Check if a filename is a CUE file.
 */
export function isCueFile(fileName: string): boolean {
  return /\.cue$/i.test(fileName);
}

/**
 * Get the expected audio file name from a CUE's referenced file name.
 * Handles case-insensitive extension matching.
 */
export function resolveCueAudioFileName(cueFile: CueSheet, availableFiles: string[]): string | null {
  const refName = cueFile.file.fileName.toLowerCase();
  // Try exact match
  const exact = availableFiles.find(f => f.toLowerCase() === refName);
  if (exact) return exact;
  // Try with different audio extensions
  const AUDIO_EXTS = ['.flac', '.wav', '.wv', '.ape', '.mp3', '.m4a', '.ogg', '.opus', '.tta', '.tak'];
  for (const ext of AUDIO_EXTS) {
    const stem = refName.replace(/\.\w+$/, '');
    const candidate = availableFiles.find(f => {
      const fLower = f.toLowerCase();
      return fLower === stem + ext || fLower === `${stem}${ext}`;
    });
    if (candidate) return candidate;
  }
  return null;
}
