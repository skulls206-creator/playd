import { useState, useCallback } from 'react';
import { get, set } from 'idb-keyval';
import * as mm from 'music-metadata-browser';
import { useBulkUpsertTracks, getListTracksQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

const ART_STORE_KEY = 'track-art';

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

  const addFolder = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
      const existing = await getStoredHandles();
      if (!existing.some(h => h.name === handle.name)) {
        await set('music-folders', [...existing, handle]);
      }
      await scanFolder(handle);
      return true;
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.error('Error picking directory', e);
      }
      return false;
    }
  };

  const scanFolder = async (dirHandle: FileSystemDirectoryHandle) => {
    setIsScanning(true);
    setScanProgress(0);
    setScanStatus(`Scanning ${dirHandle.name}…`);

    try {
      const hasPermission = await verifyPermission(dirHandle);
      if (!hasPermission) throw new Error('Permission denied');

      const tracks: any[] = [];
      const artStore: Record<string, string> = (await get(ART_STORE_KEY)) || {};

      async function walk(handle: FileSystemDirectoryHandle, currentPath: string) {
        for await (const entry of (handle as any).values()) {
          if (entry.kind === 'directory') {
            await walk(entry, `${currentPath}/${entry.name}`);
          } else if (entry.kind === 'file') {
            if (/\.(mp3|flac|m4a|aac|wav|ogg|opus)$/i.test(entry.name)) {
              const file = await entry.getFile();
              try {
                const metadata = await mm.parseBlob(file, { duration: true, skipCovers: false });

                // Store album art in IndexedDB (not sent to server to keep payload small)
                if (metadata.common.picture && metadata.common.picture.length > 0) {
                  const pic = metadata.common.picture[0];
                  const blob = new Blob([pic.data], { type: pic.format });
                  const dataUrl: string = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = e => resolve(e.target?.result as string);
                    reader.readAsDataURL(blob);
                  });
                  artStore[`${currentPath}/${entry.name}`] = dataUrl;
                }

                tracks.push({
                  title: metadata.common.title || entry.name.replace(/\.[^/.]+$/, ''),
                  artist: metadata.common.artist || 'Unknown Artist',
                  album: metadata.common.album || 'Unknown Album',
                  year: metadata.common.year || null,
                  genre: metadata.common.genre?.[0] || null,
                  duration: Math.round(metadata.format.duration || 0),
                  trackNumber: metadata.common.track?.no || null,
                  fileName: entry.name,
                  folderPath: currentPath,
                  albumArtDataUrl: null, // stored locally in IndexedDB, not sent to server
                  source: 'local',
                });

                setScanProgress(p => p + 1);
                setScanStatus(`Scanning ${dirHandle.name}… (${tracks.length} tracks)`);
              } catch (e) {
                console.warn('Failed to parse', entry.name, e);
              }
            }
          }
        }
      }

      await walk(dirHandle, dirHandle.name);

      // Save art to IndexedDB
      await set(ART_STORE_KEY, artStore);

      setScanStatus(`Saving ${tracks.length} tracks…`);

      if (tracks.length > 0) {
        await bulkUpsert.mutateAsync({ data: { tracks } });
      }

      // Invalidate tracks query so the sidebar refreshes immediately
      await queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });

    } catch (error) {
      console.error('Scan failed', error);
      setScanStatus('Scan failed — check console');
    } finally {
      setIsScanning(false);
      setScanStatus('');
    }
  };

  const getFileFromPath = async (fileName: string, folderPath: string): Promise<File | null> => {
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
    scanFolder,
    getStoredHandles,
    verifyPermission,
    getFileFromPath,
    getArtForTrack,
  };
}
