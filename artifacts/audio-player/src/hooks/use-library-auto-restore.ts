/**
 * useLibraryAutoRestore
 *
 * On mount, checks every saved folder handle (stored in IndexedDB by
 * use-file-system.ts) and calls queryPermission() on each.
 *
 *  - 'granted'  → rescans silently (permission still active, no user gesture needed)
 *  - 'prompt'   → sets needsRestore = true so the caller can show a banner;
 *                 the user click on the banner IS the required user gesture for
 *                 requestPermission() inside rescanAll().
 *  - 'denied'   → silently skipped
 *
 * Dismissing the banner stores a sessionStorage flag so it won't reappear for
 * the rest of the browser session.
 */

import { useEffect, useState, useRef } from 'react';
import { get } from 'idb-keyval';

// ─── File System Access API permission augmentation ───────────────────────────
// queryPermission / requestPermission are in the spec but not yet in every
// version of lib.dom.d.ts — declare them here to keep the code type-safe.
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}
declare global {
  interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }
}

const SESSION_KEY = 'playd_restore_dismissed';
const FOLDER_STORE_KEY = 'music-folders';

export function useLibraryAutoRestore(rescanAll: () => Promise<{ total: number; folders: number }>) {
  const [needsRestore, setNeedsRestore] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (sessionStorage.getItem(SESSION_KEY)) return;

    (async () => {
      try {
        const handles: FileSystemDirectoryHandle[] =
          (await get<FileSystemDirectoryHandle[]>(FOLDER_STORE_KEY)) ?? [];
        if (handles.length === 0) return;

        let anyGranted = false;
        let anyPrompt = false;

        for (const handle of handles) {
          const perm = await handle.queryPermission({ mode: 'read' });
          if (perm === 'granted') anyGranted = true;
          else if (perm === 'prompt') anyPrompt = true;
        }

        if (anyPrompt) {
          // One or more handles need a user gesture — show the banner.
          // Do NOT call rescanAll() here because it internally calls
          // requestPermission(), which fails without a user gesture.
          setNeedsRestore(true);
        } else if (anyGranted) {
          // All handles are already granted — safe to rescan silently.
          await rescanAll();
        }
      } catch {
        // File System Access API not available or handles corrupted — ignore
      }
    })();
  }, []);

  const restore = async () => {
    setNeedsRestore(false);
    await rescanAll();
  };

  const dismiss = () => {
    sessionStorage.setItem(SESSION_KEY, '1');
    setNeedsRestore(false);
  };

  return { needsRestore, restore, dismiss };
}
