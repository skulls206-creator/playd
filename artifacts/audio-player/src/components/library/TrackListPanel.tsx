import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTrackStore } from '@/lib/track-store';
import type { LocalTrack } from '@/lib/track-store';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem, getStoredHandlesSync } from '@/hooks/use-file-system';
import { toast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronUp, ChevronDown, Music, Pause, Play, Menu, FolderOpen, Trash2, X, FolderInput, RefreshCw, Lock, Pencil, GripVertical } from 'lucide-react';
import { clsx } from 'clsx';
import { TrackContextMenu } from './TrackContextMenu';
import { TrackEditModal } from './TrackEditModal';

type SortCol = 'trackNumber' | 'title' | 'artist' | 'album' | 'duration' | 'year';
type SortDir = 'asc' | 'desc';

// ─── Column width persistence ────────────────────────────────────────────────
const COL_LS: Record<string, string> = {
  title:  'playd_col_title',
  artist: 'playd_col_artist',
  album:  'playd_col_album',
  year:   'playd_col_year',
};
const COL_DEFAULTS = { title: 260, artist: 160, album: 176, year: 52 };
const COL_MIN      = { title:  80, artist:  60, album:  60, year: 36 };

function loadColWidths() {
  const load = (k: string, def: number) => {
    const s = localStorage.getItem(k);
    return s ? Math.max(36, parseInt(s, 10)) : def;
  };
  return {
    title:  load(COL_LS.title,  COL_DEFAULTS.title),
    artist: load(COL_LS.artist, COL_DEFAULTS.artist),
    album:  load(COL_LS.album,  COL_DEFAULTS.album),
    year:   load(COL_LS.year,   COL_DEFAULTS.year),
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
  col: 'title' | 'artist' | 'album' | 'year';
  colWidths: { title: number; artist: number; album: number; year: number };
  setColWidths: React.Dispatch<React.SetStateAction<{ title: number; artist: number; album: number; year: number }>>;
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
  onEditInClipStudio?: (track: LocalTrack) => void;
  needsRestore?: boolean;
  onRestore?: () => void;
  onDismissRestore?: () => void;
}

export function TrackListPanel({
  onMenuOpen,
  onEditInClipStudio,
  needsRestore = false,
  onRestore,
  onDismissRestore,
}: TrackListPanelProps = {}) {
  const allTracks = useTrackStore(s => s.tracks);
  const playlistTracksState = useTrackStore(s => s.playlistTracks);
  const { currentTrack, isPlaying, play, togglePlay, setQueue, addToQueueEnd, libraryFilter, setLibraryFilter, searchQuery, setSearchQuery } = useAudioPlayer();

  // Fetch tracks for the active playlist (disabled when not in a playlist view)
  const activePlaylistId = libraryFilter.type === 'playlist' ? Number(libraryFilter.value) : undefined;
  const playlistTracks = useMemo(() => {
    if (activePlaylistId === undefined) return [];
    const ptIds = new Set(
      playlistTracksState
        .filter(pt => pt.playlistId === activePlaylistId)
        .sort((a, b) => a.position - b.position)
        .map(pt => pt.trackId)
    );
    return allTracks.filter(t => ptIds.has(t.id));
  }, [allTracks, playlistTracksState, activePlaylistId]);

  const { isScanning, scanProgress, scanStatus, addFolder, scanFileList, importDroppedItems, rescanAll, getStoredHandles } = useFileSystem();

  // iOS Safari doesn't support showDirectoryPicker — detect once on mount.
  const hasDirectoryPicker = typeof (window as any).showDirectoryPicker === 'function';

  // Hidden file input for iOS: triggered synchronously inside the click handler
  // so iOS Safari's user-gesture requirement is satisfied.
  const iosFileInputRef = useRef<HTMLInputElement>(null);
  const trackListRef    = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);

  const handleIosFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await scanFileList(files);
    }
    e.target.value = '';
  };

  // "Has content" — true when there are stored folder handles (desktop/Android)
  // OR when tracks already exist in the DB (iOS, which can't persist handles).
  // This controls whether the toolbar shows "Add Folder" or "Sync Now".
  const [hasFolders, setHasFolders] = useState(false);

  const refreshHasFolders = useCallback(async () => {
    const handles = await getStoredHandles();
    // On iOS there are never persistent handles; fall back to checking the track list.
    setHasFolders(handles.length > 0 || allTracks.length > 0);
  }, [getStoredHandles, allTracks.length]);

  // Check on mount
  useEffect(() => { refreshHasFolders(); }, [refreshHasFolders]);

  // Re-check every time a scan finishes so the button flips immediately after first import
  const prevScanning = useRef(false);
  useEffect(() => {
    if (prevScanning.current && !isScanning) refreshHasFolders();
    prevScanning.current = isScanning;
  }, [isScanning, refreshHasFolders]);

  // Scroll the list to the current (or last-played) track once the list is populated.
  // Fires on every render but only acts once (didInitialScroll guard).
  // This makes reload → rescan → highlight immediately visible.
  useEffect(() => {
    if (didInitialScroll.current) return;
    if (!currentTrack) return;
    const el = trackListRef.current?.querySelector<HTMLElement>(`[data-track-id="${currentTrack.id}"]`);
    if (!el) return;
    didInitialScroll.current = true;
    // Use requestAnimationFrame so the DOM has fully painted the rows first
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
    });
  });

  const [clearConfirm, setClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // ── Tag editor ───────────────────────────────────────────────────────────
  const [editingTrack, setEditingTrack] = useState<LocalTrack | null>(null);

  // ── Multi-select ────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const lastClickedIdxRef = useRef<number>(-1);

  // ── Drag-drop ────────────────────────────────────────────────────────────
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleClearLibrary = async () => {
    if (!clearConfirm) { setClearConfirm(true); setTimeout(() => setClearConfirm(false), 3000); return; }
    setClearConfirm(false);
    setIsClearing(true);
    try {
      await useTrackStore.getState().clearTracks();
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

  // Detect phone-portrait — hides Artist/Album/Year, lets Title flex-1
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

  const isSearching = searchQuery.trim().length > 0;

  const filtered = useMemo(() => {
    if (isSearching) {
      const q = searchQuery.trim().toLowerCase();
      return allTracks.filter(t =>
        (t.title ?? '').toLowerCase().includes(q) ||
        (t.artist ?? '').toLowerCase().includes(q) ||
        (t.album ?? '').toLowerCase().includes(q) ||
        (t.fileName ?? '').toLowerCase().includes(q)
      );
    }
    if (libraryFilter.type === 'all') return allTracks;
    if (libraryFilter.type === 'artist') return allTracks.filter(t => t.artist === libraryFilter.value);
    if (libraryFilter.type === 'album') return allTracks.filter(t => t.album === libraryFilter.value);
    if (libraryFilter.type === 'playlist') return playlistTracks;
    return allTracks;
  }, [allTracks, playlistTracks, libraryFilter, searchQuery, isSearching]);

  // Filenames that exist as vault copies anywhere in the full library.
  // We use allTracks (not filtered) so a vault track outside the current
  // search/filter still shadows its local duplicate in the visible list.
  const vaultFileNames = useMemo(
    () => new Set<string>(),
    [allTracks],
  );

  // Hide local tracks that are shadowed by a vault copy (same fileName).
  // Vault version is always the canonical one — it's encrypted cloud-stored.
  const deduplicated = useMemo(
    () => filtered.filter(t => !(t.source === 'local' && t.fileName && vaultFileNames.has(t.fileName))),
    [filtered, vaultFileNames],
  );

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...deduplicated].sort((a, b) => {
      const secondary = (x: LocalTrack, y: LocalTrack) => {
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
  }, [deduplicated, sortCol, sortDir]);

  const playRow = useCallback((track: LocalTrack, idx: number) => {
    const queue = sorted.map((t, i) => ({ id: i, trackId: t.id, position: i, track: t }));
    setQueue(queue);
    play(track, queue, idx);
  }, [sorted, setQueue, play]);

  // ── Click handler with multi-select ─────────────────────────────────────
  const handleRowClick = useCallback((e: React.MouseEvent, track: LocalTrack, idx: number) => {
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
      {/* iOS fallback: a real DOM input triggered synchronously from the click handler.
          iOS Safari blocks programmatic .click() calls that happen inside async functions,
          so this must be a rendered element (not created dynamically) clicked synchronously. */}
      <input
        ref={iosFileInputRef}
        type="file"
        {...{ webkitdirectory: '' } as any}
        multiple
        style={{ display: 'none' }}
        onChange={handleIosFiles}
      />

      {/* ── Drag-over overlay ──────────────────────────────────────────────── */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/70 border-2 border-dashed border-emerald-500/70 rounded pointer-events-none">
          <FolderInput className="w-10 h-10 text-emerald-400 mb-2" />
          <p className="text-sm text-emerald-300 font-medium">Drop music folders or files to import</p>
        </div>
      )}

      {/* ── Action toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 h-14 sm:h-8 border-b border-border bg-black/20 shrink-0">
        {/* Mobile hamburger */}
        {onMenuOpen && (
          <button
            className="sm:hidden flex items-center justify-center w-11 h-11 -ml-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0"
            onClick={onMenuOpen}
            title="Open library"
            aria-label="Open library menu"
          >
            <Menu className="w-6 h-6" />
          </button>
        )}

        {/* Add Folder / Sync Now — mode switches once a folder is known.
            iOS: click must be synchronous (no await before it) to keep the user-gesture
            context alive. Desktop/Android: use the async addFolder() which saves handles. */}
        {hasFolders ? (
          <button
            onClick={() => {
              if (hasDirectoryPicker) {
                // Try cached handles first (sync = preserves gesture).
                // queryPermission doesn't need a gesture — just checks state.
                const cached = getStoredHandlesSync();
                const canRescan = cached.length > 0 && cached.some(h => {
                  try { return 'queryPermission' in h; } catch { return false; }
                });

                if (canRescan) {
                  // Permission may already be granted (desktop, or Android
                  // before page refresh). Rescan the actual files.
                  (async () => {
                    const handles = cached.length > 0 ? cached : await getStoredHandles();
                    if (handles.length === 0) return;
                    // queryPermission — no gesture needed
                    let allGranted = true;
                    try {
                      for (const h of handles) {
                        const state = await h.queryPermission({ mode: 'read' });
                        if (state !== 'granted') { allGranted = false; break; }
                      }
                    } catch { allGranted = false; }
                    if (allGranted) {
                      await rescanAll();
                    } else {
                      // Permission not granted — can't rescan files.
                      // Show count from store instead.
                      const count = useTrackStore.getState().tracks.length;
                      if (count > 0) {
                        const label = `\u2713 ${count} track${count !== 1 ? 's' : ''} synced to PLAYD`;
                        toast({ title: label });
                      }
                    }
                  })();
                } else {
                  // No handles cached — try async load, then same logic
                  (async () => {
                    const handles = await getStoredHandles();
                    if (handles.length > 0) {
                      let allGranted = true;
                      try {
                        for (const h of handles) {
                          const state = await h.queryPermission({ mode: 'read' });
                          if (state !== 'granted') { allGranted = false; break; }
                        }
                      } catch { allGranted = false; }
                      if (allGranted) {
                        await rescanAll();
                        return;
                      }
                    }
                    // No handle with permission — show count from store
                    const count = useTrackStore.getState().tracks.length;
                    if (count > 0) {
                      const label = `\u2713 ${count} track${count !== 1 ? 's' : ''} synced to PLAYD`;
                      toast({ title: label });
                    }
                  })();
                }
              } else {
                // iOS: plain synchronous .click() — no async keyword anywhere above
                iosFileInputRef.current?.click();
              }
            }}
            disabled={isScanning}
            title="Re-scan your saved music folders"
            className={clsx(
              'flex items-center gap-1.5 px-3 h-11 sm:px-2 sm:h-5 sm:gap-1 rounded text-xs sm:text-[10px] font-medium transition-colors shrink-0',
              isScanning
                ? 'text-primary/50 cursor-not-allowed'
                : 'text-muted-foreground hover:text-foreground hover:bg-white/5 active:bg-white/10',
            )}
          >
            <RefreshCw className={clsx('w-4 h-4 sm:w-3 sm:h-3', isScanning && 'animate-spin')} />
            <span>{isScanning ? 'Syncing…' : 'Sync Now'}</span>
          </button>
        ) : (
          <button
            onClick={() => {
              if (hasDirectoryPicker) {
                // Desktop/Android: async picker via .then — no await in onClick itself
                addFolder().then(added => {
                  if (added) {
                    refreshHasFolders();
                  }
                });
              } else {
                // iOS: plain synchronous .click() — no async keyword anywhere above
                iosFileInputRef.current?.click();
              }
            }}
            disabled={isScanning}
            title="Add music to your library"
            className={clsx(
              'flex items-center gap-1.5 px-3 h-11 sm:px-2 sm:h-5 sm:gap-1 rounded text-xs sm:text-[10px] font-medium transition-colors shrink-0',
              isScanning
                ? 'text-primary/50 cursor-not-allowed'
                : 'text-muted-foreground hover:text-foreground hover:bg-white/5 active:bg-white/10',
            )}
          >
            <FolderOpen className="w-4 h-4 sm:w-3 sm:h-3" />
            <span>{isScanning ? 'Importing…' : 'Add Folder'}</span>
          </button>
        )}

        {/* Active filter label + scan status (always visible side-by-side) */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isSearching ? (
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[10px] text-primary/80 truncate max-w-[140px]">
                "{searchQuery}" — {sorted.length} result{sorted.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => setSearchQuery('')}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : libraryFilter.type !== 'all' ? (
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
            'flex items-center gap-1.5 px-3 h-11 sm:px-2 sm:h-5 sm:gap-1 rounded text-xs sm:text-[10px] font-medium transition-colors shrink-0',
            clearConfirm
              ? 'text-red-400 bg-red-950/40 hover:bg-red-950/60'
              : 'text-muted-foreground hover:text-red-400 hover:bg-white/5 active:bg-white/10',
            isClearing && 'opacity-50 cursor-not-allowed',
          )}
        >
          <Trash2 className="w-4 h-4 sm:w-3 sm:h-3" />
          <span className={clearConfirm ? 'inline' : 'hidden sm:inline'}>{clearConfirm ? 'Confirm?' : 'Clear'}</span>
        </button>
      </div>

      {/* ── Restore-access banner ──────────────────────────────────────────── */}
      {needsRestore && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-950/60 border-b border-amber-700/50 shrink-0">
          <RefreshCw className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-[11px] text-amber-300 flex-1 leading-tight">
            Your music library needs access to play — click to restore.
          </span>
          <button
            onClick={onRestore}
            className="px-2 py-0.5 rounded text-[10px] bg-amber-700/60 hover:bg-amber-600/70 text-amber-100 transition-colors shrink-0"
          >
            Restore Access
          </button>
          <button
            onClick={onDismissRestore}
            title="Dismiss"
            className="text-amber-600 hover:text-amber-400 transition-colors shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Column headers + track rows */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Column headers
              Left section (flex-1 overflow-hidden): fixed-width resizable columns.
              Right section (w-14 shrink-0): Time — always pinned, never pushed off. */}
        <div className="flex items-center px-3 h-8 border-b border-border bg-black/30 shrink-0 select-none">
          {/* Left: all resizable columns clipped as a group */}
          <div className="flex items-center flex-1 min-w-0 overflow-hidden">
            {/* # */}
            <div className="w-10 shrink-0 text-right pr-2">
              <ColHeader col="trackNumber" label="#" extraClass="justify-end" />
            </div>
            {/* Title — fixed resizable width */}
            <div className="relative shrink-0 pr-3" style={{ width: colWidths.title }}>
              <ColHeader col="title" label="Title" />
              <ResizeHandle col="title" colWidths={colWidths} setColWidths={setColWidths} />
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
              <div className="relative shrink-0 pr-4" style={{ width: colWidths.year }}>
                <ColHeader col="year" label="Year" extraClass="justify-end" />
                <ResizeHandle col="year" colWidths={colWidths} setColWidths={setColWidths} />
              </div>
            )}
          </div>
          {/* Right: Time — outside clip section, always visible */}
          <div className="w-14 shrink-0 text-right pl-1">
            <ColHeader col="duration" label="Time" extraClass="justify-end" />
          </div>
        </div>

        {/* Track rows */}
        <ScrollArea className="flex-1">
          {/* content-visibility: auto provides native virtual scrolling in Chromium */}
          <div className="w-full" ref={trackListRef} style={{ contentVisibility: 'auto' as any }}>
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground gap-3 py-24 px-6">
              <Music className="w-10 h-10 opacity-20" />
              {isSearching ? (
                <>
                  <p className="text-sm font-medium">No results for "{searchQuery}"</p>
                  <p className="text-xs opacity-60">Try a different word or check your spelling</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">No tracks yet</p>
                  <p className="text-xs opacity-60 leading-relaxed max-w-[220px]">Add a folder in Preferences to get started</p>
                </>
              )}
            </div>
          ) : (
            <div>
              {sorted?.map((track, idx) => {
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
                    onEditTags={(t) => setEditingTrack(t)}
                    onEditInClipStudio={onEditInClipStudio}
                  >
                    <div
                      data-track-id={track.id}
                      onDoubleClick={() => {
                        setSelectedIds(new Set([track.id]));
                        playRow(track, idx);
                      }}
                      onClick={(e) => handleRowClick(e, track, idx)}
                      className={clsx(
                        'flex items-center px-3 cursor-default select-none border-b border-border/10 group h-9 overflow-hidden',
                        isCurrent && isSelected  && 'bg-primary/15 text-primary',
                        isCurrent && !isSelected && 'bg-primary/10 text-primary',
                        !isCurrent && isSelected && 'bg-white/[0.07] text-foreground',
                        !isCurrent && !isSelected && 'text-foreground/80 hover:bg-white/5',
                      )}
                    >
                      {/* Left: fixed-width resizable columns clipped as a group */}
                      <div className="flex items-center flex-1 min-w-0 overflow-hidden">
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

                        {/* Title — fixed resizable width, clips long text */}
                        <div className="shrink-0 pr-3 overflow-hidden flex items-center gap-1" style={{ width: colWidths.title }}>
                          {(track as any).cueOffset !== undefined && (track as any).cueOffset !== null && (
                            <span className="text-[9px] font-semibold text-amber-500/70 tracking-wider shrink-0">CUE</span>
                          )}
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
                          <div className="shrink-0 pr-4 overflow-hidden text-right" style={{ width: colWidths.year }}>
                            <span className="text-[11px] font-mono text-muted-foreground/50 truncate block">
                              {track.year || ''}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Right: Vault badge + RG badge + Edit + Duration — pinned at right edge */}
                      <div className="shrink-0 flex items-center gap-1.5 pl-1">
                        {track.replaygainGain != null && (
                          <span
                            className="hidden group-hover:inline-flex items-center text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-primary/15 text-primary/70 leading-none select-none"
                            title={`ReplayGain: ${track.replaygainGain > 0 ? '+' : ''}${track.replaygainGain.toFixed(1)} dB`}
                          >
                            RG
                          </span>
                        )}
                        <div className="w-14 text-right">
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
                        {/* Pencil — edit tags; opacity toggle keeps row width stable */}
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingTrack(track); }}
                          className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-5 h-5 rounded hover:bg-white/10 text-zinc-500 hover:text-zinc-200 transition-opacity shrink-0"
                          title="Edit tags"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </TrackContextMenu>
                );
              })}
            </div>
          )}
          </div>
        </ScrollArea>
      </div>

      {/* Tag editor modal — single mount point for the whole list */}
      <TrackEditModal
        track={editingTrack}
        open={editingTrack !== null}
        onClose={() => setEditingTrack(null)}
      />

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
