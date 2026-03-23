export interface LyricLine {
  timeSec: number;
  text: string;
}

const TS_RE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const METADATA_RE = /^\[(?:ar|al|ti|by|offset|re|ve|length):.+\]$/i;

/**
 * Parse an LRC string into an array of timed lyric lines, sorted by timeSec.
 *
 * Handles:
 *   - Standard [mm:ss.xx] / [mm:ss:xx] timestamps
 *   - Multiple timestamps on one source line → multiple output entries with the same text
 *   - Continuation lines (no timestamp, not metadata) → appended to the previous entry's text
 *   - LRC metadata tags (ar/al/ti/by/offset/re/ve/length) — skipped
 *   - Plain / unsynced text fallback → all lines returned with timeSec = 0
 */
export function parseLrc(raw: string): LyricLine[] {
  const rawLines = raw.replace(/\r\n?/g, '\n').split('\n');
  const synced: LyricLine[] = [];
  let hasTimes = false;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();

    // Skip blank lines and metadata-only lines
    if (!trimmed || METADATA_RE.test(trimmed)) continue;

    const timestamps: number[] = [];
    let m: RegExpExecArray | null;

    TS_RE.lastIndex = 0;
    while ((m = TS_RE.exec(rawLine)) !== null) {
      const mins = parseInt(m[1], 10);
      const secs = parseInt(m[2], 10);
      // Normalise fractional part: could be centiseconds (.xx) or hundredths
      const frac = m[3] ? parseInt(m[3].padEnd(2, '0').slice(0, 2), 10) / 100 : 0;
      timestamps.push(mins * 60 + secs + frac);
      hasTimes = true;
    }

    const text = rawLine.replace(TS_RE, '').trim();

    if (timestamps.length > 0) {
      // One entry per timestamp (common LRC pattern: [t1][t2]text)
      for (const t of timestamps) {
        synced.push({ timeSec: t, text });
      }
    } else if (hasTimes && synced.length > 0) {
      // Continuation line in a synced file — append to the previous entry
      const prev = synced[synced.length - 1];
      if (prev.text) {
        prev.text += '\n' + text;
      } else {
        prev.text = text;
      }
    }
    // Lines before any timestamp in a synced file are silently dropped
  }

  if (hasTimes) {
    // Sort by timestamp (multiple timestamps per source line may be out of order)
    return synced.sort((a, b) => a.timeSec - b.timeSec);
  }

  // Fallback: plain unsynced text — return all non-empty lines with timeSec = 0
  return rawLines
    .map(l => l.trim())
    .filter(l => l.length > 0 && !METADATA_RE.test(l))
    .map(text => ({ timeSec: 0, text }));
}

/** Helper: true when the array contains at least one line with a meaningful timestamp. */
export function isLrcSynced(lines: LyricLine[]): boolean {
  return lines.some(l => l.timeSec > 0);
}
