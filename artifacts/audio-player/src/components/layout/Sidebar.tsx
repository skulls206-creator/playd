import { useState, useMemo, useRef } from 'react';
import { useTrackStore } from '@/lib/track-store';
import type { SmartPlaylistRule } from '@/lib/track-store';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';
import { usePwaInstall } from '@/hooks/use-pwa-install';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  ListMusic, Settings, Search,
  Library, Disc3, User, ChevronDown, ChevronRight, X, Download, FileText,
  Plus, Pencil, Trash2, Upload, RefreshCw, Sparkles,
} from 'lucide-react';
import { parseM3u, generateM3u, downloadBlob, readFileAsText } from '@/lib/m3u-parser';
import type { M3uEntry } from '@/lib/m3u-parser';
import { clsx } from 'clsx';
import { PlaydLogo } from '@/components/ui/PlaydLogo';

type NavSection = 'artists' | 'albums' | 'playlists';

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps = {}) {
  const tracks = useTrackStore(s => s.tracks);
  const playlists = useTrackStore(s => s.playlists);
  const { isScanning } = useFileSystem();
  const { libraryFilter, setLibraryFilter, togglePrefs, isLyricsOpen, toggleLyrics, searchQuery, setSearchQuery } = useAudioPlayer();
  const { canInstall, install } = usePwaInstall();

  const [openSections, setOpenSections] = useState<Record<NavSection, boolean>>({
    artists: true, albums: false, playlists: true,
  });

  // ── New playlist inline creation ─────────────────────────────────────────
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const newInputRef = useRef<HTMLInputElement>(null);

  // ── Smart playlist creation ─────────────────────────────────────────────
  const [smartOpen, setSmartOpen] = useState(false);
  const [smartName, setSmartName] = useState('');
  const [smartRules, setSmartRules] = useState<SmartPlaylistRule[]>([{ field: 'artist', op: 'contains', value: '' }]);
  const [smartMatchMode, setSmartMatchMode] = useState<'all' | 'any'>('all');

  const handleCreateSmartPlaylist = async () => {
    const name = smartName.trim() || 'Smart Playlist';
    const pl = await useTrackStore.getState().createPlaylist(name, true, smartRules, smartMatchMode);
    await useTrackStore.getState().evaluateSmartPlaylist(pl.id);
    setSmartOpen(false);
    setSmartName('');
    setSmartRules([{ field: 'artist', op: 'contains', value: '' }]);
  };

  // ── Inline rename state ───────────────────────────────────────────────────
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleStartCreate = () => {
    setOpenSections(prev => ({ ...prev, playlists: true }));
    setIsCreating(true);
    setNewName('');
    setTimeout(() => newInputRef.current?.focus(), 50);
  };

  const handleConfirmCreate = () => {
    const name = newName.trim();
    if (!name) { setIsCreating(false); return; }
    useTrackStore.getState().createPlaylist(name);
    setIsCreating(false);
    setNewName('');
  };

  const handleStartRename = (id: number, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
    setTimeout(() => renameInputRef.current?.focus(), 50);
  };

  const handleConfirmRename = (id: number) => {
    const name = renameValue.trim();
    if (name) {
      useTrackStore.getState().updatePlaylist(id, name);
    }
    setRenamingId(null);
  };

  const handleDeletePlaylist = (id: number) => {
    useTrackStore.getState().deletePlaylist(id);
    // If currently viewing this playlist, reset to All Songs
    if (libraryFilter.type === 'playlist' && libraryFilter.value === String(id)) {
      setLibraryFilter({ type: 'all', label: 'All Songs' });
    }
  };

  const toggleSection = (s: NavSection) =>
    setOpenSections(prev => ({ ...prev, [s]: !prev[s] }));

  // Derive artists & albums from track list
  const artists = useMemo(() => {
    const set = new Set(tracks.map(t => t.artist || 'Unknown Artist'));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tracks]);

  const albums = useMemo(() => {
    const set = new Set(tracks.map(t => t.album || 'Unknown Album'));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tracks]);

  const matchSearch = (s: string) =>
    !searchQuery || s.toLowerCase().includes(searchQuery.toLowerCase());

  const filteredArtists = artists.filter(matchSearch);
  const filteredAlbums  = albums.filter(matchSearch);
  const filteredPlaylists = playlists.filter(p => matchSearch(p.name));

  const NavItem = ({
    label, active, onClick, indent = false,
  }: { label: string; active: boolean; onClick: () => void; indent?: boolean }) => (
    <button
      onClick={onClick}
      className={clsx(
        'w-full text-left px-3 py-1 rounded-sm text-xs truncate transition-colors',
        indent && 'pl-6',
        active
          ? 'bg-primary/20 text-primary font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
      )}
    >
      {label}
    </button>
  );

  const SectionHeader = ({
    label, section, icon: Icon,
  }: { label: string; section: NavSection; icon: any }) => (
    <button
      onClick={() => toggleSection(section)}
      className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
    >
      {openSections[section]
        ? <ChevronDown className="w-3 h-3" />
        : <ChevronRight className="w-3 h-3" />}
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );

  const handleNavClick = (fn: () => void) => {
    fn();
    onClose?.();
  };

  return (
    <div className="w-72 sm:w-52 flex-shrink-0 bg-sidebar border-r border-border flex flex-col h-full overflow-hidden">
      {/* Logo + Search */}
      <div className="p-3 border-b border-border space-y-3">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold tracking-tight text-primary flex items-center gap-1.5 shrink-0">
            <PlaydLogo size={22} />
          </h1>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground ml-auto shrink-0" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-search-input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search songs, artists, albums…"
            className="pl-8 h-7 bg-black/20 border-border/50 text-xs rounded-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              title="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-2 space-y-1">

        
          {/* ── Local Library Nav ─────────────────────────────────────────── */}
          <>
          {/* All Songs */}
          <div className="px-2 mb-1">
            <button
              onClick={() => handleNavClick(() => setLibraryFilter({ type: 'all', label: 'All Songs' }))}
              className={clsx(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs font-medium transition-colors',
                libraryFilter.type === 'all'
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
              )}
            >
              <Library className="w-3.5 h-3.5" />
              All Songs
              <span className="ml-auto text-[10px] opacity-50">{tracks.length}</span>
            </button>
          </div>

          {/* Lyrics */}
          <div className="px-2 mb-1">
            <button
              onClick={() => { toggleLyrics(); onClose?.(); }}
              className={clsx(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs font-medium transition-colors',
                isLyricsOpen
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
              )}
            >
              <FileText className="w-3.5 h-3.5" />
              Lyrics
            </button>
          </div>

          {/* Artists */}
          <div className="px-2">
            <SectionHeader label="Artists" section="artists" icon={User} />
            {openSections.artists && (
              <div className="mt-0.5 space-y-0.5">
                {filteredArtists?.map(artist => (
                  <NavItem
                    key={artist}
                    label={artist}
                    indent
                    active={libraryFilter.type === 'artist' && libraryFilter.value === artist}
                    onClick={() => handleNavClick(() => setLibraryFilter({ type: 'artist', value: artist, label: artist }))}
                  />
                ))}
                {filteredArtists.length === 0 && (
                  <p className="pl-6 text-[10px] text-muted-foreground/50 italic py-1">No artists</p>
                )}
              </div>
            )}
          </div>

          {/* Albums */}
          <div className="px-2">
            <SectionHeader label="Albums" section="albums" icon={Disc3} />
            {openSections.albums && (
              <div className="mt-0.5 space-y-0.5">
                {filteredAlbums?.map(album => (
                  <NavItem
                    key={album}
                    label={album}
                    indent
                    active={libraryFilter.type === 'album' && libraryFilter.value === album}
                    onClick={() => handleNavClick(() => setLibraryFilter({ type: 'album', value: album, label: album }))}
                  />
                ))}
                {filteredAlbums.length === 0 && (
                  <p className="pl-6 text-[10px] text-muted-foreground/50 italic py-1">No albums</p>
                )}
              </div>
            )}
          </div>

          {/* Playlists */}
          <div className="px-2">
            {/* Section header row with "+" and smart playlist buttons */}
            <div className="flex items-center">
              <button
                onClick={() => toggleSection('playlists')}
                className="flex-1 flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
              >
                {openSections.playlists
                  ? <ChevronDown className="w-3 h-3" />
                  : <ChevronRight className="w-3 h-3" />}
                <ListMusic className="w-3 h-3" />
                Playlists
              </button>
              <Popover open={smartOpen} onOpenChange={setSmartOpen}>
                <PopoverTrigger asChild>
                  <button
                    title="New smart playlist"
                    className="p-1 text-muted-foreground hover:text-purple-400 transition-colors rounded-sm"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="right" align="start" className="w-72 p-3 space-y-3 bg-card border-border/50">
                  <p className="text-xs font-semibold text-foreground">New Smart Playlist</p>
                  <Input
                    value={smartName}
                    onChange={e => setSmartName(e.target.value)}
                    placeholder="Playlist name…"
                    className="h-7 text-xs bg-black/20 border-border/50"
                  />
                  <div className="space-y-2">
                    {smartRules.map((rule, i) => (
                      <div key={i} className="flex gap-1 items-center">
                        <select
                          value={rule.field}
                          onChange={e => {
                            const r = [...smartRules];
                            r[i] = { ...r[i], field: e.target.value as any };
                            setSmartRules(r);
                          }}
                          className="h-6 text-[10px] bg-black/30 border border-border/50 rounded px-1 text-foreground"
                        >
                          <option value="title">Title</option>
                          <option value="artist">Artist</option>
                          <option value="album">Album</option>
                          <option value="genre">Genre</option>
                          <option value="year">Year</option>
                          <option value="duration">Duration</option>
                        </select>
                        <select
                          value={rule.op}
                          onChange={e => {
                            const r = [...smartRules];
                            r[i] = { ...r[i], op: e.target.value as any };
                            setSmartRules(r);
                          }}
                          className="h-6 text-[10px] bg-black/30 border border-border/50 rounded px-1 text-foreground"
                        >
                          <option value="contains">contains</option>
                          <option value="eq">equals</option>
                          <option value="neq">not</option>
                          <option value="startsWith">starts with</option>
                          <option value="endsWith">ends with</option>
                          <option value="gt">&gt;</option>
                          <option value="lt">&lt;</option>
                        </select>
                        <input
                          value={rule.value as string}
                          onChange={e => {
                            const r = [...smartRules];
                            r[i] = { ...r[i], value: e.target.value };
                            setSmartRules(r);
                          }}
                          className="flex-1 h-6 text-[10px] bg-black/30 border border-border/50 rounded px-1 text-foreground min-w-0"
                          placeholder="Value"
                        />
                        {smartRules.length > 1 && (
                          <button
                            onClick={() => setSmartRules(smartRules.filter((_, j) => j !== i))}
                            className="text-muted-foreground hover:text-destructive shrink-0"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSmartRules([...smartRules, { field: 'artist', op: 'contains', value: '' }])}
                      className="text-[10px] text-primary hover:text-primary/80 transition-colors"
                    >
                      + Add rule
                    </button>
                    <div className="flex items-center gap-1 ml-auto">
                      <span className="text-[10px] text-muted-foreground">Match:</span>
                      <select
                        value={smartMatchMode}
                        onChange={e => setSmartMatchMode(e.target.value as any)}
                        className="h-5 text-[10px] bg-black/30 border border-border/50 rounded px-1 text-foreground"
                      >
                        <option value="all">all</option>
                        <option value="any">any</option>
                      </select>
                    </div>
                  </div>
                  <Button size="sm" className="w-full h-7 text-xs" onClick={handleCreateSmartPlaylist}>
                    <Sparkles className="w-3 h-3" />
                    Create Smart Playlist
                  </Button>
                </PopoverContent>
              </Popover>
              <button
                onClick={handleStartCreate}
                title="New playlist"
                className="p-1 text-muted-foreground hover:text-primary transition-colors rounded-sm"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {openSections.playlists && (
              <div className="mt-0.5 space-y-0.5">
                {/* Inline new-playlist input */}
                {isCreating && (
                  <div className="pl-4 pr-1">
                    <input
                      ref={newInputRef}
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onBlur={handleConfirmCreate}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleConfirmCreate();
                        if (e.key === 'Escape') setIsCreating(false);
                      }}
                      placeholder="Playlist name…"
                      className="w-full bg-black/30 border border-primary/40 rounded-sm px-2 py-0.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/80"
                    />
                  </div>
                )}

                {filteredPlaylists?.map(pl => (
                  <ContextMenu key={pl.id}>
                    <ContextMenuTrigger asChild>
                      <div>
                        {renamingId === pl.id ? (
                          <div className="pl-4 pr-1">
                            <input
                              ref={renameInputRef}
                              value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              onBlur={() => handleConfirmRename(pl.id)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleConfirmRename(pl.id);
                                if (e.key === 'Escape') setRenamingId(null);
                              }}
                              className="w-full bg-black/30 border border-primary/40 rounded-sm px-2 py-0.5 text-xs text-foreground outline-none focus:border-primary/80"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <NavItem
                              label={pl.name}
                              indent
                              active={libraryFilter.type === 'playlist' && libraryFilter.value === String(pl.id)}
                              onClick={() => setLibraryFilter({ type: 'playlist', value: String(pl.id), label: pl.name })}
                            />
                            {pl.isSmart && (
                              <Sparkles className="w-2.5 h-2.5 text-purple-400 shrink-0 mr-2" />
                            )}
                          </div>
                        )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48 bg-zinc-900 border-zinc-700 text-zinc-100 shadow-2xl">
                      <ContextMenuItem
                        className="gap-2 cursor-pointer text-xs focus:bg-white/8 focus:text-zinc-100"
                        onClick={() => handleStartRename(pl.id, pl.name)}
                      >
                        <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                        Rename
                      </ContextMenuItem>
                      {pl.isSmart && (
                        <ContextMenuItem
                          className="gap-2 cursor-pointer text-xs focus:bg-white/8 focus:text-zinc-100"
                          onClick={() => useTrackStore.getState().evaluateSmartPlaylist(pl.id)}
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                          Refresh
                        </ContextMenuItem>
                      )}
                      <ContextMenuSeparator className="bg-zinc-700/50" />
                      <ContextMenuItem
                        className="gap-2 cursor-pointer text-xs focus:bg-white/8 text-zinc-200"
                        onClick={async () => {
                          const tracks = useTrackStore.getState().getTracksForPlaylist(pl.id);
                          if (tracks.length === 0) return;
                          const entries: M3uEntry[] = tracks.map(t => ({
                            path: `${t.folderPath}/${t.fileName}`,
                            title: `${t.artist} - ${t.title}`,
                            duration: t.duration || undefined,
                          }));
                          const m3u = generateM3u(entries);
                          downloadBlob(m3u, `${pl.name.replace(/[^a-z0-9]/gi, '_')}.m3u`);
                        }}
                      >
                        <Download className="w-3.5 h-3.5 text-zinc-400" />
                        Export M3U
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="gap-2 cursor-pointer text-xs focus:bg-white/8 text-zinc-200"
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'file';
                          input.accept = '.m3u,.m3u8';
                          input.onchange = async (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0];
                            if (!file) return;
                            const content = await readFileAsText(file);
                            const entries = parseM3u(content);
                            const tracks = useTrackStore.getState().tracks;
                            for (const entry of entries) {
                              const match = tracks.find(t => entry.path.includes(t.fileName) || entry.path.includes(`${t.artist} - ${t.title}`));
                              if (match) {
                                await useTrackStore.getState().addTrackToPlaylist(pl.id, match.id);
                              }
                            }
                          };
                          input.click();
                        }}
                      >
                        <Upload className="w-3.5 h-3.5 text-zinc-400" />
                        Import M3U
                      </ContextMenuItem>
                      <ContextMenuSeparator className="bg-zinc-700/50" />
                      <ContextMenuItem
                        className="gap-2 cursor-pointer text-xs focus:bg-white/8 text-red-400 focus:text-red-300"
                        onClick={() => handleDeletePlaylist(pl.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete playlist
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}

                {filteredPlaylists.length === 0 && !isCreating && (
                  <p className="pl-6 text-[10px] text-muted-foreground/50 italic py-1">No playlists</p>
                )}
              </div>
            )}
          </div>
          </>
        

        </div>
      </ScrollArea>

      {isScanning && (
        <div className="px-3 py-1 text-[10px] text-primary animate-pulse border-t border-border/30">
          Scanning…
        </div>
      )}

      <div className="p-2 border-t border-border mt-auto space-y-0.5">
        {canInstall && (
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 h-7 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/30"
            onClick={install}
          >
            <Download className="w-3.5 h-3.5" />
            Install App
          </Button>
        )}
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-7 text-xs text-muted-foreground hover:text-foreground"
          onClick={togglePrefs}
        >
          <Settings className="w-3.5 h-3.5" />
          Preferences
        </Button>
      </div>
    </div>
  );
}
