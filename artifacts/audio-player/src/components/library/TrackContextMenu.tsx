import { type ReactNode } from 'react';
import type { Track } from '@workspace/api-client-react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
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
} from 'lucide-react';

interface TrackContextMenuProps {
  track: Track;
  selectedTracks?: Track[];
  queueIndex: number;
  children: ReactNode;
  onPlayNow: () => void;
  onPlaySelected?: () => void;
  onQueueSelected?: () => void;
}

export function TrackContextMenu({
  track,
  selectedTracks = [],
  queueIndex,
  children,
  onPlayNow,
  onPlaySelected,
  onQueueSelected,
}: TrackContextMenuProps) {
  const {
    addToQueueNext,
    addToQueueEnd,
    setLibraryFilter,
    queue,
    isQueueOpen,
    toggleQueue,
  } = useAudioPlayer();

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
      </ContextMenuContent>
    </ContextMenu>
  );
}
