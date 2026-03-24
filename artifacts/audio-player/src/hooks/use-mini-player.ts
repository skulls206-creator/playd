import { useState, useEffect, useRef, useCallback } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';

/** All CSS custom-property names the app uses (from themes.ts). */
const CSS_VAR_NAMES = [
  '--background', '--foreground',
  '--card', '--card-foreground',
  '--popover', '--popover-foreground',
  '--primary', '--primary-foreground',
  '--secondary', '--secondary-foreground',
  '--muted', '--muted-foreground',
  '--accent', '--accent-foreground',
  '--border', '--input', '--ring',
  '--radius',
];

function injectStylesIntoPip(pipWin: Window) {
  // 1. Copy <link rel="stylesheet"> tags (production CSS bundle)
  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach(link => {
    const clone = pipWin.document.createElement('link');
    clone.rel = 'stylesheet';
    clone.href = link.href; // absolute URL — works cross-document
    pipWin.document.head.appendChild(clone);
  });

  // 2. Copy <style> tags (Vite dev injects styles this way)
  document.querySelectorAll<HTMLStyleElement>('style').forEach(style => {
    const clone = pipWin.document.createElement('style');
    clone.textContent = style.textContent;
    pipWin.document.head.appendChild(clone);
  });

  // 3. Copy CSS custom properties from :root to PiP window :root
  const cs = getComputedStyle(document.documentElement);
  const vars = CSS_VAR_NAMES
    .map(v => `${v}: ${cs.getPropertyValue(v)};`)
    .join('\n');
  const varStyle = pipWin.document.createElement('style');
  varStyle.textContent = `:root { ${vars} }`;
  pipWin.document.head.appendChild(varStyle);

  // 4. Reset body
  const bodyStyle = pipWin.document.createElement('style');
  bodyStyle.textContent = 'body { margin:0; padding:0; background:transparent; overflow:hidden; }';
  pipWin.document.head.appendChild(bodyStyle);
}

/**
 * Manages the Document Picture-in-Picture window lifecycle.
 *
 * Watches `isMiniPlayer` from the Zustand store:
 * - When true:  tries to open a Document PiP window; falls back to in-page overlay on failure.
 * - When false: closes the PiP window if one is open.
 *
 * Returns:
 * - `isPip`       — true when a Document PiP window is open
 * - `isOverlay`   — true when mini player is active but using the in-page overlay
 * - `pipWindow`   — the PiP Window object (or null)
 */
export function useMiniPlayer() {
  const { isMiniPlayer, toggleMiniPlayer } = useAudioPlayer();
  const [isPip, setIsPip] = useState(false);
  const pipWindowRef = useRef<Window | null>(null);

  // Keep a stable ref so the pagehide handler can read the latest value
  const isMiniPlayerRef = useRef(isMiniPlayer);
  isMiniPlayerRef.current = isMiniPlayer;

  const closePip = useCallback(() => {
    if (pipWindowRef.current) {
      try { pipWindowRef.current.close(); } catch {}
      pipWindowRef.current = null;
    }
    setIsPip(false);
  }, []);

  const openPip = useCallback(async (compact: boolean): Promise<boolean> => {
    const dpp = (window as any).documentPictureInPicture;
    if (!dpp) return false;

    try {
      const pipWin: Window = await dpp.requestWindow({
        width:  compact ? 210 : 296,
        height: compact ?  60 :  92,
      });
      pipWindowRef.current = pipWin;
      injectStylesIntoPip(pipWin);
      setIsPip(true);

      // Sync back if user closes the PiP window via the OS chrome
      pipWin.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
        setIsPip(false);
        if (isMiniPlayerRef.current) toggleMiniPlayer();
      });

      return true;
    } catch (e) {
      console.warn('Document PiP unavailable:', e);
      return false;
    }
  }, [toggleMiniPlayer]);

  useEffect(() => {
    if (isMiniPlayer) {
      if (!pipWindowRef.current) {
        const compact = useAudioPlayer.getState().isCompactMiniPlayer;
        openPip(compact); // fallback to overlay if this returns false
      }
    } else {
      closePip();
    }
  }, [isMiniPlayer, openPip, closePip]);

  return {
    isPip,
    isOverlay: isMiniPlayer && !isPip,
    pipWindow: pipWindowRef.current,
  };
}

/**
 * Resize the Document PiP window when compact mode changes.
 * Must be called from a component that has both the pip window and compact state.
 */
export function resizePipWindow(pipWin: Window, compact: boolean) {
  try {
    pipWin.resizeTo(compact ? 210 : 296, compact ? 60 : 92);
  } catch {}
}
