import { useState } from 'react';
import { get, set } from 'idb-keyval';
import * as mm from 'music-metadata-browser';
import { useBulkUpsertTracks, getListTracksQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

const ART_STORE_KEY = 'track-art';
const AUDIO_EXTS = /\.(mp3|flac|m4a|aac|wav|ogg|opus)$/i;

/**
 * In-memory store for File objects loaded via the webkitdirectory fallback.
 * Keys: `${folderPath}/${fileName}` (same convention as DB folderPath + fileName).
 * Lives for the browser session only — no persistence across reloads.
 */
const inMemoryFiles = new Map<string, File>();

/** Open a webkitdirectory file-picker as a fallback when showDirectoryPicker is blocked. */
function pickFilesViaInput(): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    (input as any).webkitdirectory = true;
    // NOTE: Do NOT set `accept` with webkitdirectory — it conflicts in Chrome/Edge
    // and causes 0 files to be returned. We filter by extension in code instead.

    let settled = false;
    const settle = (value: FileList | null) => {
      if (!settled) { settled = true; resolve(value); }
    };

    input.addEventListener('change', () => settle(input.files));
    // Cancel detection: browser refocuses the window after the dialog closes
    const onFocus = () => setTimeout(() => settle(null), 500);
    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}

export function useFileSystem() {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('');
  const bulkUpsert = useBulkUpsertTracks();
  const queryClient = useQueryClient();

  const verifyPermission = async (fileHandle: FileSystemHandle, readWrite = false) => {
    const options = { mode: readWrite ? 'readwrite' : 'read' } as any;
    if ((await fileHandle.queryPermission(options)) === 'granted') return true;
    if ((await fileHandle.requestPermission(options)) === 'granted') return true;
    return false;
  };

  const getStoredHandles = async (): Promise<FileSystemDirectoryHandle[]> => {
    return (await get('music-folders')) || [];
  };

  const getArtForTrack = async (fileName: string, folderPath: string): Promise<string | null> => {
    const artStore: Record<string, string> = (await get(ART_STORE_KEY)) || {};
    return artStore[`${folderPath}/${fileName}`] || null;
  };

  // ── Core scan logic that works on any iterable of {file, relativePath} ──
  const processTracks = async (
    entries: Array<{ file: File; relativePath: string }>,
    rootName: string,
  ) => {
    setIsScanning(true);
    setScanProgress(0);
    setScanStatus(`Scanning ${rootName}…`);

    try {
      const tracks: any[] = [];
      const artStore: Record<string, string> = (await get(ART_STORE_KEY)) || {};
      let count = 0;

      for (const { file, relativePath } of entries) {
        if (!AUDIO_EXTS.test(file.name)) continue;
        try {
          const metadata = await mm.parseBlob(file, { duration: true, skipCovers: false });

          // Album art → IndexedDB only (not sent to server)
          if (metadata.common.picture?.length) {
            const pic = metadata.common.picture[0];
            const blob = new Blob([pic.data], { type: pic.format });
            const dataUrl: string = await new Promise(resolve => {
              const reader = new FileReader();
              reader.onload = e => resolve(e.target?.result as string);
              reader.readAsDataURL(blob);
            });
            artStore[relativePath] = dataUrl;
          }

          // Parse folderPath from relativePath
          const parts = relativePath.split('/');
          const fileName = parts[parts.length - 1];
          const folderPath = parts.slice(0, -1).join('/') || rootName;

          // Store file in memory for session playback — keyed by the same
          // pattern that getFileFromPath uses: "folderPath/fileName"
          inMemoryFiles.set(`${folderPath}/${fileName}`, file);

          tracks.push({
            title: metadata.common.title || file.name.replace(/\.[^/.]+$/, ''),
            artist: metadata.common.artist || 'Unknown Artist',
            album: metadata.common.album || 'Unknown Album',
            year: metadata.common.year || null,
            genre: metadata.common.genre?.[0] || null,
            duration: Math.round(metadata.format.duration || 0),
            trackNumber: metadata.common.track?.no || null,
            fileName,
            folderPath,
            albumArtDataUrl: null,
            source: 'local',
          });

          count++;
          setScanProgress(count);
          setScanStatus(`Scanning ${rootName}… (${count} tracks found)`);
        } catch (e) {
          console.warn('Failed to parse', file.name, e);
        }
      }

      await set(ART_STORE_KEY, artStore);

      if (tracks.length === 0) {
        setScanStatus('No audio files found. Supported: MP3, FLAC, M4A, AAC, WAV, OGG, OPUS');
        setTimeout(() => setScanStatus(''), 5000);
        return;
      }

      setScanStatus(`Saving ${tracks.length} tracks to library…`);
      await bulkUpsert.mutateAsync({ data: { tracks } });

      await queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });
      setScanStatus(`Done — ${tracks.length} tracks added`);
      setTimeout(() => setScanStatus(''), 3000);
    } catch (error) {
      console.error('Scan failed', error);
      setScanStatus('Scan failed — see console for details');
      setTimeout(() => setScanStatus(''), 5000);
    } finally {
      setIsScanning(false);
    }
  };

  // ── Scan via FileSystemDirectoryHandle (File System Access API) ──
  const scanFolder = async (dirHandle: FileSystemDirectoryHandle) => {
    const entries: Array<{ file: File; relativePath: string }> = [];

    const hasPermission = await verifyPermission(dirHandle);
    if (!hasPermission) {
      setScanStatus('Permission denied');
      return;
    }

    async function walk(handle: FileSystemDirectoryHandle, path: string) {
      for await (const entry of (handle as any).values()) {
        if (entry.kind === 'directory') {
          await walk(entry, `${path}/${entry.name}`);
        } else if (entry.kind === 'file' && AUDIO_EXTS.test(entry.name)) {
          const file = await entry.getFile();
          entries.push({ file, relativePath: `${path}/${entry.name}` });
        }
      }
    }

    await walk(dirHandle, dirHandle.name);
    await processTracks(entries, dirHandle.name);
  };

  // ── Scan via FileList (webkitdirectory fallback) ──
  const scanFileList = async (files: FileList) => {
    if (!files.length) return;
    const entries: Array<{ file: File; relativePath: string }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (AUDIO_EXTS.test(file.name)) {
        // webkitRelativePath: "FolderName/sub/file.mp3"
        entries.push({ file, relativePath: file.webkitRelativePath || file.name });
      }
    }
    const rootName = entries[0]?.relativePath.split('/')[0] || 'Imported';
    await processTracks(entries, rootName);
  };

  // ── Load the bundled sample track from public/ (always available, no picker needed) ──
  const loadSampleTrack = async (): Promise<boolean> => {
    try {
      // import.meta.env.BASE_URL respects the Vite base path (e.g. /audio-player/)
      const resp = await fetch(`${import.meta.env.BASE_URL}GRAHAM_-_Enough_For_Me.mp3`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const fileName = 'GRAHAM_-_Enough_For_Me.mp3';
      const file = new File([blob], fileName, { type: 'audio/mpeg' });
      const relativePath = `Samples/${fileName}`;
      inMemoryFiles.set(relativePath, file);
      await processTracks([{ file, relativePath }], 'Samples');
      return true;
    } catch (e) {
      console.error('Failed to load sample track', e);
      return false;
    }
  };

  // ── Import individual audio files (works in all iframe/sandbox contexts) ──
  const addFiles = async (): Promise<boolean> => {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.mp3,.flac,.m4a,.aac,.wav,.ogg,.opus';

      let settled = false;
      const finish = (result: boolean) => {
        if (!settled) { settled = true; resolve(result); }
      };

      input.addEventListener('change', async () => {
        if (input.files && input.files.length > 0) {
          await scanFileList(input.files);
          finish(true);
        } else {
          finish(false);
        }
      });

      const onFocus = () => setTimeout(() => finish(false), 500);
      window.addEventListener('focus', onFocus, { once: true });
      input.click();
    });
  };

  // ── Main entry: try File System Access API, fall back to file input ──
  const addFolder = async (): Promise<boolean> => {
    // Try modern File System Access API first
    if (typeof (window as any).showDirectoryPicker === 'function') {
      try {
        const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
        const existing = await getStoredHandles();
        if (!existing.some(h => h.name === handle.name)) {
          await set('music-folders', [...existing, handle]);
        }
        await scanFolder(handle);
        return true;
      } catch (e: any) {
        if (e?.name === 'AbortError') return false; // User cancelled — silent
        // SecurityError, NotAllowedError, etc. — fall through to file input
        console.info('showDirectoryPicker unavailable, using file input fallback:', e?.name);
      }
    }

    // Fallback: <input webkitdirectory> — works in all contexts including iframes
    const files = await pickFilesViaInput();
    if (!files || files.length === 0) return false;
    await scanFileList(files);
    return true;
  };

  // ── Resolve a local file for playback ──
  const getFileFromPath = async (fileName: string, folderPath: string): Promise<File | null> => {
    // 1. Check in-memory store (populated by webkitdirectory fallback)
    const memKey = `${folderPath}/${fileName}`;
    if (inMemoryFiles.has(memKey)) return inMemoryFiles.get(memKey)!;

    // 2. Try FileSystemDirectoryHandle (File System Access API)
    try {
      const handles = await getStoredHandles();
      const rootFolderName = folderPath.split('/')[0];
      const rootHandle = handles.find(h => h.name === rootFolderName);

      if (!rootHandle) return null;
      if (!(await verifyPermission(rootHandle))) return null;

      const pathParts = folderPath.split('/').slice(1);
      let currentHandle: FileSystemDirectoryHandle = rootHandle;
      for (const part of pathParts) {
        currentHandle = await currentHandle.getDirectoryHandle(part);
      }
      const fileHandle = await currentHandle.getFileHandle(fileName);
      return await fileHandle.getFile();
    } catch (e) {
      console.error('Failed to get file from path', e);
      return null;
    }
  };

  return {
    isScanning,
    scanProgress,
    scanStatus,
    addFolder,
    addFiles,
    loadSampleTrack,
    scanFolder,
    getStoredHandles,
    verifyPermission,
    getFileFromPath,
    getArtForTrack,
  };
}
