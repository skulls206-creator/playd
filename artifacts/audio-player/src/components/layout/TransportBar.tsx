import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { 
  Play, Pause, SkipBack, SkipForward, 
  Shuffle, Repeat, Repeat1, Volume2, VolumeX, SlidersHorizontal, ListMusic, Settings
} from 'lucide-react';
import { clsx } from 'clsx';
import { format } from 'date-fns';

function formatTime(seconds: number) {
  if (isNaN(seconds) || !isFinite(seconds)) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function TransportBar() {
  const { 
    currentTrack, isPlaying, progress, duration, volume, isMuted,
    repeatMode, isShuffle, isEqOpen, isQueueOpen, isPrefsOpen,
    play, pause, togglePlay, next, prev, seek, setVolume, toggleMute,
    setRepeatMode, toggleShuffle, toggleEq, toggleQueue, togglePrefs
  } = useAudioPlayer();

  return (
    <div className="h-20 bg-card border-t border-border flex items-center px-4 gap-6 shrink-0 relative z-20">
      
      {/* Track Info (Left) */}
      <div className="flex items-center gap-3 w-1/4 min-w-[200px]">
        <div className="w-12 h-12 bg-black/40 rounded-sm overflow-hidden border border-white/5 shrink-0">
          <img 
            src={currentTrack?.albumArtDataUrl || `${import.meta.env.BASE_URL}images/default-cover.png`} 
            alt="Cover" 
            className="w-full h-full object-cover"
          />
        </div>
        <div className="overflow-hidden flex flex-col justify-center">
          <div className="text-sm font-medium truncate text-foreground">
            {currentTrack?.title || "No track playing"}
          </div>
          <div className="text-xs text-muted-foreground truncate hover:text-foreground transition-colors cursor-pointer">
            {currentTrack?.artist || "-"}
          </div>
        </div>
      </div>

      {/* Controls (Center) */}
      <div className="flex flex-col items-center justify-center flex-1 max-w-2xl gap-2">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" size="icon" 
            className={clsx("h-8 w-8 hover:bg-white/5 hover:text-primary", isShuffle && "text-primary")}
            onClick={toggleShuffle}
          >
            <Shuffle className="w-4 h-4" />
          </Button>
          
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-primary" onClick={prev}>
            <SkipBack className="w-4 h-4 fill-current" />
          </Button>
          
          <Button 
            variant="default" size="icon" 
            className="h-10 w-10 rounded-full bg-foreground text-background hover:bg-primary hover:scale-105 transition-all shadow-lg"
            onClick={togglePlay}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </Button>
          
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-primary" onClick={next}>
            <SkipForward className="w-4 h-4 fill-current" />
          </Button>

          <Button 
            variant="ghost" size="icon" 
            className={clsx("h-8 w-8 hover:bg-white/5 hover:text-primary", repeatMode !== 'off' && "text-primary")}
            onClick={() => setRepeatMode(repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off')}
          >
            {repeatMode === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
          </Button>
        </div>

        <div className="flex items-center gap-3 w-full max-w-md text-[10px] font-mono text-muted-foreground tracking-wider">
          <span>{formatTime(progress)}</span>
          <Slider
            value={[progress]}
            max={duration || 100}
            step={0.1}
            onValueChange={([val]) => seek(val)}
            className="flex-1"
          />
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Extras (Right) */}
      <div className="flex items-center justify-end gap-3 w-1/4 min-w-[200px]">
        <Button
          variant="ghost" size="icon"
          className={clsx("h-8 w-8", isQueueOpen && "bg-primary/20 text-primary")}
          onClick={toggleQueue}
          title="Toggle Queue"
        >
          <ListMusic className="w-4 h-4" />
        </Button>
        <Button 
          variant="ghost" size="icon" 
          className={clsx("h-8 w-8", isEqOpen && "bg-primary/20 text-primary")}
          onClick={toggleEq}
          title="Equalizer"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost" size="icon"
          className={clsx("h-8 w-8", isPrefsOpen && "bg-primary/20 text-primary")}
          onClick={togglePrefs}
          title="Preferences"
        >
          <Settings className="w-4 h-4" />
        </Button>

        <div className="flex items-center gap-2 w-32">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMute}>
            {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <Slider
            value={[isMuted ? 0 : volume * 100]}
            max={100}
            step={1}
            onValueChange={([val]) => setVolume(val / 100)}
            className="w-full"
          />
        </div>
      </div>

    </div>
  );
}
