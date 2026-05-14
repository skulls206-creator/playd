import { useEffect, useRef } from 'react';
import { get } from 'idb-keyval';
import type { LocalTrack } from '@/lib/track-store';

const ART_STORE_KEY = 'track-art';
const NOTIF_PREF_KEY = 'playd_notifications';

export function notificationsEnabled(): boolean {
  return localStorage.getItem(NOTIF_PREF_KEY) === '1';
}

export function setNotificationsEnabled(val: boolean) {
  localStorage.setItem(NOTIF_PREF_KEY, val ? '1' : '0');
}

async function resolveArtUrl(track: LocalTrack): Promise<string | undefined> {
  if (track.albumArtDataUrl) return track.albumArtDataUrl;
  if (track.source === 'local' && track.fileName && track.folderPath) {
    const store: Record<string, string> | undefined = await get(ART_STORE_KEY);
    return store?.[`${track.folderPath}/${track.fileName}`];
  }
  return undefined;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

async function showNotification(title: string, options: NotificationOptions): Promise<Notification | null> {
  // Some browsers (iOS Safari, certain PWA contexts) throw on new Notification()
  // and require going through the Service Worker registration instead.
  try {
    const n = new Notification(title, options);
    return n;
  } catch {
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, { ...options, requireInteraction: false });
      } catch {
        // Notification not supported in this context — fail silently
      }
    }
    return null;
  }
}

export function useNowPlayingNotification(currentTrack: LocalTrack | null) {
  const prevTrackId = useRef<number | string | null>(null);
  const notifRef = useRef<Notification | null>(null);

  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.id === prevTrackId.current) return;
    prevTrackId.current = currentTrack.id;

    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!notificationsEnabled()) return;

    let cancelled = false;

    resolveArtUrl(currentTrack).then(async artUrl => {
      if (cancelled) return;

      notifRef.current?.close();
      notifRef.current = null;

      const title = currentTrack.title || 'Now Playing';
      const options: NotificationOptions = {
        body: [currentTrack.artist, currentTrack.album].filter(Boolean).join(' · '),
        icon: artUrl ?? `${window.location.origin}/images/default-cover.png`,
        badge: `${window.location.origin}/images/default-cover.png`,
        silent: true,
        tag: 'playd-now-playing',
      };

      const n = await showNotification(title, options);
      if (n) {
        notifRef.current = n;
        const timer = setTimeout(() => n.close(), 6000);
        n.onclose = () => clearTimeout(timer);
      }
    });

    return () => { cancelled = true; };
  }, [currentTrack?.id]);
}
