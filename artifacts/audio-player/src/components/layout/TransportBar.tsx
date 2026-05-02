import { useState, useRef, useEffect } from 'react';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useTrackArt } from '@/hooks/use-track-art';
import { openMiniPlayer, closeMiniPlayer } from '@/hooks/use-mini-player';
import {
  Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, Volume2, VolumeX,
  SlidersHorizontal, ListMusic, Settings, ChevronDown, Moon,
  PictureInPicture2, Youtube,
} from 'lucide-react';
import { clsx } from 'clsx';

function YtSourceBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  return (
    <span
      title="Streaming from YouTube"
      className={clsx(
        'inline-flex items-center gap-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 shrink-0 font-bold tracking-wide uppercase',
        size === 'md' ? 'px-1.5 py-0.5 text-[10px]' : 'px-1 py-px text-[9px]',
      )}
    >
      <Youtube className={size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5'} />
      YT
    </span>
  );
}

function formatTime(seconds: number) {
  if (isNaN(seconds) || !isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function SleepTimerButton() {
  const { sleepTimerExpiry, sleepTimerMode, setSleepTimer, setSleepTimerEndOfTrack, clearSleepTimer } = useAudioPlayer();
  const [open, setOpen] = useState(false);
  const [customMins, setCustomMins] = useState('');
  const [badge, setBadge] = useState<string | null>(null);

  // Update the countdown badge every 30 s
  useEffect(() => {
    const update = () => {
      if (sleepTimerMode === 'track') { setBadge('EOT'); return; }
      if (!sleepTimerExpiry) { setBadge(null); return; }
      const remaining = sleepTimerExpiry - Date.now();
      if (remaining <= 0) { setBadge(null); return; }
      const m = Math.ceil(remaining / 60_000);
      setBadge(`${m}m`);
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [sleepTimerExpiry, sleepTimerMode]);

  const isActive = sleepTimerMode !== null;

  const handlePreset = (mins: number) => {
    setSleepTimer(mins * 60_000);
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    setOpen(false);
  };

  const handleEndOfTrack = () => {
    setSleepTimerEndOfTrack();
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    setOpen(false);
  };

  const handleCustom = () => {
    const m = parseInt(customMins, 10);
    if (!m || m < 1) return;
    handlePreset(m);
    setCustomMins('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={clsx(
            'relative h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors',
            isActive
              ? 'text-primary hover:text-primary/80'
              : 'text-foreground/70 hover:text-foreground hover:bg-white/5',
          )}
          title="Sleep Timer"
        >
          {badge
            ? <span className="text-[10px] font-bold tabular-nums text-primary leading-none">{badge}</span>
            : <Moon className="w-4 h-4" />}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-56 p-3 space-y-3">
        <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">Sleep Timer</p>

        {/* Preset buttons */}
        <div className="grid grid-cols-2 gap-1.5">
          {[15, 30, 45, 60].map(m => (
            <Button
              key={m}
              variant={sleepTimerMode === 'time' && sleepTimerExpiry && Math.round((sleepTimerExpiry - Date.now()) / 60_000) === m ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-7"
              onClick={() => handlePreset(m)}
            >
              {m} min
            </Button>
          ))}
        </div>

        {/* End of track */}
        <Button
          variant={sleepTimerMode === 'track' ? 'default' : 'outline'}
          size="sm"
          className="w-full text-xs h-7"
          onClick={handleEndOfTrack}
        >
          End of track
        </Button>

        {/* Custom minutes */}
        <div className="flex gap-1.5">
          <input
            type="number"
            min={1}
            max={999}
            value={customMins}
            onChange={e => setCustomMins(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCustom()}
            placeholder="Custom mins"
            className="flex-1 h-7 rounded border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button size="sm" className="h-7 px-2 text-xs" onClick={handleCustom}>Set</Button>
        </div>

        {/* Cancel */}
        {isActive && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs h-7 text-destructive hover:text-destructive"
            onClick={() => { clearSleepTimer(); setOpen(false); }}
          >
            Cancel timer
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function TransportBar() {
  const {
    currentTrack, isPlaying, progress, duration, volume, isMuted,
    repeatMode, isShuffle, isEqOpen, isQueueOpen, isPrefsOpen, isMiniPlayer,
    togglePlay, next, prev, seek, setVolume, toggleMute,
    setRepeatMode, toggleShuffle, toggleEq, toggleQueue, togglePrefs,
  } = useAudioPlayer();

  const artUrl = useTrackArt(currentTrack ?? null);
  const defaultCover = `${import.meta.env.BASE_URL}images/default-cover.png`;
  const coverSrc = artUrl || defaultCover;

  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);

  const toggleNowPlaying = () => {
    if (!currentTrack) return;
    setNowPlayingOpen(v => !v);
  };

  // ── Mobile volume long-press popup ───────────────────────────────────────
  const [mobileVolOpen, setMobileVolOpen] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didOpen = useRef(false);

  const onVolPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    didOpen.current = false;
    holdTimer.current = setTimeout(() => {
      didOpen.current = true;
      setMobileVolOpen(true);
    }, 400);
  };

  const onVolPointerUp = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (!didOpen.current) toggleMute();
  };

  const onVolPointerCancel = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
  };

  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);

  const progressPct = duration ? (progress / duration) * 100 : 0;

  return (
    <div className="bg-card border-t border-border shrink-0 relative z-20">

      {/* ── Now Playing sheet — slides up from above the transport bar ─── */}
      <div
        className={clsx(
          'absolute bottom-full left-0 right-0 bg-[#0e0e10]/95 backdrop-blur-xl border-t border-border shadow-2xl',
          'transition-all duration-300 ease-in-out overflow-hidden',
          nowPlayingOpen ? 'max-h-[80vh]' : 'max-h-0',
        )}
      >
        {/* Drag-down pill */}
        <div className="flex justify-center pt-3 pb-1">
          <button
            onClick={toggleNowPlaying}
            className="flex items-center gap-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            title="Close"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col items-center px-6 pb-10 gap-5">
          {/* Large album art — click to close */}
          <div
            className="w-full max-w-xs aspect-square rounded-2xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.7)] cursor-pointer"
            onClick={toggleNowPlaying}
            title="Close"
          >
            <img
              src={coverSrc}
              alt={currentTrack?.title ?? 'Cover'}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Track info */}
          <div className="text-center w-full max-w-xs">
            <p className="text-xl font-bold truncate text-foreground">
              {currentTrack?.title || '—'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-1">
              <p className="text-sm text-primary truncate">
                {currentTrack?.artist || '—'}
              </p>
              {currentTrack?.source === 'youtube' && <YtSourceBadge size="md" />}
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile layout (< sm) ─────────────────────────────────── */}
      <div className="sm:hidden">

        {/* ── Row 1: Info strip ─────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-1">
          {/* Album art — tap to open now-playing sheet */}
          <button
            className="w-9 h-9 bg-black/40 rounded-sm overflow-hidden border border-white/5 shrink-0 hover:ring-1 hover:ring-primary/50 transition-all"
            onClick={toggleNowPlaying}
            title="Now Playing"
          >
            <img src={coverSrc} alt="Cover" className="w-full h-full object-cover" />
          </button>

          {/* Title + artist — tap to open now-playing sheet */}
          <button
            className="flex-1 min-w-0 text-left overflow-hidden"
            onClick={toggleNowPlaying}
          >
            <div className="flex items-center gap-1.5">
              <div className="text-sm font-semibold truncate text-foreground leading-tight">
                {currentTrack?.title || 'No track playing'}
              </div>
              {currentTrack?.source === 'youtube' && <YtSourceBadge />}
            </div>
            <div className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
              {currentTrack?.artist || '—'}
            </div>
          </button>

          {/* Elapsed / total — right-aligned, stacked */}
          <div className="shrink-0 text-right font-mono leading-tight tabular-nums">
            <div className="text-xs text-foreground/70">{formatTime(progress)}</div>
            <div className="text-[10px] text-muted-foreground/50">{formatTime(duration)}</div>
          </div>
        </div>

        {/* ── Row 2: Seek bar ────────────────────────────────────────── */}
        <div className="px-3 py-1.5">
          <Slider
            value={[progress]}
            max={duration || 100}
            step={0.1}
            onValueChange={([val]) => seek(val)}
            className="w-full"
          />
        </div>

        {/* ── Row 3: Controls ───────────────────────────────────────── */}
        <div className="flex items-center justify-between px-2 pb-2">

          {/* Transport + mode cluster */}
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost" size="icon"
              className={clsx('h-8 w-8 hover:bg-white/5', isShuffle ? 'text-primary' : 'text-foreground/60')}
              onClick={toggleShuffle}
              title="Shuffle"
            >
              <Shuffle className="w-3.5 h-3.5" />
            </Button>

            <Button variant="ghost" size="icon" className="h-8 w-8 text-foreground/80" onClick={prev}>
              <SkipBack className="w-4 h-4 fill-current" />
            </Button>

            <Button
              variant="default" size="icon"
              className="h-10 w-10 rounded-full bg-foreground text-background hover:bg-primary hover:scale-105 transition-all shadow-lg mx-0.5"
              onClick={togglePlay}
            >
              {isPlaying
                ? <Pause className="w-5 h-5 fill-current" />
                : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </Button>

            <Button variant="ghost" size="icon" className="h-8 w-8 text-foreground/80" onClick={next}>
              <SkipForward className="w-4 h-4 fill-current" />
            </Button>

            <Button
              variant="ghost" size="icon"
              className={clsx('h-8 w-8 hover:bg-white/5', repeatMode !== 'off' ? 'text-primary' : 'text-foreground/60')}
              onClick={() => setRepeatMode(repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off')}
              title={repeatMode === 'one' ? 'Repeat one' : repeatMode === 'all' ? 'Repeat all' : 'Repeat off'}
            >
              {repeatMode === 'one'
                ? <Repeat1 className="w-3.5 h-3.5" />
                : <Repeat className="w-3.5 h-3.5" />}
            </Button>
          </div>

          {/* Secondary controls cluster */}
          <div className="flex items-center gap-0.5">
            {/* Volume: tap = mute, hold = vertical slider popup */}
            <div className="relative">
              {mobileVolOpen && (
                <div
                  className="fixed inset-0 z-40"
                  onPointerDown={() => setMobileVolOpen(false)}
                />
              )}
              {mobileVolOpen && (
                <div
                  className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 bg-card/95 backdrop-blur border border-border rounded-2xl shadow-2xl px-3 py-4"
                  onPointerDown={e => e.stopPropagation()}
                >
                  <span className="text-[10px] font-mono text-foreground/60 tabular-nums">
                    {Math.round(isMuted ? 0 : volume * 100)}%
                  </span>
                  <div className="h-32 flex items-center justify-center">
                    <Slider
                      orientation="vertical"
                      min={0}
                      max={100}
                      step={1}
                      value={[isMuted ? 0 : Math.round(volume * 100)]}
                      onValueChange={([val]) => {
                        setVolume(val / 100);
                        if (val > 0 && isMuted) toggleMute();
                      }}
                      className="h-32"
                    />
                  </div>
                  <button
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    onPointerDown={e => { e.stopPropagation(); toggleMute(); }}
                  >
                    {isMuted || volume === 0
                      ? <VolumeX className="w-4 h-4" />
                      : <Volume2 className="w-4 h-4" />}
                  </button>
                </div>
              )}
              <button
                className="h-8 w-8 inline-flex items-center justify-center rounded-md text-foreground/60 hover:text-foreground hover:bg-white/5 transition-colors select-none touch-none"
                onPointerDown={onVolPointerDown}
                onPointerUp={onVolPointerUp}
                onPointerLeave={onVolPointerCancel}
                onPointerCancel={onVolPointerCancel}
                onContextMenu={e => e.preventDefault()}
              >
                {isMuted || volume === 0
                  ? <VolumeX className="w-3.5 h-3.5" />
                  : <Volume2 className="w-3.5 h-3.5" />}
              </button>
            </div>

            <SleepTimerButton />

            <Button
              variant="ghost" size="icon"
              className={clsx('h-8 w-8', isMiniPlayer && 'text-primary bg-primary/10')}
              onClick={() => isMiniPlayer ? closeMiniPlayer() : openMiniPlayer()}
              title="Mini Player"
            >
              <PictureInPicture2 className="w-3.5 h-3.5" />
            </Button>

            <Button
              variant="ghost" size="icon"
              className={clsx('h-8 w-8', isPrefsOpen && 'text-primary')}
              onClick={togglePrefs}
              title="Preferences"
            >
              <Settings className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Desktop layout (sm+) ─────────────────────────────────── */}
      <div className="hidden sm:flex items-center h-20 px-4 gap-6">

        {/* Track Info (Left) — clickable to open now playing */}
        <button
          className="flex items-center gap-3 w-1/4 min-w-[160px] text-left group"
          onClick={toggleNowPlaying}
          title="Now Playing"
        >
          <div className="w-12 h-12 bg-black/40 rounded-sm overflow-hidden border border-white/5 shrink-0 group-hover:ring-1 group-hover:ring-primary/50 transition-all">
            <img
              src={coverSrc}
              alt="Cover"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="overflow-hidden flex flex-col justify-center">
            <div className="flex items-center gap-1.5">
              <div className="text-sm font-medium truncate text-foreground group-hover:text-primary transition-colors">
                {currentTrack?.title || 'No track playing'}
              </div>
              {currentTrack?.source === 'youtube' && <YtSourceBadge />}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {currentTrack?.artist || '—'}
            </div>
          </div>
        </button>

        {/* Controls (Center) */}
        <div className="flex flex-col items-center justify-center flex-1 max-w-2xl gap-2">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost" size="icon"
              className={clsx('h-8 w-8 hover:bg-white/5 hover:text-primary', isShuffle && 'text-primary')}
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
              {isPlaying
                ? <Pause className="w-5 h-5 fill-current" />
                : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-primary" onClick={next}>
              <SkipForward className="w-4 h-4 fill-current" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className={clsx('h-8 w-8 hover:bg-white/5 hover:text-primary', repeatMode !== 'off' && 'text-primary')}
              onClick={() => setRepeatMode(repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off')}
            >
              {repeatMode === 'one'
                ? <Repeat1 className="w-4 h-4" />
                : <Repeat className="w-4 h-4" />}
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
        <div className="flex items-center justify-end gap-2 w-1/4 min-w-[160px]">
          <SleepTimerButton />
          <Button
            variant="ghost" size="icon"
            className={clsx('h-8 w-8', isMiniPlayer && 'bg-primary/20 text-primary')}
            onClick={() => isMiniPlayer ? closeMiniPlayer() : openMiniPlayer()}
            title="Mini Player"
          >
            <PictureInPicture2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className={clsx('h-8 w-8', isQueueOpen && 'bg-primary/20 text-primary')}
            onClick={toggleQueue}
            title="Queue"
          >
            <ListMusic className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className={clsx('h-8 w-8', isEqOpen && 'bg-primary/20 text-primary')}
            onClick={toggleEq}
            title="Equalizer"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className={clsx('h-8 w-8', isPrefsOpen && 'bg-primary/20 text-primary')}
            onClick={togglePrefs}
            title="Preferences"
          >
            <Settings className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2 w-28">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={toggleMute}>
              {isMuted || volume === 0
                ? <VolumeX className="w-4 h-4" />
                : <Volume2 className="w-4 h-4" />}
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
    </div>
  );
}
