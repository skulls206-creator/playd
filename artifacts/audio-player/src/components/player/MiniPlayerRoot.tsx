import { createPortal } from 'react-dom';
import { useRef, useState, useCallback, useEffect } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useMiniPlayer, closeMiniPlayer, resizePipWindow } from '@/hooks/use-mini-player';
import { MiniPlayerContent } from './MiniPlayerContent';
import { clsx } from 'clsx';

/**
 * Draggable in-page overlay for browsers without Document PiP support.
 * Starts bottom-right, can be dragged to any corner.
 */
function MiniPlayerOverlay({
  compact,
  onToggleCompact,
}: {
  compact: boolean;
  onToggleCompact: () => void;
}) {
  const [pos, setPos] = useState<{ right: number; bottom: number }>({ right: 24, bottom: 100 });
  const draggingRef = useRef(false);
  const startRef = useRef({ mouseX: 0, mouseY: 0, right: 0, bottom: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    draggingRef.current = true;
    startRef.current = { mouseX: e.clientX, mouseY: e.clientY, right: pos.right, bottom: pos.bottom };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const newRight  = Math.max(8, startRef.current.right  - (e.clientX - startRef.current.mouseX));
    const newBottom = Math.max(8, startRef.current.bottom - (e.clientY - startRef.current.mouseY));
    setPos({ right: newRight, bottom: newBottom });
  }, []);

  const onPointerUp = useCallback(() => { draggingRef.current = false; }, []);

  return (
    <div
      className="fixed z-[500] touch-none cursor-grab active:cursor-grabbing"
      style={{ right: pos.right, bottom: pos.bottom }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <MiniPlayerContent
        compact={compact}
        onToggleCompact={onToggleCompact}
        onClose={closeMiniPlayer}
      />
    </div>
  );
}

/**
 * Top-level mini player renderer. Mount once in MainPlayer.
 * Decides between Document PiP portal and in-page overlay.
 */
export function MiniPlayerRoot() {
  const { isMiniPlayer, isCompactMiniPlayer, toggleCompactMiniPlayer } = useAudioPlayer();
  const { isPip, isOverlay, pipWindow } = useMiniPlayer();

  // Resize PiP window when compact mode changes
  useEffect(() => {
    if (isPip) resizePipWindow(isCompactMiniPlayer);
  }, [isPip, isCompactMiniPlayer]);

  if (!isMiniPlayer) return null;

  if (isPip && pipWindow) {
    return createPortal(
      <MiniPlayerContent
        compact={isCompactMiniPlayer}
        onToggleCompact={toggleCompactMiniPlayer}
        onClose={closeMiniPlayer}
      />,
      pipWindow.document.body,
    );
  }

  if (isOverlay) {
    return (
      <MiniPlayerOverlay
        compact={isCompactMiniPlayer}
        onToggleCompact={toggleCompactMiniPlayer}
      />
    );
  }

  return null;
}
