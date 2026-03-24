/**
 * Mini Player — Document Picture-in-Picture integration
 *
 * Architecture:
 *  - Module-level singleton stores the PiP window ref & state.
 *  - `openMiniPlayer()` / `closeMiniPlayer()` are plain functions, importable
 *    anywhere, safe to call directly from click handlers (preserves user activation).
 *  - `useMiniPlayer()` is a React hook for components that need to render
 *    conditional UI based on whether PiP is active.
 */

import { useState, useEffect } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';

// ─── Module-level singleton ───────────────────────────────────────────────────

let _pipWindow: Window | null = null;
let _isPip = false;
const _listeners = new Set<(isPip: boolean) => void>();

function _setIsPip(v: boolean) {
  _isPip = v;
  _listeners.forEach(fn => fn(v));
}

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

function _injectStyles(pipWin: Window) {
  // 1. Copy <link rel="stylesheet"> tags (production CSS bundle — absolute URL)
  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach(link => {
    const clone = pipWin.document.createElement('link');
    clone.rel = 'stylesheet';
    clone.href = link.href;
    pipWin.document.head.appendChild(clone);
  });

  // 2. Copy <style> tags (Vite dev mode injects CSS this way)
  document.querySelectorAll<HTMLStyleElement>('style').forEach(style => {
    const clone = pipWin.document.createElement('style');
    clone.textContent = style.textContent;
    pipWin.document.head.appendChild(clone);
  });

  // 3. Copy CSS custom properties from :root so themed colors work
  const cs = getComputedStyle(document.documentElement);
  const vars = CSS_VAR_NAMES.map(v => `${v}: ${cs.getPropertyValue(v)};`).join('\n');
  const varStyle = pipWin.document.createElement('style');
  varStyle.textContent = `:root { ${vars} }`;
  pipWin.document.head.appendChild(varStyle);

  // 4. Reset body so Tailwind's base styles don't add unwanted background/padding
  const bodyStyle = pipWin.document.createElement('style');
  bodyStyle.textContent = 'body { margin:0; padding:0; background:transparent; overflow:hidden; }';
  pipWin.document.head.appendChild(bodyStyle);
}

// ─── Public API (plain functions — safe to call from click handlers) ──────────

/**
 * Open the mini player.
 *
 * MUST be called directly from a user gesture (click handler) to satisfy the
 * Document PiP user-activation requirement.
 *
 * Behaviour:
 *  - If `documentPictureInPicture` is supported: opens a real PiP window.
 *  - Otherwise (or if requestWindow rejects): activates in-page overlay mode.
 */
export async function openMiniPlayer(): Promise<void> {
  const store = useAudioPlayer.getState();

  // Ensure store knows the mini player is open
  if (!store.isMiniPlayer) store.toggleMiniPlayer();

  // Already have a PiP window open — nothing more to do
  if (_pipWindow) return;

  const dpp = (window as any).documentPictureInPicture;
  if (!dpp) return; // overlay mode — store toggle above is enough

  const compact = store.isCompactMiniPlayer;
  try {
    const pipWin: Window = await dpp.requestWindow({
      width:  compact ? 210 : 296,
      height: compact ?  60 :  92,
    });
    _pipWindow = pipWin;
    _injectStyles(pipWin);
    _setIsPip(true);

    // When user closes the OS PiP chrome, sync state back
    pipWin.addEventListener('pagehide', () => {
      _pipWindow = null;
      _setIsPip(false);
      const s = useAudioPlayer.getState();
      if (s.isMiniPlayer) s.toggleMiniPlayer();
    });
  } catch (e) {
    console.warn('Document PiP unavailable:', e);
    // Store is already toggled → overlay mode will render automatically
  }
}

/**
 * Close the mini player (PiP window or overlay).
 * Safe to call from anywhere, including close buttons inside the mini player.
 */
export function closeMiniPlayer(): void {
  if (_pipWindow) {
    try { _pipWindow.close(); } catch {}
    _pipWindow = null;
  }
  _setIsPip(false);

  const store = useAudioPlayer.getState();
  if (store.isMiniPlayer) store.toggleMiniPlayer();
}

/**
 * Resize the Document PiP window to match the current compact mode.
 * No-op if no PiP window is open.
 */
export function resizePipWindow(compact: boolean): void {
  if (!_pipWindow) return;
  try { _pipWindow.resizeTo(compact ? 210 : 296, compact ? 60 : 92); } catch {}
}

// ─── React hook (for components that render conditional UI) ───────────────────

/**
 * Hook for components that need to react to PiP state changes.
 * e.g. MiniPlayerRoot uses this to decide whether to render a portal or overlay.
 */
export function useMiniPlayer() {
  const [isPip, setIsPip] = useState(_isPip);
  const isMiniPlayer = useAudioPlayer(s => s.isMiniPlayer);

  useEffect(() => {
    const listener = (v: boolean) => setIsPip(v);
    _listeners.add(listener);
    // Sync initial state in case it changed before this effect ran
    setIsPip(_isPip);
    return () => { _listeners.delete(listener); };
  }, []);

  return {
    isPip,
    isOverlay: isMiniPlayer && !isPip,
    pipWindow: isPip ? _pipWindow : null,
  };
}
