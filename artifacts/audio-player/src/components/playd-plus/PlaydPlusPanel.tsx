import { useState, useRef, useEffect, useCallback } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Search, X, Play, Bookmark, Loader2, Clock,
  Music, AlertCircle, ListPlus, Check, Menu,
} from 'lucide-react';
import { clsx } from 'clsx';
import type { YtTrack, YtHistoryItem } from '@/types/yt-track';
import { SaveDestinationModal } from './SaveDestinationModal';
import { PlaydPlusToggle } from '@/components/ui/PlaydPlusToggle';

const YT_URL_REGEX = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i;
const SPOTIFY_URL_REGEX = /^https?:\/\/(open\.)?spotify\.com\//i;
const ANY_URL_REGEX = /^https?:\/\//i;

function isSupportedImportUrl(url: string): boolean {
  return YT_URL_REGEX.test(url) || SPOTIFY_URL_REGEX.test(url);
}

function isAnyUrl(url: string): boolean {
  return ANY_URL_REGEX.test(url);
}

function formatDuration(secs: number | null | undefined): string {
  if (secs == null || secs <= 0) return '';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function SpotifyBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 bg-[#1DB954]/15 text-[#1DB954] border border-[#1DB954]/30 rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wide uppercase shrink-0">
      Spotify
    </span>
  );
}

interface TrackRowProps {
  track: YtTrack;
  onPlay: () => void;
  onSave: () => void;
  onAddToQueue: () => void;
  isPlaying?: boolean;
}

function TrackRow({ track, onPlay, onSave, onAddToQueue, isPlaying }: TrackRowProps) {
  const [queuedFlash, setQueuedFlash] = useState(false);
  const handleQueueClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToQueue();
    setQueuedFlash(true);
    setTimeout(() => setQueuedFlash(false), 900);
  };
  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPlay();
  };
  const handleSaveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSave();
  };
  const [imgError, setImgError] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(); } }}
      className={clsx(
        'group flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer select-none',
        isPlaying ? 'bg-primary/10' : 'hover:bg-white/5 active:bg-white/10',
      )}
    >
      {/* Thumbnail */}
      <div className="w-10 h-10 rounded overflow-hidden bg-black/40 border border-white/5 shrink-0 relative">
        {track.thumbnail && !imgError ? (
          <img
            src={track.thumbnail}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music className="w-4 h-4 text-muted-foreground/40" />
          </div>
        )}
        {isPlaying && (
          <div className="absolute inset-0 bg-primary/30 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className={clsx('text-xs font-medium truncate', isPlaying ? 'text-primary' : 'text-foreground')}>
          {track.title || 'Unknown'}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-[10px] text-muted-foreground truncate">
            {track.artist || 'Unknown Artist'}
          </p>
          {track.source === 'spotify' && <SpotifyBadge />}
        </div>
      </div>

      {/* Duration */}
      {track.duration != null && track.duration > 0 && (
        <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
          {formatDuration(track.duration)}
        </span>
      )}

      {/* Actions — always visible on mobile (no hover); fade-in on hover for desktop.
          Tapping the row itself also plays — these buttons stopPropagation. */}
      <div className="flex items-center gap-0.5 sm:gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={handlePlayClick}
          title="Play"
          aria-label="Play"
          className="h-11 w-11 sm:h-7 sm:w-7 flex items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-primary/10 active:bg-primary/15 transition-colors"
        >
          <Play className="w-5 h-5 sm:w-3.5 sm:h-3.5" />
        </button>
        <button
          onClick={handleQueueClick}
          title="Add to queue"
          aria-label="Add to queue"
          className={clsx(
            'h-11 w-11 sm:h-7 sm:w-7 flex items-center justify-center rounded-sm transition-colors',
            queuedFlash
              ? 'text-primary bg-primary/15'
              : 'text-muted-foreground hover:text-primary hover:bg-primary/10 active:bg-primary/15',
          )}
        >
          {queuedFlash
            ? <Check className="w-5 h-5 sm:w-3.5 sm:h-3.5" />
            : <ListPlus className="w-5 h-5 sm:w-3.5 sm:h-3.5" />}
        </button>
        <button
          onClick={handleSaveClick}
          title="Save to playlist"
          aria-label="Save to playlist"
          className="h-11 w-11 sm:h-7 sm:w-7 flex items-center justify-center rounded-sm text-muted-foreground hover:text-emerald-400 hover:bg-emerald-950/30 active:bg-emerald-950/40 transition-colors"
        >
          <Bookmark className="w-5 h-5 sm:w-3.5 sm:h-3.5" />
        </button>
      </div>
    </div>
  );
}

interface PlaydPlusPanelProps {
  onMenuOpen?: () => void;
}

