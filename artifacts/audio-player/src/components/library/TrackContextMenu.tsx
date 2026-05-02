import { type ReactNode, useState } from 'react';
import type { Track } from '@workspace/api-client-react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';
import { openMiniPlayer } from '@/hooks/use-mini-player';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListTracksQueryKey,
  getGetPlaylistTracksQueryKey,
  getListPlaylistsQueryKey,
  customFetch,
  useListPlaylists,
  useCreatePlaylist,
  useAddTrackToPlaylist,
  useRemoveTrackFromPlaylist,
} from '@workspace/api-client-react';
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
  Lock,
  Loader2,
  CheckCircle2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { requestVaultKey, encryptFile } from '@/hooks/use-vault-crypto';

type VaultUploadState = 'idle' | 'encrypting' | 'uploading' | 'done' | 'error';

interface TrackContextMenuProps {
  track: Track;
  selectedTracks?: Track[];
  queueIndex: number;
  children: ReactNode;
  onPlayNow: () => void;
  onPlaySelected?: () => void;
  onQueueSelected?: () => void;
  onEditTags?: (track: Track) => void;
  onEditInClipStudio?: (track: Track) => void;
  onRemoveFromPlaylist?: (track: Track) => void;
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
  const { rescanAll, isScanning, getFileFromPath } = useFileSystem();
  const queryClient = useQueryClient();

  // ── Playlist hooks ────────────────────────────────────────────────────────
  const { data: playlists = [] } = useListPlaylists();
  const addTrackToPlaylist = useAddTrackToPlaylist();
  const removeTrackFromPlaylist = useRemoveTrackFromPlaylist();
  const createPlaylist = useCreatePlaylist();
  const [addingToPlaylist, setAddingToPlaylist] = useState<number | null>(null);

  const handleAddToPlaylist = (playlistId: number) => {
    setAddingToPlaylist(playlistId);
    addTrackToPlaylist.mutate(
      { id: playlistId, data: { trackId: track.id } },
      {
        onSettled: () => {
          queryClient.invalidateQueries({ queryKey: getGetPlaylistTracksQueryKey(playlistId) });
          setAddingToPlaylist(null);
        },
      },
    );
  };

  const handleCreateAndAddToPlaylist = () => {
    const name = `New Playlist`;
    createPlaylist.mutate(
      { data: { name } },
      {
        onSuccess: (pl) => {
          queryClient.invalidateQueries({ queryKey: getListPlaylistsQueryKey() });
          addTrackToPlaylist.mutate(
            { id: pl.id, data: { trackId: track.id } },
            { onSettled: () => queryClient.invalidateQueries({ queryKey: getGetPlaylistTracksQueryKey(pl.id) }) },
          );
          // Navigate to the new playlist
          setLibraryFilter({ type: 'playlist', value: String(pl.id), label: pl.name });
        },
      },
    );
  };

