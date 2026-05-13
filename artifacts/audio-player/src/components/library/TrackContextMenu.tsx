import { type ReactNode, useState } from 'react';
import { useTrackStore, type LocalTrack } from '@/lib/track-store';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';
import { openMiniPlayer } from '@/hooks/use-mini-player';
import { clsx } from 'clsx';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/ui/context-menu';
import {
  Play,
  ListEnd,
  ListStart,
  User,
  Disc3,
  Copy,
  FolderOpen,
  ListMusic,
  Scissors,
  PictureInPicture2,
  RefreshCw,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

interface TrackContextMenuProps {
  track: LocalTrack;
  selectedTracks?: LocalTrack[];
  queueIndex: number;
  children: ReactNode;
  onPlayNow: () => void;
  onPlaySelected?: () => void;
  onQueueSelected?: () => void;
  onEditTags?: (track: LocalTrack) => void;
  onEditInClipStudio?: (track: LocalTrack) => void;
  onRemoveFromPlaylist?: (track: LocalTrack) => void;
}

export function TrackContextMenu({
  track,
  selectedTracks = [],
  queueIndex,
  children,
  onPlayNow,
  onPlaySelected,
  onQueueSelected,
  onEditTags,
  onEditInClipStudio,
  onRemoveFromPlaylist,
}: TrackContextMenuProps) {
  const {
    addToQueueNext,
    addToQueueEnd,
    setLibraryFilter,
    queue,
    isQueueOpen,
    toggleQueue,
    isMiniPlayer,
    libraryFilter,
  } = useAudioPlayer();
  const { rescanAll, isScanning } = useFileSystem();

  // ── Playlist state from local store ─────────────────────────────────────
  const playlists = useTrackStore(s => s.playlists);
  const [addingToPlaylist, setAddingToPlaylist] = useState<number | null>(null);

  const handleAddToPlaylist = async (playlistId: number) => {
    setAddingToPlaylist(playlistId);
    try {
      await useTrackStore.getState().addTrackToPlaylist(playlistId, track.id);
    } finally {
      setAddingToPlaylist(null);
    }
  };

  const handleCreateAndAddToPlaylist = async () => {
    const name = `New Playlist`;
    const pl = await useTrackStore.getState().createPlaylist(name);
    await useTrackStore.getState().addTrackToPlaylist(pl.id, track.id);
    // Navigate to the new playlist
    setLibraryFilter({ type: 'playlist', value: String(pl.id), label: pl.name });
  };

  const handleRemoveFromPlaylist = async () => {
    if (libraryFilter.type !== 'playlist') return;
    const playlistId = Number(libraryFilter.value);
    await useTrackStore.getState().removeTrackFromPlaylist(playlistId, track.id);
    onRemoveFromPlaylist?.(track);
  };

  const handleRefreshLibrary = async () => {
    await rescanAll();
  };

  const isMulti = selectedTracks.length > 1;
  const count = selectedTracks.length;

  const handlePlayNext = () => {
    if (queue.length === 0) { onPlayNow(); return; }
    addToQueueNext(track);
    if (!isQueueOpen) toggleQueue();
  };

  const handleAddToEnd = () => {
    addToQueueEnd(track);
    if (!isQueueOpen) toggleQueue();
  };

  const handleGoToArtist = () => {
    if (!track.artist) return;
    setLibraryFilter({ type: 'artist', value: track.artist, label: track.artist });
  };

  const handleGoToAlbum = () => {
    if (!track.album) return;
    setLibraryFilter({ type: 'album', value: track.album, label: track.album });
  };

  const handlePopOutPlayer = () => {
    onPlayNow();
    openMiniPlayer();
  };

  const handleCopyTitle = () => {
    navigator.clipboard.writeText(track.title || '').catch(() => {});
  };

  const handleCopyFull = () => {
    const text = [track.artist, track.title].filter(Boolean).join(' – ');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const handleCopyFilePath = () => {
    const path = track.folderPath
      ? `${track.folderPath}/${track.fileName}`
      : (track.fileName || '');
    navigator.clipboard.writeText(path).catch(() => {});
  };

  const handleQueueSelected = () => {
    if (onQueueSelected) onQueueSelected();
    if (!isQueueOpen) toggleQueue();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>

      <ContextMenuContent className="w-56 bg-zinc-900 border-zinc-700 text-zinc-100 shadow-2xl">
        {/* Track info header */}
        <div className="px-3 py-2 border-b border-zinc-700/60 mb-1">
          {isMulti ? (
            <>
              <p className="text-xs font-semibold text-zinc-100">{count} tracks selected</p>
              <p className="text-[10px] text-zinc-400 truncate">
                {selectedTracks.slice(0, 3).map(t => t.title).join(', ')}
                {count > 3 && `… +${count - 3} more`}
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold truncate text-zinc-100">{track.title}</p>
              <p className="text-[10px] text-zinc-400 truncate">{track.artist || 'Unknown Artist'}</p>
            </>
          )}
        </div>

        {/* Bulk actions when multiple selected */}
        {isMulti ? (
          <>
            <ContextMenuItem
              onClick={onPlaySelected}
              className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100"
            >
              <Play className="w-3.5 h-3.5 text-[#FF3C00]" />
              Play {count} tracks
            </ContextMenuItem>

            <ContextMenuItem
              onClick={handleQueueSelected}
              className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100"
            >
              <ListEnd className="w-3.5 h-3.5 text-zinc-400" />
              Add {count} to end of queue
            </ContextMenuItem>

            <ContextMenuSeparator className="bg-zinc-700/50" />

            <ContextMenuItem
              onClick={onPlayNow}
              className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100 text-zinc-400"
            >
              <ListMusic className="w-3.5 h-3.5 text-zinc-500" />
              Play this track only
            </ContextMenuItem>
          </>
        ) : (
          <>
            {/* Single track playback */}
            <ContextMenuItem
              onClick={onPlayNow}
              className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100"
            >
              <Play className="w-3.5 h-3.5 text-[#FF3C00]" />
              Play Now
            </ContextMenuItem>
            <ContextMenuItem
              onClick={handlePopOutPlayer}
              className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100"
            >
              <PictureInPicture2 className={clsx(
                'w-3.5 h-3.5',
                isMiniPlayer ? 'text-primary' : 'text-zinc-400',
              )} />
              {isMiniPlayer ? 'Mini Player Open' : 'Pop Out Player'}
            </ContextMenuItem>

            <ContextMenuSeparator className="bg-zinc-700/50" />

            <ContextMenuItem
              onClick={handlePlayNext}
              className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100"
            >
              <ListStart className="w-3.5 h-3.5 text-zinc-400" />
              Play Next
            </ContextMenuItem>
            <ContextMenuItem
              onClick={handleAddToEnd}
              className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100"
            >
              <ListEnd className="w-3.5 h-3.5 text-zinc-400" />
              Add to End of Queue
            </ContextMenuItem>

            <ContextMenuSeparator className="bg-zinc-700/50" />

            {/* Navigation */}
            {track.artist && (
              <ContextMenuItem
                onClick={handleGoToArtist}
                className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100"
              >
                <User className="w-3.5 h-3.5 text-zinc-400" />
                Go to Artist
                <span className="ml-auto text-[10px] text-zinc-500 truncate max-w-[80px]">{track.artist}</span>
              </ContextMenuItem>
            )}
            {track.album && (
              <ContextMenuItem
                onClick={handleGoToAlbum}
                className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100"
              >
                <Disc3 className="w-3.5 h-3.5 text-zinc-400" />
                Go to Album
                <span className="ml-auto text-[10px] text-zinc-500 truncate max-w-[80px]">{track.album}</span>
              </ContextMenuItem>
            )}

            {/* Edit Tags — below navigation, above playlist */}
            {onEditTags && (
              <>
                <ContextMenuSeparator className="bg-zinc-700/50" />
                <ContextMenuItem
                  onClick={() => onEditTags(track)}
                  className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100"
                >
                  <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                  Edit Tags…
                </ContextMenuItem>
              </>
            )}

            {/* Add to Playlist + Remove from Playlist */}
            <ContextMenuSeparator className="bg-zinc-700/50" />
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100 data-[state=open]:bg-white/8">
                <ListMusic className="w-3.5 h-3.5 text-zinc-400" />
                Add to Playlist
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-52 bg-zinc-900 border-zinc-700 text-zinc-100 shadow-2xl max-h-64 overflow-y-auto">
                {playlists.length === 0 && (
                  <div className="px-3 py-2 text-[10px] text-zinc-500 italic">No playlists yet</div>
                )}
                {playlists.map(pl => (
                  <ContextMenuItem
                    key={pl.id}
                    onClick={() => handleAddToPlaylist(pl.id)}
                    disabled={addingToPlaylist === pl.id}
                    className="gap-2 cursor-pointer text-xs focus:bg-white/8 focus:text-zinc-100"
                  >
                    {addingToPlaylist === pl.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      : <ListMusic className="w-3.5 h-3.5 text-zinc-500" />}
                    <span className="truncate">{pl.name}</span>
                  </ContextMenuItem>
                ))}
                <ContextMenuSeparator className="bg-zinc-700/50" />
                <ContextMenuItem
                  onClick={handleCreateAndAddToPlaylist}
                  className="gap-2 cursor-pointer text-xs focus:bg-white/8 text-primary focus:text-primary"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New playlist with this track
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            {/* Remove from Playlist — only visible when inside a playlist view */}
            {libraryFilter.type === 'playlist' && (
              <ContextMenuItem
                onClick={handleRemoveFromPlaylist}
                className="gap-2.5 cursor-pointer focus:bg-white/8 text-red-400 focus:text-red-300"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove from Playlist
              </ContextMenuItem>
            )}

            {/* Edit in Clip Studio — local tracks only */}
            {track.source === 'local' && onEditInClipStudio && (
              <>
                <ContextMenuSeparator className="bg-zinc-700/50" />
                <ContextMenuItem
                  onClick={() => onEditInClipStudio(track)}
                  className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100"
                >
                  <Scissors className="w-3.5 h-3.5 text-zinc-400" />
                  Edit in Clip Studio
                </ContextMenuItem>
              </>
            )}

            <ContextMenuSeparator className="bg-zinc-700/50" />

            {/* Copy */}
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100 data-[state=open]:bg-white/8">
                <Copy className="w-3.5 h-3.5 text-zinc-400" />
                Copy
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48 bg-zinc-900 border-zinc-700 text-zinc-100 shadow-2xl">
                <ContextMenuItem
                  onClick={handleCopyTitle}
                  className="gap-2 cursor-pointer text-xs focus:bg-white/8 focus:text-zinc-100"
                >
                  Title only
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={handleCopyFull}
                  className="gap-2 cursor-pointer text-xs focus:bg-white/8 focus:text-zinc-100"
                >
                  Artist – Title
                </ContextMenuItem>
                {track.source === 'local' && track.fileName && (
                  <>
                    <ContextMenuSeparator className="bg-zinc-700/50" />
                    <ContextMenuItem
                      onClick={handleCopyFilePath}
                      className="gap-2 cursor-pointer text-xs focus:bg-white/8 focus:text-zinc-100"
                    >
                      <FolderOpen className="w-3 h-3 text-zinc-500" />
                      File path
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}

        {/* Refresh Library — always visible at the bottom */}
        <ContextMenuSeparator className="bg-zinc-700/50" />
        <ContextMenuItem
          onClick={handleRefreshLibrary}
          disabled={isScanning}
          className="gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100 text-zinc-400"
        >
          <RefreshCw className={clsx('w-3.5 h-3.5 text-zinc-500', isScanning && 'animate-spin')} />
          {isScanning ? 'Refreshing…' : 'Refresh Library'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
