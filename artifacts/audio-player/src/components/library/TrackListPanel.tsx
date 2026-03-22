import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useListTracks, getListTracksQueryKey, customFetch } from '@workspace/api-client-react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';
import { useQueryClient } from '@tanstack/react-query';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronUp, ChevronDown, Music, Pause, Play, Menu, FolderOpen, Trash2, X, FolderInput } from 'lucide-react';
import { clsx } from 'clsx';
import { TrackContextMenu } from './TrackContextMenu';
import type { Track } from '@workspace/api-client-react';

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
  const [isActive, setIsActive] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    setIsActive(true);
    const startX = e.clientX;
    const startW = colWidths[col];

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newW = Math.max(COL_MIN[col], startW + ev.clientX - startX);
      setColWidths(prev => ({ ...prev, [col]: newW }));
    };

    const onUp = (ev: MouseEvent) => {
      dragging.current = false;
      setIsActive(false);
      const newW = Math.max(COL_MIN[col], startW + ev.clientX - startX);
      localStorage.setItem(COL_LS[col], String(newW));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [col, colWidths, setColWidths]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    const touch = e.touches[0];
    dragging.current = true;
    setIsActive(true);
    const startX = touch.clientX;
    const startW = colWidths[col];

    const onTouchMove = (ev: TouchEvent) => {
      if (!dragging.current) return;
      ev.preventDefault();
      const t = ev.touches[0];
      const newW = Math.max(COL_MIN[col], startW + t.clientX - startX);
      setColWidths(prev => ({ ...prev, [col]: newW }));
    };

    const onTouchEnd = (ev: TouchEvent) => {
      dragging.current = false;
      setIsActive(false);
      const t = ev.changedTouches[0];
      const newW = Math.max(COL_MIN[col], startW + t.clientX - startX);
      localStorage.setItem(COL_LS[col], String(newW));
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }, [col, colWidths, setColWidths]);

  return (
    <div
      className="absolute right-0 top-0 h-full w-[20px] cursor-col-resize touch-none group/handle flex items-center justify-center z-10"
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      title="Drag to resize column"
    >
      {/* Visible divider line — always shown, brightens on hover/drag */}
      <div className={clsx(
        'transition-all duration-150 rounded-full',
        isActive
          ? 'w-[2px] h-full bg-primary shadow-[0_0_6px_1px_hsl(var(--primary)/0.7)]'
          : 'w-[1px] h-full bg-white/20 group-hover/handle:w-[2px] group-hover/handle:h-full group-hover/handle:bg-primary/80 group-hover/handle:shadow-[0_0_5px_1px_hsl(var(--primary)/0.5)]',
      )} />
      {/* Gripper dots — appear on hover to signal draggability */}
      <div className="absolute flex flex-col gap-[3px] opacity-0 group-hover/handle:opacity-100 transition-opacity pointer-events-none">
        {[0,1,2].map(i => (
          <div key={i} className="w-[3px] h-[3px] rounded-full bg-primary/90" />
        ))}
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────
interface TrackListPanelProps {
  onMenuOpen?: () => void;
}

export function TrackListPanel({ onMenuOpen }: TrackListPanelProps = {}) {
  const { data: allTracks = [] } = useListTracks();
  const { currentTrack, isPlaying, play, togglePlay, setQueue, addToQueueEnd, libraryFilter, setLibraryFilter } = useAudioPlayer();
  const { isScanning, scanProgress, scanStatus, scanFileList, importDroppedItems } = useFileSystem();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const mobileFilesInputRef = useRef<HTMLInputElement>(null);

  const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) await scanFileList(files);
    e.target.value = '';
  };
  const queryClient = useQueryClient();

  const [clearConfirm, setClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // ── Multi-select ────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const lastClickedIdxRef = useRef<number>(-1);

  // ── Drag-drop ────────────────────────────────────────────────────────────
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleRescan = () => {
    // Feature-detect webkitdirectory support — works on desktop AND Android Chrome.
    // Only falls back to plain file picker on browsers that truly don't support it (e.g. iOS Safari).
    const probe = document.createElement('input');
    probe.type = 'file';
    if ('webkitdirectory' in probe) {
      folderInputRef.current?.click();
    } else {
      mobileFilesInputRef.current?.click();
    }
  };

  const handleClearLibrary = async () => {
    if (!clearConfirm) { setClearConfirm(true); setTimeout(() => setClearConfirm(false), 3000); return; }
    setClearConfirm(false);
    setIsClearing(true);
    try {
      await customFetch('/api/tracks/local', { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });
      setSelectedIds(new Set());
    } finally {
      setIsClearing(false);
    }
  };

  const [sortCol, setSortColRaw] = useState<SortCol>(
    () => (localStorage.getItem('playd_sortCol') as SortCol | null) ?? 'artist'
  );
  const [sortDir, setSortDirRaw] = useState<SortDir>(
    () => (localStorage.getItem('playd_sortDir') as SortDir | null) ?? 'asc'
  );
  const [colWidths, setColWidths] = useState(loadColWidths);

  // Detect narrow mobile portrait — hides Artist/Album/Year, lets Title flex
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

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
      const secondary = (x: Track, y: Track) => {
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

  const playRow = useCallback((track: Track, idx: number) => {
    const queue = sorted.map((t, i) => ({ id: i, trackId: t.id, position: i, track: t }));
    setQueue(queue);
    play(track, queue, idx);
  }, [sorted, setQueue, play]);

  // ── Click handler with multi-select ─────────────────────────────────────
  const handleRowClick = useCallback((e: React.MouseEvent, track: Track, idx: number) => {
    if (e.metaKey || e.ctrlKey) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(track.id)) next.delete(track.id);
        else next.add(track.id);
        return next;
      });
    } else if (e.shiftKey && lastClickedIdxRef.current >= 0) {
      const from = Math.min(lastClickedIdxRef.current, idx);
      const to   = Math.max(lastClickedIdxRef.current, idx);
      setSelectedIds(new Set(sorted.slice(from, to + 1).map(t => t.id)));
    } else {
      setSelectedIds(new Set([track.id]));
    }
    lastClickedIdxRef.current = idx;
  }, [sorted]);

  // ── Drag-and-drop handlers ───────────────────────────────────────────────
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (e.dataTransfer.items.length > 0) {
      await importDroppedItems(e.dataTransfer.items);
      queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });
    }
  };

  // ── Computed selection data ──────────────────────────────────────────────
  const selectedTracks = useMemo(
    () => sorted.filter(t => selectedIds.has(t.id)),
    [sorted, selectedIds]
  );
  const selectionDuration = selectedTracks.reduce((s, t) => s + (t.duration ?? 0), 0);
  const totalDuration = sorted.reduce((s, t) => s + (t.duration ?? 0), 0);

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <span className="w-3 inline-block" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 inline ml-0.5 text-primary" />
      : <ChevronDown className="w-3 h-3 inline ml-0.5 text-primary" />;
  };

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
    <div
      className="flex-1 flex flex-col overflow-hidden bg-background min-w-0 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Desktop: folder picker (webkitdirectory, unsupported on mobile) */}
      <input
        ref={folderInputRef}
        type="file"
        style={{ display: 'none' }}
        {...{ webkitdirectory: '', multiple: true } as any}
        onChange={handleFolderInputChange}
      />
      {/* Mobile: plain audio file picker — webkitdirectory doesn't work on mobile browsers */}
      <input
        ref={mobileFilesInputRef}
        type="file"
        style={{ display: 'none' }}
        accept="audio/*,.mp3,.flac,.ogg,.opus,.m4a,.wav,.aiff,.aac,.wma"
        multiple
        onChange={handleFolderInputChange}
      />

      {/* ── Drag-over overlay ──────────────────────────────────────────────── */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/70 border-2 border-dashed border-emerald-500/70 rounded pointer-events-none">
          <FolderInput className="w-10 h-10 text-emerald-400 mb-2" />
          <p className="text-sm text-emerald-300 font-medium">Drop music folders or files to import</p>
        </div>
      )}

      {/* ── Action toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 h-8 border-b border-border bg-black/20 shrink-0">
        {/* Mobile hamburger */}
        {onMenuOpen && (
          <button
            className="sm:hidden mr-1 text-muted-foreground hover:text-foreground transition-colors"
            onClick={onMenuOpen}
            title="Open library"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}

        {/* Refresh Folders */}
        <button
          onClick={handleRescan}
          disabled={isScanning}
          title="Add folder to import music"
          className={clsx(
            'flex items-center gap-1 px-2 h-5 rounded text-[10px] transition-colors shrink-0',
            isScanning
              ? 'text-primary/50 cursor-not-allowed'
              : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
          )}
        >
          <FolderOpen className="w-3 h-3" />
          <span>{isScanning ? 'Importing…' : 'Add Folder'}</span>
        </button>

        {/* Active filter label + scan status (always visible side-by-side) */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {libraryFilter.type !== 'all' ? (
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[10px] text-primary/80">{libraryFilter.label}</span>
              <button
                onClick={() => setLibraryFilter({ type: 'all', value: '', label: 'All Songs' })}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Show all songs"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <span className="text-[10px] text-muted-foreground/50 shrink-0">All Songs</span>
          )}
          {isScanning ? (
            <span className="text-[10px] text-emerald-400 truncate">
              Scanning… {scanProgress > 0 ? `${scanProgress} found` : ''}
            </span>
          ) : scanStatus ? (
            <span className={clsx(
              'text-[10px] truncate font-medium',
              scanStatus.startsWith('✓') ? 'text-emerald-400' : 'text-red-400',
            )}>
              {scanStatus}
            </span>
          ) : null}
        </div>

        {/* Clear Library */}
        <button
          onClick={handleClearLibrary}
          disabled={isClearing}
          title={clearConfirm ? 'Click again to confirm clear' : 'Clear local library'}
          className={clsx(
            'flex items-center gap-1 px-2 h-5 rounded text-[10px] transition-colors shrink-0',
            clearConfirm
              ? 'text-red-400 bg-red-950/40 hover:bg-red-950/60'
              : 'text-muted-foreground hover:text-red-400 hover:bg-white/5',
            isClearing && 'opacity-50 cursor-not-allowed',
          )}
        >
          <Trash2 className="w-3 h-3" />
          <span className="hidden sm:inline">{clearConfirm ? 'Confirm?' : 'Clear'}</span>
        </button>
      </div>

      {/* Horizontally scrollable area — column headers + track rows scroll together */}
      <div className="flex-1 overflow-x-auto flex flex-col min-w-0">

        {/* Column headers */}
        <div
          className="flex items-center px-3 h-8 border-b border-border bg-black/30 shrink-0 select-none"
          style={isMobile ? undefined : { minWidth: 228 + colWidths.title + colWidths.artist + colWidths.album }}
        >
          <div className="w-10 shrink-0 text-right pr-2">
            <ColHeader col="trackNumber" label="#" extraClass="justify-end" />
          </div>
          {/* Title — flex-1 on mobile, fixed-resizable on desktop */}
          <div
            className={isMobile ? 'flex-1 min-w-0 relative pr-3' : 'relative shrink-0 pr-3'}
            style={isMobile ? undefined : { width: colWidths.title }}
          >
            <ColHeader col="title" label="Title" />
            {!isMobile && <ResizeHandle col="title" colWidths={colWidths} setColWidths={setColWidths} />}
          </div>
          {/* Artist — desktop only */}
          {!isMobile && (
            <div className="relative shrink-0 pr-4" style={{ width: colWidths.artist }}>
              <ColHeader col="artist" label="Artist" />
              <ResizeHandle col="artist" colWidths={colWidths} setColWidths={setColWidths} />
            </div>
          )}
          {/* Album — desktop only */}
          {!isMobile && (
            <div className="relative shrink-0 pr-4" style={{ width: colWidths.album }}>
              <ColHeader col="album" label="Album" />
              <ResizeHandle col="album" colWidths={colWidths} setColWidths={setColWidths} />
            </div>
          )}
          {/* Year — desktop only */}
          {!isMobile && (
            <div className="w-14 shrink-0 text-right pr-4">
              <ColHeader col="year" label="Year" extraClass="justify-end" />
            </div>
          )}
          {/* Duration — always visible */}
          <div className="w-12 shrink-0 text-right">
            <ColHeader col="duration" label="Time" extraClass="justify-end" />
          </div>
        </div>

        {/* Track rows */}
        <ScrollArea className="flex-1">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
              <Music className="w-10 h-10 opacity-20" />
              <p className="text-sm">No tracks yet — drop a folder here, or add one in Preferences</p>
            </div>
          ) : (
            <div style={isMobile ? undefined : { minWidth: 228 + colWidths.title + colWidths.artist + colWidths.album }}>
              {sorted.map((track, idx) => {
                const isCurrent  = currentTrack?.id === track.id;
                const isSelected = selectedIds.has(track.id);
                const isRowPlaying = isCurrent && isPlaying;

                const ctxTracks = isSelected && selectedIds.size > 1 ? selectedTracks : [track];

                return (
                  <TrackContextMenu
                    key={track.id}
                    track={track}
                    selectedTracks={ctxTracks}
                    queueIndex={idx}
                    onPlayNow={() => {
                      setSelectedIds(new Set([track.id]));
                      playRow(track, idx);
                    }}
                    onPlaySelected={() => {
                      if (ctxTracks.length > 1) {
                        const queue = ctxTracks.map((t, i) => ({ id: i, trackId: t.id, position: i, track: t }));
                        setQueue(queue);
                        play(ctxTracks[0], queue, 0);
                      } else {
                        playRow(track, idx);
                      }
                    }}
                    onQueueSelected={() => {
                      ctxTracks.forEach(t => addToQueueEnd(t));
                    }}
                  >
                    <div
                      onDoubleClick={() => {
                        setSelectedIds(new Set([track.id]));
                        playRow(track, idx);
                      }}
                      onClick={(e) => handleRowClick(e, track, idx)}
                      className={clsx(
                        'flex items-center px-3 cursor-default select-none border-b border-border/10 group h-9',
                        isCurrent && isSelected  && 'bg-primary/15 text-primary',
                        isCurrent && !isSelected && 'bg-primary/10 text-primary',
                        !isCurrent && isSelected && 'bg-white/[0.07] text-foreground',
                        !isCurrent && !isSelected && 'text-foreground/80 hover:bg-white/5',
                      )}
                    >
                      {/* # */}
                      <div className="w-10 text-right pr-2 shrink-0 text-[11px] text-muted-foreground font-mono">
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

                      {/* Title — flex-1 on mobile, fixed-width on desktop */}
                      <div
                        className={isMobile ? 'flex-1 min-w-0 pr-3 overflow-hidden' : 'shrink-0 pr-3 overflow-hidden'}
                        style={isMobile ? undefined : { width: colWidths.title }}
                      >
                        <span className={clsx('text-xs truncate block', isCurrent && 'font-semibold text-primary')}>
                          {track.title}
                        </span>
                      </div>

                      {/* Artist — desktop only */}
                      {!isMobile && (
                        <div className="shrink-0 pr-4 overflow-hidden" style={{ width: colWidths.artist }}>
                          <span className="text-xs truncate block text-muted-foreground group-hover:text-foreground/70 transition-colors">
                            {track.artist || '—'}
                          </span>
                        </div>
                      )}

                      {/* Album — desktop only */}
                      {!isMobile && (
                        <div className="shrink-0 pr-4 overflow-hidden" style={{ width: colWidths.album }}>
                          <span className="text-xs truncate block text-muted-foreground/60">
                            {track.album || '—'}
                          </span>
                        </div>
                      )}

                      {/* Year — desktop only */}
                      {!isMobile && (
                        <div className="w-14 shrink-0 text-right pr-4">
                          <span className="text-[11px] font-mono text-muted-foreground/50">
                            {track.year || ''}
                          </span>
                        </div>
                      )}

                      {/* Duration — always visible */}
                      <div className="w-12 shrink-0 text-right">
                        {(track.duration ?? 0) > 0 ? (
                          <span className={clsx(
                            'text-[11px] font-mono',
                            isCurrent ? 'text-primary/80' : 'text-foreground/50',
                          )}>
                            {formatDuration(track.duration!)}
                          </span>
                        ) : (
                          <span className="text-[11px] font-mono text-muted-foreground/30">—</span>
                        )}
                      </div>
                    </div>
                  </TrackContextMenu>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Status bar */}
      <div className="h-6 border-t border-border bg-black/20 flex items-center px-3 gap-4 shrink-0 select-none">
        <span className="text-[10px] text-muted-foreground">
          {selectedIds.size > 0 ? (
            <>{selectedIds.size} selected · {sorted.length} tracks</>
          ) : (
            <>{sorted.length} {sorted.length === 1 ? 'track' : 'tracks'}
              {libraryFilter.type !== 'all' && ` — ${libraryFilter.label}`}</>
          )}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {selectedIds.size > 0
            ? formatDuration(selectionDuration)
            : formatDuration(totalDuration)}
        </span>
      </div>
    </div>
  );
}
