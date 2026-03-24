import { useState, useEffect, useCallback } from 'react';
import { THEMES, THEME_KEYS, type ThemeKey } from '@/lib/themes';

const STORAGE_KEY       = 'playd_theme';
const DISCORD_DISMISSED = 'playd_discord_theme_dismissed';

const THEME_VAR_KEYS = Object.keys(THEMES.default.vars);

/** Write all CSS custom properties for the given theme onto :root. */
export function applyThemeToDom(key: ThemeKey) {
  const theme = THEMES[key];
  if (!theme) return;
  const root = document.documentElement;
  // Clear any vars not in this theme (e.g. from KHURK OS override)
  for (const k of THEME_VAR_KEYS) root.style.removeProperty(k);
  for (const [prop, val] of Object.entries(theme.vars)) {
    root.style.setProperty(prop, val);
  }
  root.dataset.theme = key;
}

/** Detect whether the page is embedded inside Discord. */
function detectDiscord(): boolean {
  try {
    if (window.self === window.top) return false;
    if (window.location.ancestorOrigins?.length > 0) {
      return Array.from(window.location.ancestorOrigins).some(o =>
        o.includes('discord.com') || o.includes('discordapp.com'),
      );
    }
    // Fallback for browsers without ancestorOrigins
    if (document.referrer.includes('discord.com') || document.referrer.includes('discordapp.com')) return true;
  } catch { /* cross-origin access denied → assume embedded */ }
  return false;
}

// Apply saved theme immediately (prevents flash before React mounts)
applyThemeToDom(readStored());

// Module-level event name so multiple hook instances stay in sync
const CHANGE_EVENT = 'playd-theme-change';

function broadcastChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function readStored(): ThemeKey {
  const s = localStorage.getItem(STORAGE_KEY) as ThemeKey | null;
  return s && THEME_KEYS.includes(s) ? s : 'default';
}

export interface UseThemeReturn {
  theme:                   ThemeKey;
  setTheme:                (key: ThemeKey) => void;
  isInDiscord:             boolean;
  showDiscordSuggestion:   boolean;
  dismissDiscordSuggestion: () => void;
}

export function useTheme(): UseThemeReturn {
  const [theme, setThemeState] = useState<ThemeKey>(readStored);

  const [isInDiscord] = useState<boolean>(() => detectDiscord());

  const [showDiscordSuggestion, setShowDiscordSuggestion] = useState<boolean>(() => {
    if (!detectDiscord()) return false;
    if (sessionStorage.getItem(DISCORD_DISMISSED) === '1') return false;
    const stored = localStorage.getItem(STORAGE_KEY);
    // Only suggest if user hasn't already picked a theme
    return !stored || stored === 'default';
  });

  // Apply on first render
  useEffect(() => {
    applyThemeToDom(theme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep in sync if another component calls setTheme
  useEffect(() => {
    const handler = () => {
      const next = readStored();
      setThemeState(next);
      applyThemeToDom(next);
    };
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);

  const setTheme = useCallback((key: ThemeKey) => {
    localStorage.setItem(STORAGE_KEY, key);
    applyThemeToDom(key);
    setThemeState(key);
    setShowDiscordSuggestion(false);
    broadcastChange();
  }, []);

  const dismissDiscordSuggestion = useCallback(() => {
    sessionStorage.setItem(DISCORD_DISMISSED, '1');
    setShowDiscordSuggestion(false);
  }, []);

  return { theme, setTheme, isInDiscord, showDiscordSuggestion, dismissDiscordSuggestion };
}
