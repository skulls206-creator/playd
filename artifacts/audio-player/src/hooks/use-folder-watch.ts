/**
 * useFolderWatch — lightweight polling-based folder watch for auto-import.
 *
 * How it works:
 * 1. On each poll interval, enumerates file NAMES from all stored folder handles
 *    (no metadata parsing — this is fast, just iterating directory entries)
 * 2. Compares against known track keys (folderPath/fileName) from the track store
 * 3. If new audio files are found, calls rescanAll() to import them
 * 4. Polling pauses when the tab is hidden (visibility-aware)
 *
 * Settings persisted to localStorage:
 * - Enabled/disabled
 * - Poll interval (10s – 10min, default 60s)
 *
 * Browser support:
 * - Full: Chromium 86+ (File System Access API)
 * - Graceful no-op: other browsers (no stored handles = nothing to watch)
 * - Not using experimental FileSystemObserver — it's Chromium-only and
 *   unreliable for cross-browser PWAs
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { get } from 'idb-keyval';
import { useTrackStore } from '@/lib/track-store';
import { useFileSystem } from './use-file-system';
import { useAudioPlayer } from './use-audio-player';

const WATCH_ENABLED_KEY = 'playd_folder_watch_enabled';
const WATCH_INTERVAL_KEY = 'playd_folder_watch_interval';

const DEFAULT_INTERVAL_MS = 60_000; // 1 minute
const MIN_INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 600_000;

const AUDIO_EXTS = /\.(mp3|flac|m4a|m4p|aac|wav|ogg|opus|webm|wma|aiff|aif|alac|mp4|3gp)$/i;

export function useFolderWatch() {
  const { getStoredHandles, verifyPermission, rescanAll } = useFileSystem();
  const tracks = useTrackStore((s) => s.tracks);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanningRef = useRef(false);

  const [watchEnabled, setWatchEnabled] = useState(() => {
    try { return localStorage.getItem(WATCH_ENABLED_KEY) === 'true'; }
    catch { return false; }
  });
  const [watchInterval, setWatchIntervalState] = useState(() => {
    try {
      const stored = parseInt(localStorage.getItem(WATCH_INTERVAL_KEY) || '', 10);
      return !isNaN(stored) && stored >= MIN_INTERVAL_MS && stored <= MAX_INTERVAL_MS
        ? stored : DEFAULT_INTERVAL_MS;
    } catch { return DEFAULT_INTERVAL_MS; }
  });
  const [lastWatchCheck, setLastWatchCheck] = useState('');
  const [watchStatus, setWatchStatus] = useState('');

  // Build a Set of known local track keys for O(1) lookup
  const knownTrackKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const keys = new Set<string>();
    for (const track of tracks) {
      if (track.source === 'local') {
        keys.add(`${track.folderPath}/${track.fileName}`);
      }
    }
    knownTrackKeysRef.current = keys;
  }, [tracks]);

  const persistEnabled = useCallback((val: boolean) => {
    try { localStorage.setItem(WATCH_ENABLED_KEY, val ? 'true' : 'false'); } catch {}
    setWatchEnabled(val);
  }, []);

  const persistInterval = useCallback((ms: number) => {
    const clamped = Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, ms));
    try { localStorage.setItem(WATCH_INTERVAL_KEY, String(clamped)); } catch {}
    setWatchIntervalState(clamped);
  }, []);

  const doWatchCheck = useCallback(async () => {
    if (scanningRef.current) return;

    try {
      const handles = await getStoredHandles();
      if (handles.length === 0) {
        setWatchStatus('No folders to watch');
        return;
      }

      const knownKeys = knownTrackKeysRef.current;
      let hasNewFiles = false;

      for (const handle of handles) {
        const permOk = await verifyPermission(handle);
        if (!permOk) continue;

        // Lightweight: enumerate only file names — no reading, no parsing
        const walkForNames = async (
          dirHandle: FileSystemDirectoryHandle,
          path: string,
        ): Promise<void> => {
          for await (const entry of (dirHandle as any).values()) {
            if (entry.kind === 'directory') {
              await walkForNames(entry, `${path}/${entry.name}`);
            } else if (entry.kind === 'file' && AUDIO_EXTS.test(entry.name)) {
              const trackKey = `${path}/${entry.name}`;
              if (!knownKeys.has(trackKey)) {
                hasNewFiles = true;
              }
            }
          }
        };

        await walkForNames(handle, handle.name);
        if (hasNewFiles) break; // no need to keep looking
      }

      if (hasNewFiles) {
        scanningRef.current = true;
        setWatchStatus('New files found — importing…');
        await rescanAll();
        scanningRef.current = false;
        setWatchStatus('');
      }

      setLastWatchCheck(new Date().toLocaleTimeString());
      setWatchStatus('');
    } catch (err) {
      console.error('[FolderWatch] check error:', err);
      setWatchStatus('');
    }
  }, [getStoredHandles, verifyPermission, rescanAll]);

  // Start/stop the polling timer
  useEffect(() => {
    if (!watchEnabled) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Run once immediately when enabled
    doWatchCheck();

    timerRef.current = setInterval(() => {
      // Only poll when the tab is visible (conserves battery/CPU)
      if (document.visibilityState === 'visible') {
        doWatchCheck();
      }
    }, watchInterval);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [watchEnabled, watchInterval, doWatchCheck]);

  return {
    watchEnabled,
    setWatchEnabled: persistEnabled,
    watchInterval,
    setWatchInterval: persistInterval,
    lastWatchCheck,
    watchStatus,
    /** Trigger an immediate check */
    checkNow: doWatchCheck,
    intervalLabel: watchInterval >= 60000
      ? `${Math.round(watchInterval / 60000)} min`
      : `${Math.round(watchInterval / 1000)} sec`,
  };
}
