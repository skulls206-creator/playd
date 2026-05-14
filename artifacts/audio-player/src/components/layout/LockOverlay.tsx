import { useRef, useState, useCallback } from 'react';
import { useLock } from '@/hooks/use-lock';
import { Lock, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';

const UNLOCK_THRESHOLD = 0.92;

export function LockOverlay() {
  const { isLocked, unlock } = useLock();
  const [dragPct, setDragPct] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [released, setReleased] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);

  const reset = useCallback(() => {
    setDragging(false);
    setReleased(true);
    setDragPct(0);
    setTimeout(() => setReleased(false), 300);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    setDragging(true);
    setReleased(false);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    e.preventDefault();
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, dx / rect.width));
    setDragPct(pct);

    if (pct >= UNLOCK_THRESHOLD) {
      setDragging(false);
      setDragPct(0);
      unlock();
    }
  }, [dragging, unlock]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (dragPct < UNLOCK_THRESHOLD) {
      reset();
    }
  }, [dragPct, reset]);

  const onPointerCancel = useCallback(() => {
    reset();
  }, [reset]);

  if (!isLocked) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm touch-none select-none">
      {/* Lock icon */}
      <div className="mb-8">
        <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center">
          <Lock className="w-10 h-10 text-white/90" />
        </div>
      </div>

      <p className="text-white/60 text-sm font-medium tracking-widest uppercase mb-8">
        Swipe to unlock
      </p>

      {/* Slide to unlock track */}
      <div
        ref={trackRef}
        className="relative w-64 h-12 rounded-full bg-white/10 overflow-hidden cursor-pointer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{ touchAction: 'none' }}
      >
        {/* Fill gradient */}
        <div
          className={clsx(
            'absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary/60 to-primary transition-[width] duration-75',
            released && !dragging ? 'transition-all duration-300' : '',
          )}
          style={{ width: `${dragPct * 100}%` }}
        />

        {/* Text label */}
        <span
          className={clsx(
            'absolute inset-0 flex items-center justify-center text-sm font-medium tracking-wider transition-colors',
            dragPct > 0.3 ? 'text-background' : 'text-white/50',
          )}
        >
          {dragPct > 0.3 ? 'Release to unlock' : 'Slide to unlock'}
        </span>

        {/* Drag thumb */}
        <div
          className={clsx(
            'absolute top-1 left-1 w-10 h-10 rounded-full bg-white/90 shadow-lg flex items-center justify-center transition-[left] duration-75',
            released && !dragging ? 'transition-all duration-300' : '',
          )}
          style={{ left: `calc(${Math.max(dragPct * 256, 0)}px + 4px)` }}
        >
          <ChevronRight className="w-5 h-5 text-foreground" />
        </div>
      </div>
    </div>
  );
}
