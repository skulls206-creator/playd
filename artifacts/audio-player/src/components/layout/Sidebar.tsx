import { useState } from 'react';
import { useListTracks, useListPlaylists } from '@workspace/api-client-react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { 
  FolderSearch, Music2, ListMusic, Plus, 
  Settings, ChevronRight, ChevronDown, Search 
} from 'lucide-react';
import { clsx } from 'clsx';

interface TreeItem {
  name: string;
  type: 'artist' | 'album';
  children?: TreeItem[];
  tracks?: any[];
  isOpen?: boolean;
}

export function Sidebar() {
  const { data: tracks = [] } = useListTracks();
  const { data: playlists = [] } = useListPlaylists();
  const { addFolder, isScanning, scanStatus } = useFileSystem();
  const { play, setQueue, togglePrefs } = useAudioPlayer();
  
  const [search, setSearch] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  // Group tracks by Artist -> Album
  const tree: TreeItem[] = [];
  
  const filteredTracks = tracks.filter(t => 
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.artist.toLowerCase().includes(search.toLowerCase()) ||
    t.album.toLowerCase().includes(search.toLowerCase())
  );

  const artists = [...new Set(filteredTracks.map(t => t.artist))].sort();
  
  artists.forEach(artist => {
    const artistTracks = filteredTracks.filter(t => t.artist === artist);
    const albums = [...new Set(artistTracks.map(t => t.album))].sort();
    
    tree.push({
      name: artist,
      type: 'artist',
      children: albums.map(album => ({
        name: album,
        type: 'album',
        tracks: artistTracks.filter(t => t.album === album).sort((a,b) => (a.trackNumber || 0) - (b.trackNumber || 0))
      }))
    });
  });

  const toggleNode = (id: string) => {
    setExpandedNodes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const playGroup = (tracks: any[]) => {
    setQueue(tracks.map((t, i) => ({ id: Math.random(), trackId: t.id, position: i, track: t })));
    play(tracks[0]);
  };

  return (
    <div className="w-64 flex-shrink-0 bg-sidebar border-r border-border flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border space-y-4">
        <h1 className="text-xl font-bold tracking-tight text-primary flex items-center gap-2">
          <Music2 className="w-6 h-6" />
          playd.music
        </h1>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input 
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter library..." 
            className="pl-9 h-8 bg-black/20 border-border/50 focus-visible:ring-primary/50 rounded-sm text-xs"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-6">
          
          {/* Library Tree */}
          <div>
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Library</span>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-5 w-5 text-muted-foreground hover:text-primary"
                onClick={addFolder}
                disabled={isScanning}
                title="Add Local Folder"
              >
                <FolderSearch className="w-3.5 h-3.5" />
              </Button>
            </div>
            
            {isScanning && (
              <div className="px-2 py-1 text-xs text-primary animate-pulse">
                {scanStatus}
              </div>
            )}

            <div className="space-y-0.5">
              {tree.map(artist => (
                <div key={artist.name}>
                  <div 
                    className="flex items-center gap-1 px-2 py-1 hover:bg-white/5 rounded-sm cursor-pointer text-sm group"
                    onClick={() => toggleNode(`artist-${artist.name}`)}
                    onDoubleClick={() => playGroup(artist.children?.flatMap(c => c.tracks) || [])}
                  >
                    {expandedNodes[`artist-${artist.name}`] ? 
                      <ChevronDown className="w-3 h-3 text-muted-foreground" /> : 
                      <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    }
                    <span className="truncate flex-1 font-medium">{artist.name}</span>
                  </div>
                  
                  {expandedNodes[`artist-${artist.name}`] && (
                    <div className="pl-4 space-y-0.5 border-l border-border/30 ml-3 my-0.5">
                      {artist.children?.map(album => (
                        <div key={album.name}>
                          <div 
                            className="flex items-center gap-1 px-2 py-1 hover:bg-white/5 rounded-sm cursor-pointer text-xs group"
                            onClick={() => toggleNode(`album-${artist.name}-${album.name}`)}
                            onDoubleClick={(e) => { e.stopPropagation(); playGroup(album.tracks || []); }}
                          >
                            {expandedNodes[`album-${artist.name}-${album.name}`] ? 
                              <ChevronDown className="w-3 h-3 text-muted-foreground opacity-50" /> : 
                              <ChevronRight className="w-3 h-3 text-muted-foreground opacity-50" />
                            }
                            <span className="truncate flex-1 text-muted-foreground group-hover:text-foreground transition-colors">{album.name}</span>
                          </div>

                          {/* Tracks */}
                          {expandedNodes[`album-${artist.name}-${album.name}`] && (
                            <div className="pl-4 space-y-0.5 ml-3 my-0.5">
                              {album.tracks?.map(track => (
                                <div 
                                  key={track.id}
                                  className="px-2 py-1 text-[11px] text-muted-foreground/80 hover:bg-primary/20 hover:text-primary-foreground rounded-sm cursor-pointer truncate"
                                  onClick={(e) => { e.stopPropagation(); playGroup([track]); }}
                                >
                                  {track.trackNumber ? `${track.trackNumber}. ` : ''}{track.title}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Playlists */}
          <div>
             <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Playlists</span>
              <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-primary">
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="space-y-0.5">
              {playlists.map(pl => (
                <div key={pl.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 rounded-sm cursor-pointer text-sm">
                  <ListMusic className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="truncate flex-1">{pl.name}</span>
                </div>
              ))}
            </div>
          </div>
          
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-border mt-auto">
        <Button variant="ghost" className="w-full justify-start gap-2 h-8 text-xs text-muted-foreground hover:text-foreground" onClick={togglePrefs}>
          <Settings className="w-3.5 h-3.5" />
          Preferences
        </Button>
      </div>
    </div>
  );
}
