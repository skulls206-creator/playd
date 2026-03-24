import { SkipBack, SkipForward, Play, Pause, Minimize2, Maximize2, X } from 'lucide-react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useTrackArt } from '@/hooks/use-track-art';
import { clsx } from 'clsx';

interface MiniPlayerContentProps {
  compact: boolean;
  onToggleCompact: () => void;
  onClose: () => void;
}

export function MiniPlayerContent({ compact, onToggleCompact, onClose }: MiniPlayerContentProps) {
  const { currentTrack, isPlaying, togglePlay, next, prev } = useAudioPlayer();
  const artUrl = useTrackArt(currentTrack ?? null);
  const defaultCover = '/images/default-cover.png';
  const coverSrc = artUrl || defaultCover;

  const btnBase = clsx(
    'flex items-center justify-center rounded-full border-none cursor-pointer',
    'bg-transparent text-white/70 hover:text-white hover:bg-white/10 active:scale-90',
    'transition-all duration-100 select-none',
  );

  return (
    <div
      className={clsx(
        'flex flex-col rounded-xl overflow-hidden',
        'bg-zinc-950/95 border border-white/8 shadow-2xl',
        'backdrop-blur-2xl',
        compact ? 'w-[192px]' : 'w-[280px]',
      )}
      style={{ WebkitBackdropFilter: 'blur(24px)' }}
    >
      {/* Drag handle + window chrome */}
      <div className="flex items-center justify-end gap-0.5 px-2 pt-1.5 pb-0">
        <button
          onClick={onToggleCompact}
          className={clsx(btnBase, 'w-5 h-5 text-white/30 hover:text-white/70 rounded-md')}
          title={compact ? 'Expand' : 'Compact'}
        >
          {compact
            ? <Maximize2 className="w-2.5 h-2.5" />
            : <Minimize2 className="w-2.5 h-2.5" />}
        </button>
        <button
          onClick={onClose}
          className={clsx(btnBase, 'w-5 h-5 text-white/30 hover:text-white/70 rounded-md')}
          title="Close"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      </div>

      {/* Body */}
      {compact ? (
        /* Compact: just controls */
        <div className="flex items-center justify-center gap-3 px-3 pb-2.5 pt-1">
          <button onClick={prev} className={clsx(btnBase, 'w-8 h-8')}>
            <SkipBack className="w-4 h-4 fill-current" />
          </button>
          <button
            onClick={togglePlay}
            className={clsx(
              btnBase,
              'w-9 h-9 bg-white/12 hover:bg-white/22 text-white rounded-full',
            )}
          >
            {isPlaying
              ? <Pause className="w-4 h-4 fill-current" />
              : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>
          <button onClick={next} className={clsx(btnBase, 'w-8 h-8')}>
            <SkipForward className="w-4 h-4 fill-current" />
          </button>
        </div>
      ) : (
        /* Standard: art + info + controls */
        <div className="flex items-center gap-2.5 px-2.5 pb-2.5 pt-1">
          {/* Album art */}
          <img
            src={coverSrc}
            alt={currentTrack?.title ?? 'Cover'}
            className="w-11 h-11 rounded-md object-cover bg-white/5 shrink-0"
          />

          {/* Info */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <p className="text-[12px] font-semibold text-white/90 truncate leading-snug">
              {currentTrack?.title || 'No track'}
            </p>
            <p className="text-[10px] text-white/45 truncate leading-snug mt-0.5">
              {currentTrack?.artist || '—'}
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={prev} className={clsx(btnBase, 'w-7 h-7')}>
              <SkipBack className="w-3.5 h-3.5 fill-current" />
            </button>
            <button
              onClick={togglePlay}
              className={clsx(
                btnBase,
                'w-8 h-8 bg-white/12 hover:bg-white/22 text-white rounded-full',
              )}
            >
              {isPlaying
                ? <Pause className="w-3.5 h-3.5 fill-current" />
                : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
            </button>
            <button onClick={next} className={clsx(btnBase, 'w-7 h-7')}>
              <SkipForward className="w-3.5 h-3.5 fill-current" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
