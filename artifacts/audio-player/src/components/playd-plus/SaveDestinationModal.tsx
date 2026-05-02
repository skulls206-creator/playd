import { useState, useEffect } from 'react';
import { get } from 'idb-keyval';
import {
  useListPlaylists,
  useCreateTrack,
  useAddTrackToPlaylist,
  getListPlaylistsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ListMusic, FolderOpen, Check, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { YtTrack } from '@/types/yt-track';
import { useToast } from '@/hooks/use-toast';

interface Playlist {
  id: number;
  name: string;
}

type Destination =
  | { kind: 'playlist'; id: number; name: string }
  | { kind: 'folder'; folderName: string };

interface SaveDestinationModalProps {
  open: boolean;
  onClose: () => void;
  tracks: YtTrack[];
}

export function SaveDestinationModal({ open, onClose, tracks }: SaveDestinationModalProps) {
  const { data: rawPlaylists = [] } = useListPlaylists();
  const playlists = rawPlaylists as Playlist[];
  const createTrack = useCreateTrack();
  const addToPlaylist = useAddTrackToPlaylist();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [folders, setFolders] = useState<string[]>([]);
  const [selected, setSelected] = useState<Destination | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    get('music-folders')
      .then((handles: FileSystemDirectoryHandle[] | undefined) => {
        setFolders((handles ?? []).map(h => h.name));
      })
      .catch(() => setFolders([]));
  }, [open]);

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);

    let successCount = 0;
    let failCount = 0;

    for (const yt of tracks) {
      try {
        const folderPath =
          selected.kind === 'folder' ? selected.folderName : '__youtube__';

        const created = await createTrack.mutateAsync({
          data: {
            title: yt.title || 'Unknown Title',
            artist: yt.artist || 'Unknown Artist',
            album: yt.source === 'spotify' ? 'Spotify / YouTube' : 'YouTube',
            duration: yt.duration ?? 0,
            fileName: yt.videoId,
            folderPath,
            albumArtDataUrl: yt.thumbnail ?? null,
            source: 'youtube',
            subsonicId: yt.spotifyId ?? null,
          },
        });

        if (selected.kind === 'playlist') {
          await addToPlaylist.mutateAsync({
            id: selected.id,
            data: { trackId: created.id },
          });
        }

        successCount++;
      } catch {
        failCount++;
      }
    }

    await queryClient.invalidateQueries({ queryKey: getListPlaylistsQueryKey() });

    setSaving(false);
    setSaved(true);

    const destLabel =
      selected.kind === 'playlist' ? `playlist "${selected.name}"` : `folder "${selected.folderName}"`;

    if (failCount === 0) {
      toast({
        title: 'Saved',
        description: `${successCount} track${successCount !== 1 ? 's' : ''} added to ${destLabel}.`,
        duration: 3000,
      });
    } else {
      toast({
        title: 'Partially saved',
        description: `${successCount} saved, ${failCount} failed.`,
        duration: 4000,
      });
    }

    setTimeout(() => {
      setSaved(false);
      setSelected(null);
      onClose();
    }, 800);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && !saving) {
      setSelected(null);
      setSaved(false);
      onClose();
    }
  };

  const label = tracks.length === 1
    ? `Save "${tracks[0].title || 'track'}" to…`
    : `Save ${tracks.length} tracks to…`;

  const hasDestinations = playlists.length > 0 || folders.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{label}</DialogTitle>
        </DialogHeader>

        <div className="py-1">
          {!hasDestinations ? (
            <p className="text-xs text-muted-foreground italic px-1 py-3 text-center">
              No playlists or scanned folders — create a playlist in the sidebar or add a music folder first.
            </p>
          ) : (
            <ScrollArea className="max-h-64">
              <div className="space-y-0.5 pr-2">
                {playlists.length > 0 && (
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2 pt-1 pb-0.5">
                    Playlists
                  </p>
                )}
                {playlists.map(pl => {
                  const dest: Destination = { kind: 'playlist', id: pl.id, name: pl.name };
                  const isActive = selected?.kind === 'playlist' && selected.id === pl.id;
                  return (
                    <button
                      key={`pl-${pl.id}`}
                      onClick={() => setSelected(dest)}
                      className={clsx(
                        'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                        isActive
                          ? 'bg-primary/20 text-primary'
                          : 'text-zinc-300 hover:bg-white/5',
                      )}
                    >
                      <ListMusic className="w-4 h-4 shrink-0 opacity-70" />
                      <span className="truncate flex-1 text-left">{pl.name}</span>
                      {isActive && <Check className="w-4 h-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}

                {folders.length > 0 && (
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2 pt-2 pb-0.5">
                    Local Folders
                  </p>
                )}
                {folders.map(folderName => {
                  const dest: Destination = { kind: 'folder', folderName };
                  const isActive = selected?.kind === 'folder' && selected.folderName === folderName;
                  return (
                    <button
                      key={`folder-${folderName}`}
                      onClick={() => setSelected(dest)}
                      className={clsx(
                        'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                        isActive
                          ? 'bg-primary/20 text-primary'
                          : 'text-zinc-300 hover:bg-white/5',
                      )}
                    >
                      <FolderOpen className="w-4 h-4 shrink-0 opacity-70" />
                      <span className="truncate flex-1 text-left">{folderName}</span>
                      {isActive && <Check className="w-4 h-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={saving}
            className="text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!selected || saving || saved || !hasDestinations}
            className="min-w-20"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saved ? (
              <Check className="w-4 h-4" />
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
