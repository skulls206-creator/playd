import { useRef, useState, useCallback } from 'react';
import { useLock } from '@/hooks/use-lock';
import { Lock } from 'lucide-react';

const UNLOCK_RADIUS = 80; // px — drag this far in any direction to unlock

export function LockOverlay() {
  const { isLocked, unlock } = useLock();
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const iconRef = useRef<HTMLDivElement>(null);
  const origin = useRef({ x: 0, y: 0 });

  const reset = useCallback(() => {
    setDragging(false);
    setOffset({ x: 0, y: 0 });
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    iconRef.current?.setPointerCapture(e.pointerId);
    origin.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    e.preventDefault();

    const dx = e.clientX - origin.current.x;
    const dy = e.clientY - origin.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Clamp visual offset so the icon doesn't fly off screen
    const clampDist = Math.min(dist, UNLOCK_RADIUS * 1.15);
    const angle = Math.atan2(dy, dx);
    setOffset({
      x: Math.cos(angle) * clampDist,
      y: Math.sin(angle) * clampDist,
    });

    if (dist >= UNLOCK_RADIUS) {
      reset();
      unlock();
    }
  }, [dragging, unlock, reset]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    reset();
  }, [reset]);

  const onPointerCancel = useCallback(() => {
    reset();
  }, [reset]);

  if (!isLocked) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm touch-none select-none">
      {/* Dragable lock icon — center of screen, acts like a joystick */}
      <div
        ref={iconRef}
        className="relative w-24 h-24 rounded-full bg-white/10 flex items-center justify-center cursor-grab active:cursor-grabbing transition-shadow duration-150"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          boxShadow: dragging
            ? '0 0 40px rgba(255,255,255,0.15), 0 0 80px rgba(255,255,255,0.05)'
            : 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {/* Glow ring */}
        {dragging && (
          <div className="absolute inset-0 rounded-full border-2 border-white/20 animate-pulse" />
        )}
        <Lock className="w-10 h-10 text-white/80" />
      </div>

      {/* Hint text shown faintly when idle */}
      {!dragging && (
        <p className="absolute bottom-24 left-1/2 -translate-x-1/2 text-white/30 text-xs font-medium tracking-widest uppercase">
          Drag to unlock
        </p>
      )}
    </div>
  );
}
