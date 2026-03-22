import { useState, useCallback } from 'react';
import { get, set } from 'idb-keyval';
import * as mm from 'music-metadata-browser';
import { useBulkUpsertTracks } from '@workspace/api-client-react';

export function useFileSystem() {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('');
  const bulkUpsert = useBulkUpsertTracks();

  const verifyPermission = async (fileHandle: FileSystemHandle, readWrite = false) => {
    const options = { mode: readWrite ? 'readwrite' : 'read' } as any;
    if ((await fileHandle.queryPermission(options)) === 'granted') return true;
    if ((await fileHandle.requestPermission(options)) === 'granted') return true;
    return false;
  };

  const getStoredHandles = async (): Promise<FileSystemDirectoryHandle[]> => {
    return (await get('music-folders')) || [];
  };

  const addFolder = async () => {
    try {
      const handle = await window.showDirectoryPicker();
      const existing = await getStoredHandles();
      
      // Check if already added
      if (!existing.some(h => h.name === handle.name)) {
        await set('music-folders', [...existing, handle]);
      }
      
      await scanFolder(handle);
      return true;
    } catch (e) {
      console.error('User cancelled or error picking directory', e);
      return false;
    }
  };

  const scanFolder = async (dirHandle: FileSystemDirectoryHandle) => {
    setIsScanning(true);
    setScanProgress(0);
    setScanStatus(`Scanning ${dirHandle.name}...`);
    
    try {
      const hasPermission = await verifyPermission(dirHandle);
      if (!hasPermission) throw new Error('Permission denied');

      const tracks: any[] = [];
      
      async function walk(handle: FileSystemDirectoryHandle, currentPath: string) {
        for await (const entry of (handle as any).values()) {
          if (entry.kind === 'directory') {
            await walk(entry, `${currentPath}/${entry.name}`);
          } else if (entry.kind === 'file') {
            if (entry.name.match(/\.(mp3|flac|m4a|aac|wav|ogg|opus)$/i)) {
              const file = await entry.getFile();
              try {
                const metadata = await mm.parseBlob(file);
                let albumArtDataUrl = null;
                
                if (metadata.common.picture && metadata.common.picture.length > 0) {
                  const pic = metadata.common.picture[0];
                  const blob = new Blob([pic.data], { type: pic.format });
                  albumArtDataUrl = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target?.result as string);
                    reader.readAsDataURL(blob);
                  });
                }

                tracks.push({
                  title: metadata.common.title || entry.name,
                  artist: metadata.common.artist || 'Unknown Artist',
                  album: metadata.common.album || 'Unknown Album',
                  year: metadata.common.year || null,
                  genre: metadata.common.genre?.[0] || null,
                  duration: metadata.format.duration || 0,
                  trackNumber: metadata.common.track?.no || null,
                  fileName: entry.name,
                  folderPath: currentPath,
                  albumArtDataUrl,
                  source: 'local'
                });
                
                setScanProgress(p => p + 1);
              } catch (e) {
                console.warn('Failed to parse', entry.name, e);
              }
            }
          }
        }
      }

      await walk(dirHandle, dirHandle.name);
      setScanStatus('Saving to database...');
      
      if (tracks.length > 0) {
        await bulkUpsert.mutateAsync({ data: { tracks } });
      }
      
    } catch (error) {
      console.error('Scan failed', error);
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
      let currentHandle = rootHandle;
      
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
    getStoredHandles,
    verifyPermission,
    getFileFromPath
  };
}
