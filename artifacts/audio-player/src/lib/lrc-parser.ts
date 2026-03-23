export interface LyricLine {
  timeSec: number;
  text: string;
}

const TS_RE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const METADATA_RE = /^\[(?:ar|al|ti|by|offset|re|ve):.+\]$/i;

/**
 * Parse an LRC string into an array of timed lyric lines.
 *
 * Handles:
 *   - Standard [mm:ss.xx] timestamps (one or many per source line)
 *   - LRC metadata tags (skipped)
 *   - Plain / unsynced text fallback: returns lines with timeSec = 0, isSynced = false
 */
export function parseLrc(raw: string): { lines: LyricLine[]; isSynced: boolean } {
  const rawLines = raw.replace(/\r\n?/g, '\n').split('\n');
  const synced: LyricLine[] = [];
  let hasTimes = false;

  for (const rawLine of rawLines) {
    const timestamps: number[] = [];
    let m: RegExpExecArray | null;

    TS_RE.lastIndex = 0;
    while ((m = TS_RE.exec(rawLine)) !== null) {
      const mins = parseInt(m[1], 10);
      const secs = parseInt(m[2], 10);
      // centiseconds or hundredths – normalise to two digits then divide
      const frac = m[3] ? parseInt(m[3].padEnd(2, '0').slice(0, 2), 10) / 100 : 0;
      timestamps.push(mins * 60 + secs + frac);
      hasTimes = true;
    }

    const text = rawLine.replace(TS_RE, '').trim();

    // Skip blank lines and metadata-only lines
    if (timestamps.length === 0) continue;

    for (const t of timestamps) {
      synced.push({ timeSec: t, text });
    }
  }

  // Sort by timestamp
  synced.sort((a, b) => a.timeSec - b.timeSec);

  if (hasTimes) {
    return { lines: synced, isSynced: true };
  }

  // Fallback: plain unsynced text
  const plain = rawLines
    .map(l => l.trim())
    .filter(l => l.length > 0 && !METADATA_RE.test(l))
    .map(text => ({ timeSec: 0, text }));

  return { lines: plain, isSynced: false };
}
