import { useState, useMemo, useRef } from 'react';
import {
  useListTracks,
  useListPlaylists,
  useCreatePlaylist,
  useUpdatePlaylist,
  useDeletePlaylist,
  getListPlaylistsQueryKey,
} from '@workspace/api-client-react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';
import { useAuth } from '@/hooks/use-auth';
import { usePwaInstall } from '@/hooks/use-pwa-install';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  ListMusic, Settings, Search,
  Library, Disc3, User, ChevronDown, ChevronRight, X, LogOut, Download, FileText,
  Plus, Pencil, Trash2,
} from 'lucide-react';
import { clsx } from 'clsx';

type NavSection = 'artists' | 'albums' | 'playlists';

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps = {}) {
  const { data: tracks = [] } = useListTracks();
  const { data: playlists = [] } = useListPlaylists();
  const { isScanning } = useFileSystem();
  const { libraryFilter, setLibraryFilter, togglePrefs, isLyricsOpen, toggleLyrics, searchQuery, setSearchQuery } = useAudioPlayer();
  const { user, logout } = useAuth();
  const { canInstall, install } = usePwaInstall();
  const queryClient = useQueryClient();

  const createPlaylist = useCreatePlaylist();
  const updatePlaylist = useUpdatePlaylist();
  const deletePlaylist = useDeletePlaylist();

  const [openSections, setOpenSections] = useState<Record<NavSection, boolean>>({
    artists: true, albums: false, playlists: true,
  });

  // ── New playlist inline creation ─────────────────────────────────────────
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const newInputRef = useRef<HTMLInputElement>(null);

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
    createPlaylist.mutate(
      { data: { name } },
      { onSettled: () => queryClient.invalidateQueries({ queryKey: getListPlaylistsQueryKey() }) },
    );
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
      updatePlaylist.mutate(
        { id, data: { name } },
        { onSettled: () => queryClient.invalidateQueries({ queryKey: getListPlaylistsQueryKey() }) },
      );
    }
    setRenamingId(null);
  };

  const handleDeletePlaylist = (id: number) => {
    deletePlaylist.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPlaylistsQueryKey() });
          // If currently viewing this playlist, reset to All Songs
          if (libraryFilter.type === 'playlist' && libraryFilter.value === String(id)) {
            setLibraryFilter({ type: 'all', label: 'All Songs' });
          }
        },
      },
    );
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
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold tracking-tight text-primary flex items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="sbg" cx="50%" cy="45%" r="65%">
                  <stop offset="0%" stopColor="#180d38"/>
                  <stop offset="100%" stopColor="#07091a"/>
                </radialGradient>
                <linearGradient id="sbar" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%"   stopColor="#e0aaff"/>
                  <stop offset="35%"  stopColor="#c026d3"/>
                  <stop offset="70%"  stopColor="#7e22ce"/>
                  <stop offset="100%" stopColor="#3b0764" stopOpacity="0.6"/>
                </linearGradient>
                <radialGradient id="scap" cx="50%" cy="30%" r="55%">
                  <stop offset="0%"   stopColor="white" stopOpacity="0.95"/>
                  <stop offset="60%"  stopColor="#e0aaff" stopOpacity="0.4"/>
                  <stop offset="100%" stopColor="#9333ea" stopOpacity="0"/>
                </radialGradient>
                <filter id="sglow" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="18"/>
                </filter>
                <filter id="scapglow" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="6"/>
                </filter>
              </defs>
              <rect width="180" height="180" rx="38" fill="url(#sbg)"/>
              <rect x="42" y="72" width="28" height="90" rx="14" fill="#a855f7" opacity="0.5" filter="url(#sglow)"/>
              <rect x="76" y="28" width="28" height="134" rx="14" fill="#a855f7" opacity="0.5" filter="url(#sglow)"/>
              <rect x="110" y="94" width="28" height="68" rx="14" fill="#a855f7" opacity="0.5" filter="url(#sglow)"/>
              <rect x="44" y="74" width="24" height="86" rx="12" fill="url(#sbar)" stroke="#c084fc" strokeWidth="1.5" strokeOpacity="0.7"/>
              <ellipse cx="56" cy="76" rx="10" ry="7" fill="url(#scap)" filter="url(#scapglow)"/>
              <rect x="78" y="30" width="24" height="130" rx="12" fill="url(#sbar)" stroke="#c084fc" strokeWidth="1.5" strokeOpacity="0.7"/>
              <ellipse cx="90" cy="32" rx="10" ry="7" fill="url(#scap)" filter="url(#scapglow)"/>
              <rect x="112" y="96" width="24" height="64" rx="12" fill="url(#sbar)" stroke="#c084fc" strokeWidth="1.5" strokeOpacity="0.7"/>
              <ellipse cx="124" cy="98" rx="10" ry="7" fill="url(#scap)" filter="url(#scapglow)"/>
            </svg>
            PLAYD
          </h1>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
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
                {filteredArtists.map(artist => (
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
                {filteredAlbums.map(album => (
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
            {/* Section header row with "+" button */}
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

                {filteredPlaylists.map(pl => (
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
                          <NavItem
                            label={pl.name}
                            indent
                            active={libraryFilter.type === 'playlist' && libraryFilter.value === String(pl.id)}
                            onClick={() => setLibraryFilter({ type: 'playlist', value: String(pl.id), label: pl.name })}
                          />
                        )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-44 bg-zinc-900 border-zinc-700 text-zinc-100 shadow-2xl">
                      <ContextMenuItem
                        className="gap-2 cursor-pointer text-xs focus:bg-white/8 focus:text-zinc-100"
                        onClick={() => handleStartRename(pl.id, pl.name)}
                      >
                        <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                        Rename
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
        <div className="flex items-center gap-1">
          <div className="flex-1 flex items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground/60 truncate min-w-0">
            <User className="w-3 h-3 shrink-0" />
            <span className="truncate">{user?.displayName || user?.email}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground/60 hover:text-red-400"
            title="Sign out"
            onClick={logout}
          >
            <LogOut className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