export function PlaydPlusPanel({ onMenuOpen }: PlaydPlusPanelProps = {}) {
  const { playYtTrack, addToYtQueue, currentTrack } = useAudioPlayer();

  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'idle' | 'searching' | 'results' | 'import-loading' | 'import'>('idle');
  const [results, setResults] = useState<YtTrack[]>([]);
  const [importTracks, setImportTracks] = useState<YtTrack[]>([]);
  const [importIsSpotify, setImportIsSpotify] = useState(false);
  const [history, setHistory] = useState<YtHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const [saveModal, setSaveModal] = useState<{ open: boolean; tracks: YtTrack[] }>({ open: false, tracks: [] });

  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await customFetch<{ history: YtHistoryItem[] }>('/api/yt/history');
      const seen = new Set<string>();
      const deduped: YtHistoryItem[] = [];
      for (const item of data.history) {
        if (!seen.has(item.query)) { seen.add(item.query); deduped.push(item); }
      }
      setHistory(deduped.slice(0, 15));
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const doSearch = useCallback(async (q: string) => {
    setMode('searching');
    setError(null);
    setResults([]);
    try {
      const data = await customFetch<{ tracks: YtTrack[] }>(`/api/yt/search?q=${encodeURIComponent(q)}&limit=15`);
      setResults(data.tracks || []);
      setMode('results');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Search failed';
      setError(msg);
      setMode('results');
    }
  }, []);

  const doResolveUrl = useCallback(async (url: string) => {
    const isSpotify = SPOTIFY_URL_REGEX.test(url);
    setImportIsSpotify(isSpotify);
    setMode('import-loading');
    setError(null);
    setImportTracks([]);
    try {
      const data = await customFetch<{ tracks: YtTrack[] }>('/api/yt/resolve-url', {
        method: 'POST',
        body: JSON.stringify({ url }),
        headers: { 'Content-Type': 'application/json' },
      });
      const tracks = (data.tracks || []).map((t: YtTrack) => ({
        ...t,
        source: isSpotify ? 'spotify' as const : 'youtube' as const,
      }));
      setImportTracks(tracks);
      setMode('import');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to resolve URL';
      if (msg.includes('Spotify not configured')) {
        setError('Spotify is not configured on this server. YouTube playlists are supported.');
      } else {
        setError(msg);
      }
      setMode('import');
    }
  }, []);

  const handleInputChange = (val: string) => {
    setInput(val);
    setError(null);

    if (!val.trim()) {
      setMode('idle');
      setResults([]);
      setImportTracks([]);
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      return;
    }

    if (isAnyUrl(val.trim())) {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      if (isSupportedImportUrl(val.trim())) {
        searchTimeout.current = setTimeout(() => doResolveUrl(val.trim()), 600);
      } else {
        setError('Only YouTube and Spotify URLs are supported. Paste a YouTube playlist URL or a Spotify track/playlist/album URL.');
        setMode('results');
      }
      return;
    }

    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => doSearch(val.trim()), 500);
  };

  const handleClear = () => {
    setInput('');
    setMode('idle');
    setResults([]);
    setImportTracks([]);
    setError(null);
    inputRef.current?.focus();
  };

  const handleHistoryClick = (q: string) => {
    setInput(q);
    doSearch(q);
  };

  const handleDeleteHistoryItem = async (id: number) => {
    setHistory(prev => prev.filter(h => h.id !== id));
    try {
      await customFetch(`/api/yt/history/${id}`, { method: 'DELETE' });
    } catch {}
  };

  const handleClearAllHistory = async () => {
    setHistory([]);
    try {
      await customFetch('/api/yt/history', { method: 'DELETE' });
    } catch {}
  };

  const handlePlay = (track: YtTrack, queue: YtTrack[], idx: number) => {
    playYtTrack(track, queue, idx);
  };

  const handleSaveOne = (track: YtTrack) => {
    setSaveModal({ open: true, tracks: [track] });
  };

  const handleSaveAll = () => {
    setSaveModal({ open: true, tracks: importTracks });
  };

  const showHistoryPanel = isFocused && !input.trim() && mode === 'idle';
  const isLoading = mode === 'searching' || mode === 'import-loading';

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ── Mobile-only top bar: hamburger + mode toggle ──────────────────── */}
      <div className="sm:hidden flex items-center gap-2 px-2 h-14 border-b border-border bg-black/20 shrink-0">
        {onMenuOpen && (
          <button
            className="flex items-center justify-center w-11 h-11 -ml-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0"
            onClick={onMenuOpen}
            title="Open library"
            aria-label="Open library menu"
          >
            <Menu className="w-6 h-6" />
          </button>
        )}
        <PlaydPlusToggle />
        <div className="flex-1" />
      </div>

      {/* Search bar */}
      <div className="px-4 pt-4 pb-3 border-b border-border/50">
        <div className="relative max-w-2xl mx-auto">
          {isLoading ? (
            <Loader2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-primary animate-spin" />
          ) : (
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          )}
          <Input
            ref={inputRef}
            aria-label="PLAYD+ discovery search"
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            onKeyDown={e => {
              if (e.key !== 'Enter' || !input.trim()) return;
              if (searchTimeout.current) clearTimeout(searchTimeout.current);
              const val = input.trim();
              if (isAnyUrl(val)) {
                if (isSupportedImportUrl(val)) {
                  doResolveUrl(val);
                } else {
                  setError('Only YouTube and Spotify URLs are supported. Paste a YouTube playlist URL or a Spotify track/playlist/album URL.');
                  setMode('results');
                }
              } else {
                doSearch(val);
              }
            }}
            placeholder="Search songs, artists… or paste a YouTube / Spotify URL"
            className="pl-9 pr-9 h-9 bg-black/20 border-border/60 text-sm rounded-md"
          />
          {input && (
            <button
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              title="Clear"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* URL hint */}
        {(mode === 'import-loading' || mode === 'import') && (
          <p className="text-[10px] text-muted-foreground text-center mt-2">
            {importIsSpotify ? (
              <span className="text-[#1DB954]">Spotify URL detected</span>
            ) : (
              <span className="text-red-400">YouTube URL detected</span>
            )}
            {mode === 'import-loading' && ' — resolving tracks…'}
          </p>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="max-w-2xl mx-auto px-2 py-3">

          {/* Error banner */}
          {error && (
            <div role="alert" aria-live="assertive" className="flex items-start gap-2 bg-red-950/40 border border-red-900/50 rounded-md px-3 py-2.5 mb-3 mx-1">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* Search history */}
          {showHistoryPanel && (
            <div>
              {historyLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : history.length > 0 ? (
                <>
                  <div className="flex items-center justify-between px-2 mb-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Recent Searches
                    </p>
                    <button
                      onClick={handleClearAllHistory}
                      className="text-[10px] text-muted-foreground/60 hover:text-red-400 transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="space-y-0.5">
                    {history.map(item => (
                      <div key={item.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                        <button
                          className="flex-1 text-left text-xs text-muted-foreground hover:text-foreground transition-colors truncate"
                          onClick={() => handleHistoryClick(item.query)}
                        >
                          {item.query}
                        </button>
                        <button
                          onClick={() => handleDeleteHistoryItem(item.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-red-400 transition-all"
                          title="Remove"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Search className="w-8 h-8 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground/50">
                    Search YouTube for any song
                  </p>
                  <p className="text-xs text-muted-foreground/30">
                    Paste a YouTube playlist or Spotify URL to import tracks
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Idle empty state (not focused) */}
          {mode === 'idle' && !showHistoryPanel && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-1">
                <Search className="w-6 h-6 text-primary/60" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">PLAYD+ Discovery</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Search and stream music from YouTube
                </p>
              </div>
              <p className="text-xs text-muted-foreground/50 max-w-xs leading-relaxed">
                Paste a YouTube playlist or Spotify URL to import all tracks at once
              </p>
            </div>
          )}

          {/* Search loading */}
          {mode === 'searching' && (
            <div className="flex flex-col items-center gap-2 py-16">
              <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
              <p className="text-xs text-muted-foreground">Searching…</p>
            </div>
          )}

          {/* Search results */}
          {mode === 'results' && !error && results.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Search className="w-8 h-8 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No results found</p>
              <p className="text-xs text-muted-foreground/50">Try a different search term</p>
            </div>
          )}

          {mode === 'results' && results.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2 mb-2">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </p>
              <div className="space-y-0.5">
                {results.map((track, idx) => (
                  <TrackRow
                    key={track.videoId}
                    track={track}
                    isPlaying={currentTrack?.source === 'youtube' && currentTrack?.fileName === track.videoId}
                    onPlay={() => handlePlay(track, results, idx)}
                    onAddToQueue={() => addToYtQueue(track)}
                    onSave={() => handleSaveOne(track)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Import loading */}
          {mode === 'import-loading' && (
            <div className="flex flex-col items-center gap-3 py-16">
              <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Resolving tracks…</p>
                {importIsSpotify && (
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    Finding YouTube matches for Spotify tracks
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Import results */}
          {mode === 'import' && !error && importTracks.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <AlertCircle className="w-8 h-8 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No tracks found in this URL</p>
            </div>
          )}

          {mode === 'import' && importTracks.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-2 mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {importTracks.length} track{importTracks.length !== 1 ? 's' : ''} imported
                  {importIsSpotify && <span className="ml-1 text-[#1DB954]">via Spotify</span>}
                </p>
                <button
                  onClick={handleSaveAll}
                  className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors bg-emerald-950/30 hover:bg-emerald-950/50 px-2 py-1 rounded-sm"
                >
                  <Bookmark className="w-3 h-3" />
                  Save all to…
                </button>
              </div>
              <div className="space-y-0.5">
                {importTracks.map((track, idx) => (
                  <TrackRow
                    key={`${track.videoId}-${idx}`}
                    track={track}
                    isPlaying={currentTrack?.source === 'youtube' && currentTrack?.fileName === track.videoId}
                    onPlay={() => handlePlay(track, importTracks, idx)}
                    onAddToQueue={() => addToYtQueue(track)}
                    onSave={() => handleSaveOne(track)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Save destination modal */}
      <SaveDestinationModal
        open={saveModal.open}
        onClose={() => setSaveModal({ open: false, tracks: [] })}
        tracks={saveModal.tracks}
      />
    </div>
  );
}
