import { useAudioPlayer } from '@/hooks/use-audio-player';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Play, X, ListMusic } from 'lucide-react';
import { clsx } from 'clsx';
import type { LocalTrack } from '@/lib/track-store';
import { 
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

function formatDuration(seconds: number) {
  if (!seconds) return "-:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function QueuePanel({ onEditTags }: { onEditTags?: (track: LocalTrack) => void }) {
  const { queue, queueIndex, play, toggleQueue, setQueue } = useAudioPlayer();

  return (
    <div className="w-72 flex-shrink-0 flex flex-col bg-card border-l border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-8 border-b border-border shrink-0 bg-black/20">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <ListMusic className="w-3 h-3" />
          Queue
          {queue.length > 0 && (
            <span className="ml-1 opacity-50">{queue.length}</span>
          )}
        </div>
        <Button
          variant="ghost" size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
          onClick={toggleQueue}
        >
          <X className="w-3 h-3" />
        </Button>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[28px_minmax(0,2fr)_minmax(0,1fr)_44px] gap-2 px-3 py-1 border-b border-border/50 bg-black/10 text-[9px] font-bold tracking-widest uppercase text-muted-foreground shrink-0">
        <div className="text-center">#</div>
        <div>Title</div>
        <div>Artist</div>
        <div className="text-right">Time</div>
      </div>

      {queue.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs flex-col gap-3 p-4 text-center">
          <div className="w-12 h-12 rounded-full border border-dashed border-border flex items-center justify-center">
            <Play className="w-5 h-5 text-border ml-0.5" />
          </div>
          Queue is empty.
          <span className="text-[10px] opacity-50">Double-click tracks to play</span>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="pb-4">
            {queue?.map((item, idx) => {
              const isActive = idx === queueIndex;
              return (
                <ContextMenu key={`${item.trackId}-${idx}`}>
                  <ContextMenuTrigger>
                    <div
                      onDoubleClick={() => play(item.track, queue, idx)}
                      className={clsx(
                        "grid grid-cols-[28px_minmax(0,2fr)_minmax(0,1fr)_44px] gap-2 px-3 py-1 text-[11px] rounded-sm cursor-pointer group select-none transition-colors border-b border-border/10",
                        isActive
                          ? "bg-primary/15 text-primary font-medium"
                          : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                      )}
                    >
                      <div className="text-center text-[10px] opacity-50 flex items-center justify-center">
                        {isActive ? <Play className="w-2.5 h-2.5 fill-primary text-primary" /> : idx + 1}
                      </div>
                      <div className="truncate">{item.track.title}</div>
                      <div className="truncate opacity-70">{item.track.artist}</div>
                      <div className="text-right font-mono text-[10px] opacity-60">{formatDuration(item.track.duration ?? 0)}</div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-48 bg-card/95 backdrop-blur-md border-border/50 shadow-xl">
                    <ContextMenuItem onClick={() => play(item.track, queue, idx)}>Play Now</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => {
                      const filtered = queue.filter((_, i) => i !== idx);
                      setQueue(filtered.map((qi, i) => ({ ...qi, position: i })));
                    }}>Remove from Queue</ContextMenuItem>
                    <ContextMenuItem onClick={() => {
                      const items = [...queue];
                      const [moved] = items.splice(idx, 1);
                      setQueue([moved, ...items].map((qi, i) => ({ ...qi, position: i })));
                    }}>Move to Top</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => onEditTags?.(item.track)}>Edit Tags…</ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
