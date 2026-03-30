import { useState, useMemo } from 'react';
import { useListTracks, useListPlaylists } from '@workspace/api-client-react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';
import { useAuth } from '@/hooks/use-auth';
import { usePwaInstall } from '@/hooks/use-pwa-install';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  ListMusic, Settings, Search,
  Library, Disc3, User, ChevronDown, ChevronRight, X, LogOut, Download, FileText,
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

  const [openSections, setOpenSections] = useState<Record<NavSection, boolean>>({
    artists: true, albums: false, playlists: true,
  });

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
                  <stop offset="0%" stopColor="#1a0f3a"/>
                  <stop offset="100%" stopColor="#07091a"/>
                </radialGradient>
                <linearGradient id="sgem" x1="25%" y1="20%" x2="80%" y2="80%">
                  <stop offset="0%"   stopColor="#e0aaff"/>
                  <stop offset="30%"  stopColor="#c026d3"/>
                  <stop offset="70%"  stopColor="#7e22ce"/>
                  <stop offset="100%" stopColor="#3b0764"/>
                </linearGradient>
                <linearGradient id="srim" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%"   stopColor="#f0abfc"/>
                  <stop offset="50%"  stopColor="#a855f7"/>
                  <stop offset="100%" stopColor="#6b21a8" stopOpacity="0.4"/>
                </linearGradient>
                <radialGradient id="sspec" cx="35%" cy="28%" r="38%">
                  <stop offset="0%"   stopColor="white" stopOpacity="0.9"/>
                  <stop offset="55%"  stopColor="white" stopOpacity="0.1"/>
                  <stop offset="100%" stopColor="white" stopOpacity="0"/>
                </radialGradient>
                <filter id="samb" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="22"/>
                </filter>
              </defs>
              <rect width="180" height="180" rx="38" fill="url(#sbg)"/>
              <ellipse cx="96" cy="92" rx="72" ry="64" fill="#9333ea" opacity="0.35" filter="url(#samb)"/>
              <polygon points="38,36 38,144 148,90" fill="#c084fc" opacity="0.4" filter="url(#samb)"/>
              <polygon points="38,36 38,144 148,90" fill="url(#sgem)" stroke="url(#srim)" strokeWidth="2" strokeLinejoin="round"/>
              <polygon points="38,36 38,144 148,90" fill="url(#sspec)"/>
              <circle cx="68" cy="50" r="2.5" fill="white" opacity="0.9"/>
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
            <SectionHeader label="Playlists" section="playlists" icon={ListMusic} />
            {openSections.playlists && (
              <div className="mt-0.5 space-y-0.5">
                {filteredPlaylists.map(pl => (
                  <NavItem
                    key={pl.id}
                    label={pl.name}
                    indent
                    active={libraryFilter.type === 'playlist' && libraryFilter.value === String(pl.id)}
                    onClick={() => setLibraryFilter({ type: 'playlist', value: String(pl.id), label: pl.name })}
                  />
                ))}
                {filteredPlaylists.length === 0 && (
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
