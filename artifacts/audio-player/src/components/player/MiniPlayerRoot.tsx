import { createPortal } from 'react-dom';
import { useRef, useState, useCallback, useEffect } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useMiniPlayer, resizePipWindow } from '@/hooks/use-mini-player';
import { MiniPlayerContent } from './MiniPlayerContent';
import { clsx } from 'clsx';

/**
 * Draggable in-page overlay that wraps the mini player content.
 * Starts in the bottom-right corner and can be dragged anywhere.
 */
function MiniPlayerOverlay({
  compact,
  onToggleCompact,
  onClose,
}: {
  compact: boolean;
  onToggleCompact: () => void;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ right: number; bottom: number }>({ right: 24, bottom: 100 });
  const draggingRef = useRef(false);
  const startRef = useRef({ mouseX: 0, mouseY: 0, right: 0, bottom: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Don't initiate drag on button clicks
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    draggingRef.current = true;
    startRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      right: pos.right,
      bottom: pos.bottom,
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - startRef.current.mouseX;
    const dy = e.clientY - startRef.current.mouseY;
    const newRight  = Math.max(8, startRef.current.right  - dx);
    const newBottom = Math.max(8, startRef.current.bottom - dy);
    setPos({ right: newRight, bottom: newBottom });
  }, []);

  const onPointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  return (
    <div
      ref={overlayRef}
      className={clsx(
        'fixed z-[500] touch-none',
        !draggingRef.current && 'transition-[bottom,right] duration-100',
      )}
      style={{ right: pos.right, bottom: pos.bottom }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Drag-hint cursor on non-button areas */}
      <div className="cursor-grab active:cursor-grabbing">
        <MiniPlayerContent
          compact={compact}
          onToggleCompact={onToggleCompact}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

/**
 * Top-level component that decides whether to render the mini player
 * as a Document PiP portal or a draggable in-page overlay.
 * Mount once inside MainPlayer.
 */
export function MiniPlayerRoot() {
  const { isMiniPlayer, isCompactMiniPlayer, toggleMiniPlayer, toggleCompactMiniPlayer } = useAudioPlayer();
  const { isPip, isOverlay, pipWindow } = useMiniPlayer();

  // Resize PiP window whenever compact mode changes
  useEffect(() => {
    if (isPip && pipWindow) resizePipWindow(pipWindow, isCompactMiniPlayer);
  }, [isPip, pipWindow, isCompactMiniPlayer]);

  if (!isMiniPlayer) return null;

  const content = (
    <MiniPlayerContent
      compact={isCompactMiniPlayer}
      onToggleCompact={toggleCompactMiniPlayer}
      onClose={toggleMiniPlayer}
    />
  );

  if (isPip && pipWindow) {
    return createPortal(content, pipWindow.document.body);
  }

  if (isOverlay) {
    return (
      <MiniPlayerOverlay
        compact={isCompactMiniPlayer}
        onToggleCompact={toggleCompactMiniPlayer}
        onClose={toggleMiniPlayer}
      />
    );
  }

  return null;
}
