import { useAudioPlayer } from '@/hooks/use-audio-player';

export function PlaydPlusPlaceholder() {
  const { togglePlaydPlusMode } = useAudioPlayer();

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-background text-center px-8 gap-6">
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <span className="text-3xl font-black text-primary tracking-tighter leading-none">+</span>
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground tracking-tight">PLAYD+</h2>
          <p className="text-sm text-muted-foreground mt-1">YouTube discovery &amp; streaming</p>
        </div>
      </div>

      <div className="max-w-xs space-y-2">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Search and stream music from YouTube directly inside PLAYD. Discovery, trending tracks, and more — coming soon.
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <span className="text-xs font-semibold text-primary/60 uppercase tracking-widest">Coming soon</span>
        <button
          onClick={togglePlaydPlusMode}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Back to local library
        </button>
      </div>
    </div>
  );
}
