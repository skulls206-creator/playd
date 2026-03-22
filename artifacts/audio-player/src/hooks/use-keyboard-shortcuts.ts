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

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditable(e)) return;

      const { togglePlay, next, prev, setVolume, toggleMute, volume } =
        useAudioPlayer.getState();

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;

        case 'ArrowRight':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); next(); }
          break;

        case 'ArrowLeft':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); prev(); }
          break;

        case 'm':
        case 'M':
          if (!e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            toggleMute();
          }
          break;

        case '+':
        case '=':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setVolume(Math.min(1, volume + 0.05));
          }
          break;

        case '-':
        case '_':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setVolume(Math.max(0, volume - 0.05));
          }
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
