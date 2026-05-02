import { useAudioPlayer } from '@/hooks/use-audio-player';
import { clsx } from 'clsx';

export function PlaydPlusToggle() {
  const { playdPlusMode, togglePlaydPlusMode } = useAudioPlayer();

  return (
    <button
      onClick={togglePlaydPlusMode}
      title={playdPlusMode ? 'Switch to PLAYD (local library)' : 'Switch to PLAYD+ (discovery)'}
      className={clsx(
        'relative flex items-center rounded-full border text-[10px] font-bold tracking-tight select-none',
        'h-6 min-h-[32px] sm:h-6 sm:min-h-0 overflow-hidden transition-all duration-300',
        playdPlusMode
          ? 'border-primary/60 bg-primary/15'
          : 'border-border/60 bg-white/5',
      )}
      style={{ minWidth: '5rem' }}
    >
      {/* Sliding highlight pill */}
      <span
        className={clsx(
          'absolute top-0 bottom-0 rounded-full bg-primary transition-all duration-300 ease-in-out',
          playdPlusMode ? 'left-[calc(50%-1px)] right-0' : 'left-0 right-[calc(50%-1px)]',
        )}
        style={{ opacity: 0.25 }}
        aria-hidden
      />

      {/* PLAYD label */}
      <span
        className={clsx(
          'relative z-10 flex-1 text-center px-1.5 transition-colors duration-300',
          !playdPlusMode ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        PLAYD
      </span>

      {/* Divider */}
      <span className="relative z-10 w-px h-3 bg-border/50 shrink-0" aria-hidden />

      {/* PLAYD+ label */}
      <span
        className={clsx(
          'relative z-10 flex-1 text-center px-1.5 transition-colors duration-300',
          playdPlusMode ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        PLAYD+
      </span>
    </button>
  );
}
