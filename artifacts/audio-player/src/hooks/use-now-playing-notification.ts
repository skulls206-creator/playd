import { useEffect, useRef } from 'react';
import { get } from 'idb-keyval';
import type { Track } from '@workspace/api-client-react';

const ART_STORE_KEY = 'track-art';
const NOTIF_PREF_KEY = 'playd_notifications';

export function notificationsEnabled(): boolean {
  return localStorage.getItem(NOTIF_PREF_KEY) === '1';
}

export function setNotificationsEnabled(val: boolean) {
  localStorage.setItem(NOTIF_PREF_KEY, val ? '1' : '0');
}

async function resolveArtUrl(track: Track): Promise<string | undefined> {
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

export function useNowPlayingNotification(currentTrack: Track | null) {
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

    resolveArtUrl(currentTrack).then(artUrl => {
      if (cancelled) return;

      notifRef.current?.close();

      const n = new Notification(currentTrack.title || 'Now Playing', {
        body: [currentTrack.artist, currentTrack.album]
          .filter(Boolean)
          .join(' · '),
        icon: artUrl ?? `${window.location.origin}/images/default-cover.png`,
        badge: `${window.location.origin}/images/default-cover.png`,
        silent: true,
        tag: 'playd-now-playing',
      });

      notifRef.current = n;

      const timer = setTimeout(() => n.close(), 6000);
      n.onclose = () => clearTimeout(timer);
    });

    return () => { cancelled = true; };
  }, [currentTrack?.id]);
}