  const handleRemoveFromPlaylist = () => {
    if (libraryFilter.type !== 'playlist') return;
    const playlistId = Number(libraryFilter.value);
    removeTrackFromPlaylist.mutate(
      { id: playlistId, trackId: track.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPlaylistTracksQueryKey(playlistId) });
        },
      },
    );
    onRemoveFromPlaylist?.(track);
  };

  // ── Vault upload state ───────────────────────────────────────────────────
  const [vaultState, setVaultState] = useState<VaultUploadState>('idle');
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultProgress, setVaultProgress] = useState<{ current: number; total: number } | null>(null);

  const handleBulkUploadToVault = async (tracksToUpload: Track[]) => {
    const uploadable = tracksToUpload.filter(t => t.source === 'local');
    if (uploadable.length === 0) return;

    setVaultState('encrypting');
    setVaultError(null);
    const total = uploadable.length;
    setVaultProgress(total > 1 ? { current: 1, total } : null);

    try {
      // Ensure vault key is available — shows unlock modal if not in session.
      const masterKey = await requestVaultKey();

      for (let i = 0; i < uploadable.length; i++) {
        const t = uploadable[i];
        if (total > 1) setVaultProgress({ current: i + 1, total });

        setVaultState('encrypting');
        const file = await getFileFromPath(t.fileName, t.folderPath);
        if (!file) throw new Error(`Could not access file: ${t.fileName}`);

        const { ciphertext, encryptedKey, keyIv, dataIv } = await encryptFile(file, masterKey);

        setVaultState('uploading');

        const { trackId } = await customFetch<{ trackId: number }>(
          '/api/vault/upload-url',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title:             t.title,
              artist:            t.artist,
              album:             t.album,
              year:              t.year,
              genre:             t.genre,
              duration:          t.duration,
              trackNumber:       t.trackNumber,
              fileName:          t.fileName,
              vaultEncryptedKey: encryptedKey,
              vaultKeyIv:        keyIv,
              vaultDataIv:       dataIv,
              blobSize:          ciphertext.byteLength,
              contentType:       'application/octet-stream',
            }),
          },
        );

        // Upload the encrypted binary through the API server, which enforces
        // size limits server-side before writing to R2.
        // Note: Content-Length is set automatically by the browser for binary bodies.
        await customFetch(`/api/vault/upload/${trackId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: ciphertext,
        });
      }

      setVaultProgress(null);
      setVaultState('done');
      queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });
      setTimeout(() => setVaultState('idle'), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setVaultProgress(null);
      if (msg.includes('cancelled')) { setVaultState('idle'); return; }
      setVaultError(msg);
      setVaultState('error');
      setTimeout(() => { setVaultState('idle'); setVaultError(null); }, 4000);
    }
  };

  const handleUploadToVault = () => handleBulkUploadToVault([track]);

  const handleRefreshLibrary = async () => {
    queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });
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
    // openMiniPlayer() is called directly here so the user-gesture activation
    // propagates into documentPictureInPicture.requestWindow() without breaking.
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

            {/* Bulk vault upload — only if at least one selected track is local */}
            {selectedTracks.some(t => t.source === 'local') && (
              <>
                <ContextMenuSeparator className="bg-zinc-700/50" />
                <ContextMenuItem
                  onClick={() => handleBulkUploadToVault(selectedTracks)}
                  disabled={vaultState === 'encrypting' || vaultState === 'uploading'}
                  className={clsx(
                    'gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100',
                    vaultState === 'done'  && 'text-emerald-400',
                    vaultState === 'error' && 'text-red-400',
                  )}
                >
                  {(vaultState === 'encrypting' || vaultState === 'uploading') && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
                  {vaultState === 'done'  && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  {vaultState === 'error' && <Lock className="w-3.5 h-3.5 text-red-400" />}
                  {vaultState === 'idle'  && <Lock className="w-3.5 h-3.5 text-zinc-400" />}
                  {vaultState === 'encrypting' && vaultProgress
                    ? `Encrypting ${vaultProgress.current}/${vaultProgress.total}…`
                    : vaultState === 'encrypting' ? 'Encrypting…' : null}
                  {vaultState === 'uploading' && vaultProgress
                    ? `Uploading ${vaultProgress.current}/${vaultProgress.total}…`
                    : vaultState === 'uploading' ? 'Uploading…' : null}
                  {vaultState === 'done'  && `Uploaded ${selectedTracks.filter(t => t.source === 'local').length} tracks!`}
                  {vaultState === 'error' && (vaultError ? `Error: ${vaultError.slice(0, 28)}` : 'Upload failed')}
                  {vaultState === 'idle'  && `Upload ${selectedTracks.filter(t => t.source === 'local').length} tracks to Vault`}
                </ContextMenuItem>
              </>
            )}

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

            {/* Edit Tags — below navigation, above playlist/vault */}
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

            {/* Upload to Vault — local tracks only, not already in vault */}
            {track.source === 'local' && (
              <>
                <ContextMenuSeparator className="bg-zinc-700/50" />
                <ContextMenuItem
                  onClick={handleUploadToVault}
                  disabled={vaultState === 'encrypting' || vaultState === 'uploading'}
                  className={clsx(
                    'gap-2.5 cursor-pointer focus:bg-white/8 focus:text-zinc-100',
                    vaultState === 'done' && 'text-emerald-400',
                    vaultState === 'error' && 'text-red-400',
                  )}
                >
                  {vaultState === 'encrypting' && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
                  {vaultState === 'uploading'  && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
                  {vaultState === 'done'       && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  {vaultState === 'error'      && <Lock className="w-3.5 h-3.5 text-red-400" />}
                  {vaultState === 'idle'       && <Lock className="w-3.5 h-3.5 text-zinc-400" />}
                  {vaultState === 'encrypting' && 'Encrypting…'}
                  {vaultState === 'uploading'  && 'Uploading to vault…'}
                  {vaultState === 'done'       && 'Uploaded to vault!'}
                  {vaultState === 'error'      && (vaultError ? `Error: ${vaultError.slice(0, 30)}` : 'Upload failed')}
                  {vaultState === 'idle'       && 'Upload to Vault'}
                </ContextMenuItem>
              </>
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
