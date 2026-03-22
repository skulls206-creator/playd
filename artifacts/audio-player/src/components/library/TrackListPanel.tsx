import { useState, useMemo, useCallback, useRef } from 'react';
import { useListTracks } from '@workspace/api-client-react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronUp, ChevronDown, Music, Pause, Play } from 'lucide-react';
import { clsx } from 'clsx';

type SortCol = 'trackNumber' | 'title' | 'artist' | 'album' | 'duration' | 'year';
type SortDir = 'asc' | 'desc';

// ─── Column width persistence ────────────────────────────────────────────────
const COL_LS: Record<string, string> = {
  title:  'playd_col_title',
  artist: 'playd_col_artist',
  album:  'playd_col_album',
};
const COL_DEFAULTS = { title: 260, artist: 160, album: 176 };
const COL_MIN      = { title:  80, artist:  60, album:  60 };

function loadColWidths() {
  const load = (k: string, def: number) => {
    const s = localStorage.getItem(k);
    return s ? Math.max(60, parseInt(s, 10)) : def;
  };
  return {
    title:  load(COL_LS.title,  COL_DEFAULTS.title),
    artist: load(COL_LS.artist, COL_DEFAULTS.artist),
    album:  load(COL_LS.album,  COL_DEFAULTS.album),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatDuration(secs: number): string {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function realTrackNumber(n: number | null | undefined): number | null {
  if (n == null || n <= 0) return null;
  return n;
}

// ─── Resize handle ───────────────────────────────────────────────────────────
interface ResizeHandleProps {
  col: 'title' | 'artist' | 'album';
  colWidths: { title: number; artist: number; album: number };
  setColWidths: React.Dispatch<React.SetStateAction<{ title: number; artist: number; album: number }>>;
}

function ResizeHandle({ col, colWidths, setColWidths }: ResizeHandleProps) {
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    const startX = e.clientX;
    const startW = colWidths[col];

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newW = Math.max(COL_MIN[col], startW + ev.clientX - startX);
      setColWidths(prev => ({ ...prev, [col]: newW }));
    };

    const onUp = (ev: MouseEvent) => {
      dragging.current = false;
      const newW = Math.max(COL_MIN[col], startW + ev.clientX - startX);
      localStorage.setItem(COL_LS[col], String(newW));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [col, colWidths, setColWidths]);

  return (
    <div
      className="absolute right-0 top-0 h-full w-[5px] cursor-col-resize group/handle flex items-center justify-center z-10"
      onMouseDown={onMouseDown}
      title="Drag to resize column"
    >
      <div className="w-px h-3/4 bg-border/40 group-hover/handle:bg-primary/60 transition-colors" />
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────
export function TrackListPanel() {
  const { data: allTracks = [] } = useListTracks();
  const { currentTrack, isPlaying, play, togglePlay, setQueue, libraryFilter } = useAudioPlayer();

  const [sortCol, setSortColRaw] = useState<SortCol>(
    () => (localStorage.getItem('playd_sortCol') as SortCol | null) ?? 'artist'
  );
  const [sortDir, setSortDirRaw] = useState<SortDir>(
    () => (localStorage.getItem('playd_sortDir') as SortDir | null) ?? 'asc'
  );
  const [colWidths, setColWidths] = useState(loadColWidths);

  const setSortCol = (col: SortCol) => { localStorage.setItem('playd_sortCol', col); setSortColRaw(col); };
  const setSortDir = (dir: SortDir | ((d: SortDir) => SortDir)) => {
    setSortDirRaw(prev => {
      const next = typeof dir === 'function' ? dir(prev) : dir;
      localStorage.setItem('playd_sortDir', next);
      return next;
    });
  };

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    if (libraryFilter.type === 'all') return allTracks;
    if (libraryFilter.type === 'artist') return allTracks.filter(t => t.artist === libraryFilter.value);
    if (libraryFilter.type === 'album') return allTracks.filter(t => t.album === libraryFilter.value);
    return allTracks;
  }, [allTracks, libraryFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const secondary = (x: any, y: any) => {
        const ar = (x.artist || '').localeCompare(y.artist || '');
        if (ar !== 0) return ar;
        const al = (x.album || '').localeCompare(y.album || '');
        if (al !== 0) return al;
        return (x.trackNumber || 9999) - (y.trackNumber || 9999);
      };
      let cmp = 0;
      switch (sortCol) {
        case 'trackNumber': cmp = ((realTrackNumber(a.trackNumber) ?? 9999) - (realTrackNumber(b.trackNumber) ?? 9999)); break;
        case 'title':       cmp = (a.title || '').localeCompare(b.title || ''); break;
        case 'artist':      cmp = (a.artist || '').localeCompare(b.artist || ''); break;
        case 'album':       cmp = (a.album || '').localeCompare(b.album || ''); break;
        case 'year':        cmp = ((a.year ?? 0) - (b.year ?? 0)); break;
        case 'duration':    cmp = ((a.duration ?? 0) - (b.duration ?? 0)); break;
      }
      if (cmp === 0) return secondary(a, b);
      return cmp * dir;
    });
  }, [filtered, sortCol, sortDir]);

  const playRow = useCallback((track: any, idx: number) => {
    const queue = sorted.map((t, i) => ({ id: i, trackId: t.id, position: i, track: t }));
    setQueue(queue);
    play(track, queue, idx);
  }, [sorted, setQueue, play]);

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <span className="w-3 inline-block" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 inline ml-0.5 text-primary" />
      : <ChevronDown className="w-3 h-3 inline ml-0.5 text-primary" />;
  };

  // Column header button helper
  const ColHeader = ({ col, label, extraClass = '' }: { col: SortCol; label: string; extraClass?: string }) => (
    <button
      className={clsx(
        'flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors w-full',
        sortCol === col && 'text-primary',
        extraClass,
      )}
      onClick={() => handleSort(col)}
    >
      {label}
      <SortIcon col={col} />
    </button>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background min-w-0">
      {/* Column headers */}
      <div className="flex items-center px-3 h-8 border-b border-border bg-black/30 shrink-0 select-none">
        {/* # — fixed */}
        <div className="w-12 shrink-0 text-right pr-3">
          <ColHeader col="trackNumber" label="#" extraClass="justify-end" />
        </div>

        {/* Title — resizable */}
        <div className="relative shrink-0 pr-3" style={{ width: colWidths.title }}>
          <ColHeader col="title" label="Title" />
          <ResizeHandle col="title" colWidths={colWidths} setColWidths={setColWidths} />
        </div>

        {/* Artist — resizable */}
        <div className="relative shrink-0 pr-3" style={{ width: colWidths.artist }}>
          <ColHeader col="artist" label="Artist" />
          <ResizeHandle col="artist" colWidths={colWidths} setColWidths={setColWidths} />
        </div>

        {/* Album — resizable */}
        <div className="relative shrink-0 pr-3" style={{ width: colWidths.album }}>
          <ColHeader col="album" label="Album" />
          <ResizeHandle col="album" colWidths={colWidths} setColWidths={setColWidths} />
        </div>

        {/* Year — fixed */}
        <div className="w-14 shrink-0 text-right pr-3">
          <ColHeader col="year" label="Year" extraClass="justify-end" />
        </div>

        {/* Duration — fixed */}
        <div className="w-14 shrink-0 text-right">
          <ColHeader col="duration" label="Time" extraClass="justify-end" />
        </div>
      </div>

      {/* Track rows */}
      <ScrollArea className="flex-1">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <Music className="w-10 h-10 opacity-20" />
            <p className="text-sm">No tracks yet — add a folder or sync a Subsonic server in Preferences</p>
          </div>
        ) : (
          <div>
            {sorted.map((track, idx) => {
              const isCurrent = currentTrack?.id === track.id;
              const isRowPlaying = isCurrent && isPlaying;
              return (
                <div
                  key={track.id}
                  onClick={() => { if (!isCurrent) playRow(track, idx); }}
                  className={clsx(
                    'flex items-center px-3 h-8 cursor-default select-none border-b border-border/10 group hover:bg-white/5',
                    isCurrent && 'bg-primary/10 text-primary',
                    !isCurrent && 'text-foreground/80',
                  )}
                >
                  {/* # */}
                  <div className="w-12 text-right pr-3 shrink-0 text-[11px] text-muted-foreground font-mono">
                    {isCurrent ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                        className="text-primary hover:text-primary/70 transition-colors flex items-center justify-end w-full"
                        title={isRowPlaying ? 'Pause' : 'Play'}
                      >
                        {isRowPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      </button>
                    ) : (
                      realTrackNumber(track.trackNumber) ?? (idx + 1)
                    )}
                  </div>

                  {/* Title */}
                  <div className="shrink-0 pr-4 overflow-hidden" style={{ width: colWidths.title }}>
                    <span className={clsx('text-xs truncate block', isCurrent && 'font-semibold text-primary')}>
                      {track.title}
                    </span>
                  </div>

                  {/* Artist */}
                  <div className="shrink-0 pr-4 overflow-hidden" style={{ width: colWidths.artist }}>
                    <span className="text-xs truncate block text-muted-foreground group-hover:text-foreground/70 transition-colors">
                      {track.artist}
                    </span>
                  </div>

                  {/* Album */}
                  <div className="shrink-0 pr-4 overflow-hidden" style={{ width: colWidths.album }}>
                    <span className="text-xs truncate block text-muted-foreground/70">
                      {track.album || '—'}
                    </span>
                  </div>

                  {/* Year */}
                  <div className="w-14 shrink-0 text-right pr-4">
                    <span className="text-[11px] font-mono text-muted-foreground/50">
                      {track.year || ''}
                    </span>
                  </div>

                  {/* Duration */}
                  <div className="w-14 shrink-0 text-right">
                    <span className="text-[11px] font-mono text-muted-foreground/70">
                      {formatDuration(track.duration ?? 0)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Status bar */}
      <div className="h-6 border-t border-border bg-black/20 flex items-center px-3 gap-4 shrink-0">
        <span className="text-[10px] text-muted-foreground">
          {sorted.length} {sorted.length === 1 ? 'track' : 'tracks'}
          {libraryFilter.type !== 'all' && ` — ${libraryFilter.label}`}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {formatDuration(sorted.reduce((s, t) => s + (t.duration ?? 0), 0))}
        </span>
      </div>
    </div>
  );
}
