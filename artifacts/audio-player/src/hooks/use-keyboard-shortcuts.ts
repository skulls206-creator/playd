import { useEffect } from 'react';
import { useAudioPlayer } from './use-audio-player';

const IGNORED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isEditable(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (IGNORED_TAGS.has(t.tagName)) return true;
  if (t.isContentEditable) return true;
  return false;
}

export interface ShortcutMap {
  playPause: string;
  next: string;
  prev: string;
  mute: string;
  volUp: string;
  volDown: string;
  shuffle: string;
  repeat: string;
  search: string;
  queue: string;
  eq: string;
  prefs: string;
  lyrics: string;
}

const DEFAULT_SHORTCUTS: ShortcutMap = {
  playPause: 'Space',
  next: 'Ctrl+ArrowRight',
  prev: 'Ctrl+ArrowLeft',
  mute: 'm',
  volUp: '+',
  volDown: '-',
  shuffle: 's',
  repeat: 'r',
  search: 'Ctrl+f',
  queue: 'q',
  eq: 'e',
  prefs: 'p',
  lyrics: 'l',
};

function loadShortcuts(): ShortcutMap {
  try {
    const stored = localStorage.getItem('playd_shortcuts');
    return stored ? { ...DEFAULT_SHORTCUTS, ...JSON.parse(stored) } : DEFAULT_SHORTCUTS;
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

export function saveShortcuts(shortcuts: ShortcutMap) {
  try { localStorage.setItem('playd_shortcuts', JSON.stringify(shortcuts)); } catch {}
}

export function resetShortcuts() {
  try { localStorage.removeItem('playd_shortcuts'); } catch {}
}

export { DEFAULT_SHORTCUTS };

function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+');
  let key = parts.pop()!;
  const needsCtrl = parts.includes('Ctrl');
  const needsShift = parts.includes('Shift');
  const needsAlt = parts.includes('Alt');
  if (needsCtrl !== (e.ctrlKey || e.metaKey)) return false;
  if (needsShift !== e.shiftKey) return false;
  if (needsAlt !== e.altKey) return false;
  const pressedKey = e.key === ' ' ? 'Space' : e.key;
  return pressedKey.toLowerCase() === key.toLowerCase();
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditable(e)) return;

      const {
        togglePlay, next, prev, setVolume, toggleMute, volume,
        toggleShuffle, setRepeatMode, repeatMode,
        setSearchQuery, toggleQueue, toggleEq, togglePrefs, toggleLyrics,
        searchQuery,
      } = useAudioPlayer.getState();

      const shortcuts = loadShortcuts();

      if (matchesShortcut(e, shortcuts.playPause)) {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (matchesShortcut(e, shortcuts.next)) {
        e.preventDefault();
        next();
        return;
      }
      if (matchesShortcut(e, shortcuts.prev)) {
        e.preventDefault();
        prev();
        return;
      }
      if (matchesShortcut(e, shortcuts.mute)) {
        e.preventDefault();
        toggleMute();
        return;
      }
      if (matchesShortcut(e, shortcuts.volUp)) {
        e.preventDefault();
        setVolume(Math.min(1, volume + 0.05));
        return;
      }
      if (matchesShortcut(e, shortcuts.volDown)) {
        e.preventDefault();
        setVolume(Math.max(0, volume - 0.05));
        return;
      }
      if (matchesShortcut(e, shortcuts.shuffle)) {
        e.preventDefault();
        toggleShuffle();
        return;
      }
      if (matchesShortcut(e, shortcuts.repeat)) {
        e.preventDefault();
        setRepeatMode(repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off');
        return;
      }
      if (matchesShortcut(e, shortcuts.search)) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('[data-search-input]');
        if (searchInput) { searchInput.focus(); searchInput.select(); }
        return;
      }
      if (matchesShortcut(e, shortcuts.queue)) {
        e.preventDefault();
        toggleQueue();
        return;
      }
      if (matchesShortcut(e, shortcuts.eq)) {
        e.preventDefault();
        toggleEq();
        return;
      }
      if (matchesShortcut(e, shortcuts.prefs)) {
        e.preventDefault();
        togglePrefs();
        return;
      }
      if (matchesShortcut(e, shortcuts.lyrics)) {
        e.preventDefault();
        toggleLyrics();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
