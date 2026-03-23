import { useState, useEffect, useCallback } from 'react';

const SESSION_DISMISSED_KEY = 'playd_khurk_dismissed';
const SESSION_APPLIED_KEY   = 'playd_khurk_applied';

export interface KhurkTheme {
  theme: string;
  accent: string;
}

/** Convert a hex colour to the "H S% L%" string CSS HSL expects. */
function hexToHsl(hex: string): string | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  let r = parseInt(m[1], 16) / 255;
  let g = parseInt(m[2], 16) / 255;
  let b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Write accent colour into CSS custom properties on :root. */
export function applyKhurkAccent(accent: string) {
  const hsl = hexToHsl(accent);
  if (!hsl) return;
  const root = document.documentElement;
  root.dataset.khurkTheme = 'active';
  root.style.setProperty('--primary', hsl);
  root.style.setProperty('--accent',  hsl);
  root.style.setProperty('--ring',    hsl);
  // Pick a foreground that contrasts with the accent lightness
  const lPct = parseInt(hsl.match(/(\d+)%\s*$/)?.[1] ?? '40', 10);
  const fg = lPct > 55 ? '0 0% 5%' : '0 0% 100%';
  root.style.setProperty('--primary-foreground', fg);
  root.style.setProperty('--accent-foreground',  fg);
}

export interface KhurkOsState {
  isEmbedded:   boolean;
  pendingTheme: KhurkTheme | null;
  isApplied:    boolean;
  isDismissed:  boolean;
  applyTheme:   () => void;
  dismiss:      () => void;
}

export function useKhurkOs(): KhurkOsState {
  // Detect iframe once — catches cross-origin frames too (try/catch)
  const [isEmbedded] = useState<boolean>(() => {
    try { return window.self !== window.top; } catch { return true; }
  });

  const [pendingTheme, setPendingTheme] = useState<KhurkTheme | null>(null);
  const [isApplied,   setIsApplied]    = useState(() => sessionStorage.getItem(SESSION_APPLIED_KEY) === '1');
  const [isDismissed, setIsDismissed]  = useState(() => sessionStorage.getItem(SESSION_DISMISSED_KEY) === '1');

  // Listen for KHURK_THEME postMessages from the parent OS
  useEffect(() => {
    if (!isEmbedded) return;

    const handler = (event: MessageEvent) => {
      const { origin, data } = event;
      // Accept messages from *.khurk.services or same origin (dev/testing)
      const trusted =
        origin === 'https://khurk.services' ||
        origin.endsWith('.khurk.services')   ||
        origin === window.location.origin;
      if (!trusted) return;
      if (data?.type !== 'KHURK_THEME' || !data.accent) return;

      const theme: KhurkTheme = { theme: data.theme ?? 'dark', accent: data.accent };
      setPendingTheme(theme);

      // If the user already opted in this session, auto-apply on re-load
      if (sessionStorage.getItem(SESSION_APPLIED_KEY) === '1') {
        applyKhurkAccent(theme.accent);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [isEmbedded]);

  const applyTheme = useCallback(() => {
    applyKhurkAccent(pendingTheme?.accent ?? '#5865F2');
    sessionStorage.setItem(SESSION_APPLIED_KEY,   '1');
    sessionStorage.setItem(SESSION_DISMISSED_KEY, '1');
    setIsApplied(true);
    setIsDismissed(true);
  }, [pendingTheme]);

  const dismiss = useCallback(() => {
    sessionStorage.setItem(SESSION_DISMISSED_KEY, '1');
    setIsDismissed(true);
  }, []);

  return { isEmbedded, pendingTheme, isApplied, isDismissed, applyTheme, dismiss };
}
