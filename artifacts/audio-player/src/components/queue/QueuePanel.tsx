import { useAudioPlayer } from '@/hooks/use-audio-player';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Play } from 'lucide-react';
import { clsx } from 'clsx';
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

export function QueuePanel() {
  const { queue, queueIndex, currentTrack, play } = useAudioPlayer();

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden relative">
      {/* Table Header */}
      <div className="grid grid-cols-[40px_minmax(200px,2fr)_minmax(150px,1fr)_minmax(150px,1fr)_80px] gap-2 px-4 py-2 border-b border-border bg-card/50 text-[10px] font-bold tracking-widest uppercase text-muted-foreground sticky top-0 z-10">
        <div className="text-center">#</div>
        <div>Title</div>
        <div>Artist</div>
        <div>Album</div>
        <div className="text-right">Time</div>
      </div>

      {queue.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm flex-col gap-4">
          <div className="w-16 h-16 rounded-full border border-dashed border-border flex items-center justify-center">
            <Play className="w-6 h-6 text-border ml-1" />
          </div>
          Queue is empty.<br/>Double-click tracks in the library to play.
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-1 pb-20">
            {queue.map((item, idx) => {
              const isActive = idx === queueIndex;
              
              return (
                <ContextMenu key={`${item.trackId}-${idx}`}>
                  <ContextMenuTrigger>
                    <div 
                      onDoubleClick={() => play(item.track, queue, idx)}
                      className={clsx(
                        "grid grid-cols-[40px_minmax(200px,2fr)_minmax(150px,1fr)_minmax(150px,1fr)_80px] gap-2 px-3 py-1.5 text-xs rounded-sm cursor-pointer group select-none transition-colors",
                        isActive 
                          ? "bg-primary/20 text-primary-foreground font-medium" 
                          : "text-muted-foreground hover:bg-white/5 hover:text-foreground odd:bg-card/30"
                      )}
                    >
                      <div className="text-center text-[10px] opacity-50 flex items-center justify-center">
                        {isActive ? <Play className="w-3 h-3 fill-primary text-primary" /> : idx + 1}
                      </div>
                      <div className="truncate">{item.track.title}</div>
                      <div className="truncate opacity-80">{item.track.artist}</div>
                      <div className="truncate opacity-80">{item.track.album}</div>
                      <div className="text-right font-mono text-[11px] opacity-70">{formatDuration(item.track.duration)}</div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-48 bg-card/95 backdrop-blur-md border-border/50 shadow-xl">
                    <ContextMenuItem onClick={() => play(item.track, queue, idx)}>Play Now</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem>Remove from Queue</ContextMenuItem>
                    <ContextMenuItem>Move to Top</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem>Edit Tags...</ContextMenuItem>
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
