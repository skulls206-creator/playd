export interface M3uEntry {
  path: string;
  title?: string;
  duration?: number;
}

export function parseM3u(content: string): M3uEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: M3uEntry[] = [];
  let extInf: { duration?: number; title?: string } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      if (line.startsWith('#EXTINF:')) {
        const match = line.match(/#EXTINF:\s*(-?\d+\.?\d*)\s*,\s*(.*)/);
        if (match) {
          extInf = {
            duration: parseFloat(match[1]) > 0 ? parseFloat(match[1]) : undefined,
            title: match[2].trim() || undefined,
          };
        }
      }
      continue;
    }
    entries.push({ path: line, ...extInf });
    extInf = null;
  }
  return entries;
}

export function generateM3u(entries: M3uEntry[]): string {
  const lines = ['#EXTM3U'];
  for (const e of entries) {
    const dur = e.duration != null ? e.duration.toFixed(0) : '-1';
    const title = e.title || e.path;
    lines.push(`#EXTINF:${dur},${title}`);
    lines.push(e.path);
  }
  return lines.join('\n');
}

export function downloadBlob(content: string, filename: string) {
  const blob = new Blob([content], { type: 'audio/x-mpegurl' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
