import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pencil, Loader2, CheckCircle2 } from 'lucide-react';
import { useTrackStore, type LocalTrack } from '@/lib/track-store';

interface TrackEditModalProps {
  track: LocalTrack | null;
  open: boolean;
  onClose: () => void;
}

interface FormState {
  title:       string;
  artist:      string;
  album:       string;
  trackNumber: string;
  year:        string;
  genre:       string;
}

function toForm(track: LocalTrack): FormState {
  return {
    title:       track.title       ?? '',
    artist:      track.artist      ?? '',
    album:       track.album       ?? '',
    trackNumber: track.trackNumber != null ? String(track.trackNumber) : '',
    year:        track.year        != null ? String(track.year)        : '',
    genre:       track.genre       ?? '',
  };
}

export function TrackEditModal({ track, open, onClose }: TrackEditModalProps) {
  const [form, setForm] = useState<FormState>(track ? toForm(track) : toForm({} as LocalTrack));
  const [saved, setSaved] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(false);

  // Re-populate form whenever the target track changes
  useEffect(() => {
    if (track) {
      setForm(toForm(track));
      setSaved(false);
      setError(false);
    }
  }, [track?.id]);

  const set_ = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const handleSave = async () => {
    if (!track) return;
    const trackNumber = form.trackNumber.trim() ? parseInt(form.trackNumber, 10) : null;
    const year        = form.year.trim()        ? parseInt(form.year, 10)        : null;

    setIsPending(true);
    setError(false);
    try {
      await useTrackStore.getState().updateTrack(track.id, {
        title:       form.title.trim()  || track.title,
        artist:      form.artist.trim() || 'Unknown Artist',
        album:       form.album.trim()  || 'Unknown Album',
        trackNumber: isNaN(trackNumber!) ? null : trackNumber,
        year:        isNaN(year!)        ? null : year,
        genre:       form.genre.trim()  || null,
      });
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 900);
    } catch {
      setError(true);
    } finally {
      setIsPending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isPending && !saved) handleSave();
    if (e.key === 'Escape') onClose();
  };

  const isBusy = isPending || saved;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isBusy) onClose(); }}>
      <DialogContent
        className="sm:max-w-md bg-zinc-900 border-zinc-700 text-zinc-100"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Pencil className="w-4 h-4 text-primary" />
            Edit Tags
          </DialogTitle>
          <DialogDescription className="text-zinc-400 text-xs leading-relaxed">
            Changes are saved to your library. The audio file on disk is not modified.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-3 gap-y-3 mt-1">
          {/* Title — full width */}
          <div className="col-span-2 flex flex-col gap-1">
            <Label className="text-[11px] text-zinc-400 uppercase tracking-wide">Title</Label>
            <Input
              value={form.title}
              onChange={set_('title')}
              disabled={isBusy}
              autoFocus
              placeholder="Track title"
              className="bg-zinc-800 border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-primary h-8 text-sm"
            />
          </div>

          {/* Artist — full width */}
          <div className="col-span-2 flex flex-col gap-1">
            <Label className="text-[11px] text-zinc-400 uppercase tracking-wide">Artist</Label>
            <Input
              value={form.artist}
              onChange={set_('artist')}
              disabled={isBusy}
              placeholder="Artist name"
              className="bg-zinc-800 border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-primary h-8 text-sm"
            />
          </div>

          {/* Album — full width */}
          <div className="col-span-2 flex flex-col gap-1">
            <Label className="text-[11px] text-zinc-400 uppercase tracking-wide">Album</Label>
            <Input
              value={form.album}
              onChange={set_('album')}
              disabled={isBusy}
              placeholder="Album name"
              className="bg-zinc-800 border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-primary h-8 text-sm"
            />
          </div>

          {/* Track # */}
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-zinc-400 uppercase tracking-wide">Track #</Label>
            <Input
              value={form.trackNumber}
              onChange={set_('trackNumber')}
              disabled={isBusy}
              placeholder="1"
              type="number"
              min={1}
              className="bg-zinc-800 border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-primary h-8 text-sm"
            />
          </div>

          {/* Year */}
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-zinc-400 uppercase tracking-wide">Year</Label>
            <Input
              value={form.year}
              onChange={set_('year')}
              disabled={isBusy}
              placeholder="2024"
              type="number"
              min={1900}
              max={2099}
              className="bg-zinc-800 border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-primary h-8 text-sm"
            />
          </div>

          {/* Genre — full width */}
          <div className="col-span-2 flex flex-col gap-1">
            <Label className="text-[11px] text-zinc-400 uppercase tracking-wide">Genre</Label>
            <Input
              value={form.genre}
              onChange={set_('genre')}
              disabled={isBusy}
              placeholder="Hip-Hop, Jazz, Electronic…"
              className="bg-zinc-800 border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-primary h-8 text-sm"
            />
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-400 mt-1">
            Failed to save — please try again.
          </p>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isBusy}
            className="text-zinc-400 hover:text-zinc-100"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isBusy || !form.title.trim()}
            className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[80px]"
          >
            {saved
              ? <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Saved!</>
              : isPending
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Saving…</>
                : <><Pencil className="w-3.5 h-3.5 mr-1.5" />Save Tags</>
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
