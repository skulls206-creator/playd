/**
 * useDiscordRpc — Bridges PLAYD's playback state to Discord Rich Presence.
 *
 * Works in two modes:
 * 1. Electron app: uses the preload bridge (window.playdDesktop) to send
 *    playback data to the main process, which handles the native Discord RPC socket.
 * 2. Browser: gracefully degrades (no-op) if the bridge isn't available.
 *
 * The Electron main process handles the actual discord-rpc connection.
 * This hook just fires updates on track changes and play/pause.
 */

import { useEffect, useRef } from 'react';
import { useAudioPlayer } from './use-audio-player';

declare global {
  interface Window {
    playdDesktop?: {
      isElectron: boolean;
      updateRichPresence: (data: {
        title?: string;
        artist?: string;
        album?: string;
        startTime?: number;
        endTime?: number;
      }) => void;
      clearRichPresence: () => void;
      onMediaKey: (callback: (action: string) => void) => void;
    };
  }
}

export function useDiscordRpc() {
  const currentTrack = useAudioPlayer((s) => s.currentTrack);
  const isPlaying = useAudioPlayer((s) => s.isPlaying);
  const startTimeRef = useRef<number | null>(null);
  const prevPlaying = useRef(false);
  const initialized = useRef(false);

  // Check for Electron bridge
  const isDesktop = typeof window !== 'undefined' && window.playdDesktop?.isElectron;

  // Only attempt to connect if the bridge is available
  useEffect(() => {
    if (!isDesktop) return;
    if (initialized.current) return;
    initialized.current = true;

    // Listen for OS media keys (Electron sends them via IPC)
    window.playdDesktop!.onMediaKey((action) => {
      const store = useAudioPlayer.getState();
      switch (action) {
        case 'playPause':
          store.togglePlay();
          break;
        case 'next':
          store.next();
          break;
        case 'prev':
          store.prev();
          break;
      }
    });
  }, [isDesktop]);

  // Track changes: update or clear presence
  useEffect(() => {
    if (!isDesktop) return;
    if (!window.playdDesktop) return;

    if (isPlaying && currentTrack) {
      if (!startTimeRef.current || prevPlaying.current === false) {
        startTimeRef.current = Date.now();
      }

      window.playdDesktop.updateRichPresence({
        title: currentTrack.title || undefined,
        artist: currentTrack.artist || undefined,
        album: currentTrack.album || undefined,
        startTime: startTimeRef.current,
      });
    } else if (!isPlaying && prevPlaying.current) {
      window.playdDesktop.clearRichPresence();
    }

    prevPlaying.current = isPlaying;
  }, [isPlaying, currentTrack?.id, isDesktop]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (isDesktop && window.playdDesktop) {
        window.playdDesktop.clearRichPresence();
      }
    };
  }, [isDesktop]);
}
