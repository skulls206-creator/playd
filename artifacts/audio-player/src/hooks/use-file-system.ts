import { useState } from 'react';
import { get, set } from 'idb-keyval';
import * as mm from 'music-metadata-browser';
import { useBulkUpsertTracks, getListTracksQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

const ART_STORE_KEY = 'track-art';
const AUDIO_EXTS = /\.(mp3|flac|m4a|m4p|aac|wav|ogg|opus|webm|wma|aiff|aif|alac|mp4|3gp)$/i;

/**
 * Detect audio MIME type by reading the file's magic bytes (first 12 bytes).
 * This lets us parse extension-less files (e.g. YouTube Music offline tracks).
 *
 * Signatures:
 *   OGG/Opus  → 4F 67 67 53          "OggS"
 *   WebM      → 1A 45 DF A3          EBML header
 *   MP3+ID3   → 49 44 33             "ID3"
 *   MP3 sync  → FF FB / FF F3 / FF F2
 *   FLAC      → 66 4C 61 43          "fLaC"
 *   WAV       → 52 49 46 46          "RIFF"
 *   MP4/M4A   → ?? ?? ?? ?? 66 74 79 70  "ftyp" at offset 4
 *   AAC ADTS  → FF F1 / FF F9
 */
async function detectMimeType(file: File): Promise<string | undefined> {
  try {
    const buf = await file.slice(0, 12).arrayBuffer();
    const b = new Uint8Array(buf);
    if (b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg';
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'audio/webm';
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33)                  return 'audio/mpeg'; // ID3
    if ((b[0] === 0xFF) && (b[1] === 0xFB || b[1] === 0xF3 || b[1] === 0xF2)) return 'audio/mpeg';
    if (b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43) return 'audio/flac';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'audio/wav';
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'audio/mp4'; // ftyp
    if (b[0] === 0xFF && (b[1] === 0xF1 || b[1] === 0xF9))                return 'audio/aac';
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Always detect MIME type from magic bytes and wrap the file with the correct
 * type so music-metadata-browser picks the right parser. We override the
 * browser-supplied type because .opus files can arrive as 'video/ogg',
 * 'audio/opus', or '' depending on the browser/OS — all of which confuse the
 * parser. Magic bytes are authoritative.
 */
async function withMimeType(file: File): Promise<Blob> {
  const mime = await detectMimeType(file);
  if (mime && mime !== file.type) return new Blob([file], { type: mime });
  return file;
}

/**
 * Parse artist and title from a YouTube Music filename.
 * Handles patterns like:
 *   "NF - HOPE-(p).opus"              → { artist: "NF",    title: "HOPE" }
 *   "Token - Cough Freestyle-(p).opus" → { artist: "Token", title: "Cough Freestyle" }
 *   "Just a Title.mp3"                 → { artist: "",      title: "Just a Title" }
 */
function parseFilenameMetadata(fileName: string): { artist: string; title: string } {
  // Strip extension
  let name = fileName.replace(/\.[^.]+$/, '');
  // Strip YouTube Music's -(p) download marker (may have spaces around dash)
  name = name.replace(/\s*-\s*\(p\)\s*$/, '').trim();
  // Try "Artist - Title" split on first occurrence of " - "
  const sep = name.indexOf(' - ');
  if (sep > 0) {
    return { artist: name.slice(0, sep).trim(), title: name.slice(sep + 3).trim() };
  }
  return { artist: '', title: name.trim() };
}

/**
 * Pull a vorbis/ID3 tag value by key from native tag blocks.
 * Useful when music-metadata-browser's common mapping misses a field.
 */
function nativeTag(native: mm.INativeTagDict | undefined, ...keys: string[]): string | undefined {
  if (!native) return undefined;
  for (const [, tagList] of Object.entries(native)) {
    for (const key of keys) {
      const hit = tagList.find(t => t.id.toUpperCase() === key.toUpperCase());
      if (hit?.value) return String(hit.value);
    }
  }
  return undefined;
}

/**
 * Returns true if the file is likely audio and worth attempting to parse.
 * Accepts:
 *  1. Known audio/video extensions (AUDIO_EXTS)
 *  2. Files whose MIME type starts with audio/ or video/
 *  3. Files with NO extension at all (YouTube Music stores offline tracks
 *     as extension-less blobs — music-metadata-browser can parse them by
 *     reading the actual file header)
 * Explicitly rejects common non-audio extensions to avoid wasting time on
 * images, docs, etc. that happen to have no extension.
 */
const SKIP_EXTS = /\.(jpg|jpeg|png|gif|webp|bmp|svg|pdf|txt|xml|json|html|css|js|db|sqlite|ini|log|zip|rar|7z|exe|dll|lnk|url|nfo|cue|m3u|m3u8|pls|xspf)$/i;

function isLikelyAudio(file: File): boolean {
  if (AUDIO_EXTS.test(file.name)) return true;
  if (file.type.startsWith('audio/')) return true;
  if (file.type.startsWith('video/')) return true;
  // No extension at all → try parsing (YouTube Music offline files)
  if (!file.name.includes('.')) return true;
  // Known non-audio extension → skip
  if (SKIP_EXTS.test(file.name)) return false;
  // Unknown extension → optimistically try
  return true;
}

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
    skippedExts?: string[],
  ) => {
    setIsScanning(true);
    setScanProgress(0);
    setScanStatus(`Scanning ${rootName}…`);

    try {
      const tracks: any[] = [];
      const artStore: Record<string, string> = (await get(ART_STORE_KEY)) || {};
      let count = 0;

      for (const { file, relativePath } of entries) {
        const parts = relativePath.split('/');
        const fileName = parts[parts.length - 1];
        const folderPath = parts.slice(0, -1).join('/') || rootName;

        // Store the File object in memory for session playback regardless
        inMemoryFiles.set(`${folderPath}/${fileName}`, file);

        // Filename is always available as a last-resort fallback
        const fileMeta = parseFilenameMetadata(fileName);

        try {
          const blobToScan = await withMimeType(file);
          const metadata = await mm.parseBlob(blobToScan, { duration: true, skipCovers: false });

          // Album art → IndexedDB only (not sent to server)
          if (metadata.common.picture?.length) {
            const pic = metadata.common.picture[0];
            const artBlob = new Blob([pic.data], { type: pic.format });
            const dataUrl: string = await new Promise(resolve => {
              const reader = new FileReader();
              reader.onload = e => resolve(e.target?.result as string);
              reader.readAsDataURL(artBlob);
            });
            artStore[relativePath] = dataUrl;
          }

          // Artist: common → native vorbis ARTIST tag → filename parse → empty
          const artist =
            metadata.common.artist ||
            (metadata.common.artists as string[] | undefined)?.[0] ||
            nativeTag(metadata.native, 'ARTIST', 'artist') ||
            fileMeta.artist ||
            '';

          // Title: common → native tag → filename parse → raw file name
          const title =
            metadata.common.title ||
            nativeTag(metadata.native, 'TITLE', 'title') ||
            fileMeta.title ||
            fileName;

          tracks.push({
            title,
            artist,
            album: metadata.common.album || nativeTag(metadata.native, 'ALBUM') || 'Unknown Album',
            year: metadata.common.year || null,
            genre: metadata.common.genre?.[0] || nativeTag(metadata.native, 'GENRE') || null,
            duration: Math.round(metadata.format.duration || 0),
            trackNumber: metadata.common.track?.no || null,
            fileName,
            folderPath,
            albumArtDataUrl: null,
            source: 'local',
          });
        } catch {
          // Metadata parse failed — fall back entirely to filename parsing.
          tracks.push({
            title: fileMeta.title || fileName,
            artist: fileMeta.artist || '',
            album: '',
            year: null,
            genre: null,
            duration: 0,
            trackNumber: null,
            fileName,
            folderPath,
            albumArtDataUrl: null,
            source: 'local',
          });
        }

        count++;
        setScanProgress(count);
        setScanStatus(`Scanning ${rootName}… (${count} files loaded)`);
      }

      await set(ART_STORE_KEY, artStore);

      if (tracks.length === 0) {
        const extInfo = skippedExts && skippedExts.length > 0
          ? ` Found: ${[...new Set(skippedExts)].slice(0, 6).join(', ')}`
          : '';
        setScanStatus(`No audio files found.${extInfo}`);
        setTimeout(() => setScanStatus(''), 8000);
        return;
      }

      setScanStatus(`Saving ${tracks.length} tracks to library…`);
      await bulkUpsert.mutateAsync({ data: { tracks } });

      await queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });
      setScanStatus(`✓ ${tracks.length} tracks imported successfully`);
      setTimeout(() => setScanStatus(''), 8000);
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
    const skippedExts: string[] = [];

    const hasPermission = await verifyPermission(dirHandle);
    if (!hasPermission) {
      setScanStatus('Permission denied');
      return;
    }

    async function walk(handle: FileSystemDirectoryHandle, path: string) {
      for await (const entry of (handle as any).values()) {
        if (entry.kind === 'directory') {
          await walk(entry, `${path}/${entry.name}`);
        } else if (entry.kind === 'file') {
          const file = await entry.getFile();
          if (isLikelyAudio(file)) {
            entries.push({ file, relativePath: `${path}/${entry.name}` });
          } else {
            const ext = entry.name.includes('.')
              ? '.' + entry.name.split('.').pop()!.toLowerCase()
              : '(no ext)';
            skippedExts.push(ext);
          }
        }
      }
    }

    await walk(dirHandle, dirHandle.name);
    await processTracks(entries, dirHandle.name, skippedExts);
  };

  // ── Scan via FileList (webkitdirectory fallback) ──
  // Accept EVERY file in the folder — no extension or MIME filtering at all.
  // processTracks will try to parse each one; failures still get added with
  // just the filename so nothing is silently dropped.
  const scanFileList = async (files: FileList) => {
    if (!files.length) return;
    const entries: Array<{ file: File; relativePath: string }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      entries.push({ file, relativePath: (file as any).webkitRelativePath || file.name });
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
    scanFileList,
    getStoredHandles,
    verifyPermission,
    getFileFromPath,
    getArtForTrack,
  };
}
