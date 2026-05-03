import { useEffect, useRef } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';
import { useNowPlayingNotification } from '@/hooks/use-now-playing-notification';
import { useToast } from '@/hooks/use-toast';
import type { Track } from '@workspace/api-client-react';
import { requestVaultKey, decryptVaultBlob } from '@/hooks/use-vault-crypto';
import { sharedAnalyserRef, sharedAudioContextRef } from '@/lib/audio-context-ref';

const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// ── iOS background audio keep-alive ──────────────────────────────────────────
// iOS suspends the WebAudio context when the screen locks. The ONLY way to
// prevent this is to have a native <audio> element (NOT in the Web Audio graph)
// actively playing. We loop a 1-sample silent WAV through a raw <audio> element;
// iOS treats it as an active audio session and leaves the AudioContext alone.
function buildSilentWavUri(): string {
  const buf  = new ArrayBuffer(45);
  const view = new DataView(buf);
  const str  = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 37, true);
  str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);    // PCM
  view.setUint16(22, 1, true);    // mono
  view.setUint32(24, 8000, true); // sample rate
  view.setUint32(28, 8000, true); // byte rate
  view.setUint16(32, 1, true);    // block align
  view.setUint16(34, 8, true);    // bits per sample
  str(36, 'data'); view.setUint32(40, 1, true);
  view.setUint8(44, 0x80);        // 0x80 = silence for unsigned 8-bit PCM
  let b = ''; new Uint8Array(buf).forEach(x => { b += String.fromCharCode(x); });
  return 'data:audio/wav;base64,' + btoa(b);
}
const SILENT_WAV_URI = buildSilentWavUri();

interface Deck {
  audio: HTMLAudioElement;
  crossGain: GainNode;
  loadedTrackId: number | null;
  objectUrl: string | null;
}

export function AudioEngine() {
  const deckA = useRef<Deck | null>(null);
  const deckB = useRef<Deck | null>(null);
  const active = useRef<'A' | 'B'>('A');
  const xfading = useRef(false);
  const xfadeNextIdx = useRef<number | null>(null); // index pinned when crossfade starts
  const preloadedRef = useRef(false);               // idle deck has next track loaded, not yet playing
  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const rgGainRef = useRef<GainNode | null>(null);
  const filtersRef = useRef<BiquadFilterNode[]>([]);
  const lockControllerRef = useRef<AbortController | null>(null);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);

  const {
    currentTrack, isPlaying, volume, isMuted, progress, eqBands, crossfadeSec,
    replaygainEnabled,
    _setProgress, _setDuration, _trackEnded, play, pause, next, prev,
  } = useAudioPlayer();

  const { getFileFromPath } = useFileSystem();
  const { toast } = useToast();
  useNowPlayingNotification(currentTrack ?? null);

  // Stable refs for values used inside event-listener closures
  const isPlayingRef = useRef(isPlaying);
  const crossfadeSecRef = useRef(crossfadeSec);
  const getFileFromPathRef = useRef(getFileFromPath);
  isPlayingRef.current = isPlaying;
  crossfadeSecRef.current = crossfadeSec;
  getFileFromPathRef.current = getFileFromPath;

  // ── Screen Wake Lock ─────────────────────────────────────────────────────────
  // Keeps the screen awake while music is playing so the OS doesn't kill audio.
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    const acquire = async () => {
      if (wakeLockRef.current) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
      } catch { /* permission denied or page not visible */ }
    };

    const release = () => {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };

    if (isPlaying) acquire(); else release();
  }, [isPlaying]);

  // Re-acquire wake lock when the page becomes visible again
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && isPlayingRef.current && !wakeLockRef.current) {
        navigator.wakeLock.request('screen')
          .then(lock => {
            wakeLockRef.current = lock;
            lock.addEventListener('release', () => { wakeLockRef.current = null; });
          })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Resume AudioContext + re-start deck audio when the user returns from background.
  // On iOS the AudioContext is suspended when the screen locks. Even with the silent
  // audio keep-alive the context may be throttled, so we aggressively resume it the
  // moment the page becomes visible again to eliminate any gap in playback.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || !isPlayingRef.current) return;
      const ctx = ctxRef.current;
      const act = (active.current === 'A' ? deckA : deckB).current;
      if (!ctx || !act) return;
      const forcePlay = () => {
        if (act.audio.paused) act.audio.play().catch(() => {});
        silentAudioRef.current?.play().catch(() => {});
      };
      if (ctx.state === 'suspended') {
        ctx.resume().then(forcePlay).catch(forcePlay);
      } else {
        forcePlay();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // ── Web Locks keep-alive ──────────────────────────────────────────────────
  // Holding a shared Web Lock signals to the browser that this tab has active
  // work in progress, preventing it from throttling JS timers in the background.
  // The lock is acquired when playback starts and released when it stops.
  useEffect(() => {
    if (!('locks' in navigator)) return;

    if (isPlaying) {
      lockControllerRef.current?.abort();
      const controller = new AbortController();
      lockControllerRef.current = controller;

      navigator.locks.request(
        'playd-keep-alive',
        { mode: 'shared', signal: controller.signal },
        () => new Promise<void>(resolve => {
          controller.signal.addEventListener('abort', () => resolve());
        }),
      ).catch(() => {});
    } else {
      lockControllerRef.current?.abort();
      lockControllerRef.current = null;
    }

    return () => {
      lockControllerRef.current?.abort();
      lockControllerRef.current = null;
    };
  }, [isPlaying]);

  // Deck helpers (always read the latest active ref)
  const getActive = () => (active.current === 'A' ? deckA : deckB).current!;
  const getIdle   = () => (active.current === 'A' ? deckB : deckA).current!;
  const swap      = () => { active.current = active.current === 'A' ? 'B' : 'A'; };

  // Helper: exchange the long-lived account JWT for a short-lived stream-scoped
  // token bound to a single resource (e.g. `subsonic:42:trackId`). Used for
  // `<audio src>` URLs which cannot set custom headers.
  const fetchStreamToken = async (resource: string): Promise<string | null> => {
    const jwt = (() => { try { return localStorage.getItem('playd_token'); } catch { return null; } })();
    if (!jwt) {
      toast({
        title: 'Not signed in',
        description: 'Please sign in again to play this track.',
        duration: 8000,
      });
      return null;
    }
    try {
      const resp = await fetch('/api/auth/stream-token', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        console.error('AudioEngine: failed to obtain stream token', resp.status, body);
        toast({
          title: `Stream token failed (${resp.status})`,
          description: resp.status === 401
            ? 'Your session expired. Sign out and sign back in.'
            : (body.slice(0, 140) || 'Could not obtain a playback token.'),
          duration: 9000,
        });
        return null;
      }
      const data: { token?: string } = await resp.json();
      return data.token ?? null;
    } catch (e) {
      console.error('AudioEngine: stream token fetch error', e);
      toast({
        title: 'Network error',
        description: `Could not reach stream-token endpoint: ${(e as Error).message ?? e}`,
        duration: 9000,
      });
      return null;
    }
  };

  // Resolve a playable URL for any track source
  const resolveTrackSrc = useRef(async (track: Track): Promise<string | null> => {
    if (track.source === 'local') {
      const file = await getFileFromPathRef.current(track.fileName, track.folderPath);
      if (!file) { console.error('Cannot access local file'); return null; }
      return URL.createObjectURL(file);
    }

    if (track.source === 'subsonic' && track.subsonicServerId && track.subsonicId) {
      // Audio elements cannot set custom headers, so we embed a resource-bound
      // stream token in the URL. We exchange the account JWT (sent via the
      // Authorization header) for a short-lived stream-scoped token bound to
      // this exact track. A leaked stream URL is therefore replayable for at
      // most ~5 minutes and only against this one resource — never against
      // normal APIs and never against other tracks.
      const resource = `subsonic:${track.subsonicServerId}:${track.subsonicId}`;
      const streamToken = await fetchStreamToken(resource);
      if (!streamToken) return null;
      const qs = `?token=${encodeURIComponent(streamToken)}`;
      return `/api/subsonic-servers/${track.subsonicServerId}/stream/${encodeURIComponent(track.subsonicId)}${qs}`;
    }

    if (track.source === 'youtube') {
      // YouTube stream: call /api/yt/stream/:videoId to get CDN URL.
      // Use Authorization header to avoid placing the JWT in the URL.
      const videoId = track.fileName;
      const jwt = (() => { try { return localStorage.getItem('playd_token'); } catch { return null; } })();
      if (!jwt) {
        toast({
          title: 'Not signed in',
          description: 'Sign in again to stream from YouTube.',
          duration: 8000,
        });
        return null;
      }
      const headers: HeadersInit = { Authorization: `Bearer ${jwt}` };
      console.log('[AudioEngine] YT resolve →', { videoId, title: track.title });
      try {
        const resp = await fetch(`/api/yt/stream/${encodeURIComponent(videoId)}`, { headers });
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          console.error('[AudioEngine] YT stream fetch failed', resp.status, body);
          toast({
            title: `YouTube stream failed (${resp.status})`,
            description:
              resp.status === 401 ? 'Session expired — sign out and back in.' :
              resp.status === 404 ? `Video not found: ${videoId}` :
              resp.status === 429 ? 'Too many requests. Wait a minute and try again.' :
              resp.status === 503 ? 'Server busy — too many concurrent streams. Try again in a moment.' :
              (body.slice(0, 180) || `Could not resolve a stream URL for "${track.title}".`),
            duration: 10000,
          });
          return null;
        }
        const data = await resp.json();
        if (!data.streamUrl) {
          console.error('[AudioEngine] YT response missing streamUrl', data);
          toast({
            title: 'No stream URL returned',
            description: `Server response had no streamUrl for "${track.title}".`,
            duration: 9000,
          });
          return null;
        }
        console.log('[AudioEngine] YT resolved OK', { len: data.streamUrl.length });
        return data.streamUrl;
      } catch (e) {
        console.error('[AudioEngine] YT stream network error', e);
        toast({
          title: 'Network error',
          description: `Could not reach YT stream endpoint: ${(e as Error).message ?? e}`,
          duration: 9000,
        });
        return null;
      }
    }

    if (track.source === 'vault') {
      // Vault track: fetch encrypted blob from the API, decrypt in-browser, return blob URL.
      // If the vault key is not in session, requestVaultKey() opens the unlock modal and waits.
      let masterKey: CryptoKey;
      try {
        masterKey = await requestVaultKey();
      } catch {
        // User cancelled the unlock modal
        toast({
          title: 'Vault locked',
          description: 'Enter your vault password to play encrypted tracks.',
          duration: 5000,
        });
        return null;
      }
      if (!track.vaultEncryptedKey || !track.vaultKeyIv || !track.vaultDataIv) {
        console.error('AudioEngine: vault track missing crypto metadata', track.id);
        return null;
      }
      const jwt = (() => { try { return localStorage.getItem('playd_token'); } catch { return null; } })();
      const resp = await fetch(`/api/vault/download/${track.id}`, {
        headers: jwt ? { 'Authorization': `Bearer ${jwt}` } : {},
      });
      if (!resp.ok) {
        console.error('AudioEngine: vault download failed', resp.status);
        return null;
      }
      const ciphertext = await resp.arrayBuffer();
      const plaintext  = await decryptVaultBlob(
        ciphertext,
        track.vaultEncryptedKey,
        track.vaultKeyIv,
        track.vaultDataIv,
        masterKey,
      );
      return URL.createObjectURL(new Blob([plaintext]));
    }

    console.warn('AudioEngine: unsupported track source', track.source);
    return null;
  });

  // Load a track onto a deck and return success
  const loadDeckFile = useRef(async (deck: Deck, track: Track): Promise<boolean> => {
    if (deck.objectUrl) { URL.revokeObjectURL(deck.objectUrl); deck.objectUrl = null; }
    deck.loadedTrackId = null;

    const src = await resolveTrackSrc.current(track);
    if (!src) return false;

    // Only keep a reference to object URLs (not remote stream URLs) for revocation
    if (src.startsWith('blob:')) deck.objectUrl = src;

    deck.audio.src = src;
    deck.audio.load();
    deck.loadedTrackId = track.id;
    return true;
  });

  // ── Initialize Web Audio graph (once) ────────────────────────────────────────
  useEffect(() => {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    ctxRef.current = ctx;
    sharedAudioContextRef.current = ctx;

    // Master gain (volume / mute)
    const master = ctx.createGain();
    masterGainRef.current = master;
    master.connect(ctx.destination);

    // Analyser → master
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.8;
    sharedAnalyserRef.current = analyser;
    analyser.connect(master);

    // ReplayGain gain node (between EQ chain and analyser)
    const rgGain = ctx.createGain();
    rgGain.gain.value = 1.0;
    rgGainRef.current = rgGain;
    rgGain.connect(analyser);

    // 10-band EQ chain → rgGain
    const filters = EQ_FREQS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = freq;
      return f;
    });
    filtersRef.current = filters;
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
    filters[filters.length - 1].connect(rgGain);

    // Create one deck with a given initial crossfade gain value.
    // The <audio> element is appended to the DOM (hidden) so the browser
    // marks the tab as "media playing" and reduces background timer throttling.
    const makeDeck = (initGain: number): Deck => {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.style.cssText = 'position:absolute;width:0;height:0;left:-9999px;top:-9999px;pointer-events:none';
      audio.setAttribute('aria-hidden', 'true');
      document.body.appendChild(audio);
      const source = ctx.createMediaElementSource(audio);
      const crossGain = ctx.createGain();
      crossGain.gain.value = initGain;
      source.connect(crossGain);
      crossGain.connect(filters[0]);
      return { audio, crossGain, loadedTrackId: null, objectUrl: null };
    };

    deckA.current = makeDeck(1.0); // active
    deckB.current = makeDeck(0.0); // idle

    // Silent audio keep-alive: a 1-sample WAV looping through BOTH the native
    // media layer AND the Web Audio graph (via a zero-gain node).
    //
    // Why both?
    // - Native layer: tells iOS an audio session is active → OS won't revoke
    //   the audio session while the screen is locked.
    // - Web Audio node: iOS only keeps an AudioContext in the "running" state
    //   while there is at least one active MediaElementAudioSourceNode producing
    //   frames. Without this, when the current track ends the context gets
    //   interrupted and ctx.resume() won't resolve until the app is foregrounded
    //   — which is exactly the "have to open the app to start the next song" bug.
    const silent = new Audio(SILENT_WAV_URI);
    silent.loop   = true;
    silent.volume = 0;
    silent.style.cssText = 'position:absolute;width:0;height:0;left:-9999px;top:-9999px;pointer-events:none';
    silent.setAttribute('aria-hidden', 'true');
    document.body.appendChild(silent);
    silentAudioRef.current = silent;

    // Route the silent element through a gain-0 node so the AudioContext always
    // has an active source, preventing iOS from interrupting it between tracks.
    const silentSrc  = ctx.createMediaElementSource(silent);
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    silentSrc.connect(silentGain);
    silentGain.connect(ctx.destination);

    // Auto-resume the AudioContext if the browser suspends it in the background.
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'suspended' && isPlayingRef.current) {
        ctx.resume().catch(() => {});
      }
    });

    // OS Media Session
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play',          () => play());
      navigator.mediaSession.setActionHandler('pause',         () => pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => prev());
      navigator.mediaSession.setActionHandler('nexttrack',     () => next());
      navigator.mediaSession.setActionHandler('seekto', (d) => {
        const a = getActive();
        if (d.fastSeek && 'fastSeek' in a.audio) a.audio.fastSeek(d.seekTime || 0);
        else a.audio.currentTime = d.seekTime || 0;
      });
    }

    return () => {
      deckA.current?.audio.pause();
      deckB.current?.audio.pause();
      if (deckA.current?.objectUrl) URL.revokeObjectURL(deckA.current.objectUrl);
      if (deckB.current?.objectUrl) URL.revokeObjectURL(deckB.current.objectUrl);
      deckA.current?.audio.parentNode?.removeChild(deckA.current.audio);
      deckB.current?.audio.parentNode?.removeChild(deckB.current.audio);
      silentAudioRef.current?.pause();
      silentAudioRef.current?.parentNode?.removeChild(silentAudioRef.current);
      silentAudioRef.current = null;
      sharedAnalyserRef.current = null;
      ctx.close();
    };
  }, []);

  // ── Audio event listeners (set up once; read live values through refs) ────────
  useEffect(() => {
    const a = deckA.current;
    const b = deckB.current;
    if (!a || !b) return;

    // Preload (and optionally crossfade) the next track when close to end.
    // Always preloads at least PRELOAD_SEC before end even with no crossfade —
    // this keeps the audio session alive through the transition on Android/iOS.
    const PRELOAD_SEC = 5;
    const maybeCrossfade = (myDeck: Deck, otherDeck: Deck, slot: 'A' | 'B') => {
      if (active.current !== slot) return;
      if (xfading.current || preloadedRef.current) return; // already handling transition

      const secs = crossfadeSecRef.current;
      const remaining = myDeck.audio.duration - myDeck.audio.currentTime;
      // Non-finite duration (live streams, some formats): skip silently
      if (!isFinite(remaining) || remaining <= 0) return;

      // Trigger: whichever threshold comes first (preload or crossfade start)
      const triggerAt = secs > 0 ? Math.max(secs, PRELOAD_SEC) : PRELOAD_SEC;
      if (remaining > triggerAt) return;

      const state = useAudioPlayer.getState();
      if (state.repeatMode === 'one') return;
      if (state.sleepTimerMode === 'track') return;

      let nextIdx = state.queueIndex + 1;
      if (state.isShuffle) {
        const cur = state.queueIndex;
        if (state.queue.length > 1) {
          do { nextIdx = Math.floor(Math.random() * state.queue.length); } while (nextIdx === cur);
        } else {
          nextIdx = 0;
        }
      }
      if (nextIdx >= state.queue.length) {
        if (state.repeatMode !== 'all') return;
        nextIdx = 0;
      }
      const nextTrack = state.queue[nextIdx]?.track;
      if (!nextTrack) return;

      // Pin index so handleEnded uses the exact same track (shuffle-safe)
      xfadeNextIdx.current = nextIdx;
      xfading.current = true; // block re-entry during async load

      (async () => {
        const ok = await loadDeckFile.current(otherDeck, nextTrack);
        if (!ok) { xfading.current = false; return; }

        const ctx = ctxRef.current!;

        if (secs > 0) {
          // ── Crossfade path: start idle deck playing with gain ramp ──────────
          const fadeDur = crossfadeSecRef.current;
          otherDeck.crossGain.gain.cancelScheduledValues(ctx.currentTime);
          otherDeck.crossGain.gain.setValueAtTime(0, ctx.currentTime);
          otherDeck.crossGain.gain.linearRampToValueAtTime(1, ctx.currentTime + fadeDur);
          ctx.resume().catch(() => {}); // fire-and-forget — don't stall play() waiting for resume
          otherDeck.audio.play().catch(() => {});
          myDeck.crossGain.gain.cancelScheduledValues(ctx.currentTime);
          myDeck.crossGain.gain.setValueAtTime(myDeck.crossGain.gain.value, ctx.currentTime);
          myDeck.crossGain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeDur);
          // xfading stays true; handleEnded will complete the swap
        } else {
          // ── Gapless preload path: track ready, NOT yet playing ──────────────
          // handleEnded will instantly swap + play within the ended event,
          // keeping the OS audio session alive with no gap.
          otherDeck.crossGain.gain.cancelScheduledValues(ctx.currentTime);
          otherDeck.crossGain.gain.value = 0;
          otherDeck.audio.pause();
          xfading.current = false;
          preloadedRef.current = true;
        }
      })();
    };

    // Called when the active deck's audio ends naturally
    const handleEnded = (slot: 'A' | 'B') => {
      if (active.current !== slot) return;
      const ctx = ctxRef.current;

      // ── Case 1: Crossfade was in progress (both decks already playing) ──────
      if (xfading.current && ctx) {
        const oldActive = slot === 'A' ? a : b;
        swap();
        oldActive.crossGain.gain.cancelScheduledValues(ctx.currentTime);
        oldActive.crossGain.gain.value = 0;
        oldActive.audio.pause();
        xfading.current = false;
        const pinnedIdx = xfadeNextIdx.current;
        xfadeNextIdx.current = null;
        if (pinnedIdx !== null) {
          const { _advanceToIndex } = useAudioPlayer.getState();
          _advanceToIndex(pinnedIdx);
          return;
        }
      }

      // ── Case 2: Gapless preload ready — instant swap, play immediately ──────
      // Calling play() here (inside the ended event handler) keeps the OS audio
      // session alive with no gap, which is what prevents Android from blocking
      // the play() call on the next track.
      if (preloadedRef.current) {
        const oldActive = slot === 'A' ? a : b;
        const idleDeck  = slot === 'A' ? b : a;
        const pinnedIdx = xfadeNextIdx.current;
        xfadeNextIdx.current = null;
        preloadedRef.current = false;

        swap();
        oldActive.crossGain.gain.value = 0;
        oldActive.audio.pause();
        idleDeck.crossGain.gain.value = 1.0;

        // Fire play() immediately WITHOUT waiting for ctx.resume().
        // On iOS in the background, ctx.resume() won't resolve until the app is
        // foregrounded — chaining play() after it is what caused the bug where
        // users had to open the app to start the next song. The silent keep-alive
        // node (above) keeps the AudioContext alive between tracks so play()
        // succeeds in the background on its own.
        //
        // Explicitly re-assert the silent keep-alive here as well. Android Chrome
        // tracks audio focus per-element; if the silent audio somehow paused, this
        // re-starts it before the main play() so Chrome never sees a gap.
        silentAudioRef.current?.play().catch(() => {});
        idleDeck.audio.play().catch(() => {});
        ctx?.resume().catch(() => {}); // best-effort, fire-and-forget

        if (pinnedIdx !== null) {
          const { _advanceToIndex } = useAudioPlayer.getState();
          _advanceToIndex(pinnedIdx);
        } else {
          useAudioPlayer.getState()._trackEnded();
        }
        return;
      }

      // ── Case 3: Repeat-one ───────────────────────────────────────────────────
      const { repeatMode } = useAudioPlayer.getState();
      if (repeatMode === 'one') {
        const actDeck = slot === 'A' ? a : b;
        actDeck.audio.currentTime = 0;
        useAudioPlayer.getState().seek(0);
        ctx?.resume();
        actDeck.audio.play().catch(() => {});
        return;
      }

      // ── Case 4: Fallback (very short track / preload didn't fire in time) ───
      // Proactively resume the context and re-assert the silent keep-alive so
      // Android Chrome doesn't drop audio focus during the async load gap.
      silentAudioRef.current?.play().catch(() => {});
      ctx?.resume().catch(() => {});
      const { _trackEnded } = useAudioPlayer.getState();
      _trackEnded();
    };

    const onTuA = () => {
      if (active.current !== 'A') return;
      const { _setProgress: sp, _setDuration: sd } = useAudioPlayer.getState();
      sp(a.audio.currentTime);
      if (isFinite(a.audio.duration)) sd(a.audio.duration);
      maybeCrossfade(a, b, 'A');
    };
    const onTuB = () => {
      if (active.current !== 'B') return;
      const { _setProgress: sp, _setDuration: sd } = useAudioPlayer.getState();
      sp(b.audio.currentTime);
      if (isFinite(b.audio.duration)) sd(b.audio.duration);
      maybeCrossfade(b, a, 'B');
    };
    const onDcA = () => { if (active.current === 'A' && isFinite(a.audio.duration)) { const { _setDuration: sd } = useAudioPlayer.getState(); sd(a.audio.duration); } };
    const onDcB = () => { if (active.current === 'B' && isFinite(b.audio.duration)) { const { _setDuration: sd } = useAudioPlayer.getState(); sd(b.audio.duration); } };

    // ── YouTube stream URL expiry recovery ────────────────────────────────────
    // YouTube CDN stream URLs expire after ~6 hours. When a deck fires an
    // 'error' event for a YouTube track, we:
    //  1. Confirm the error is network-level (not a decode error).
    //  2. Probe the current CDN URL to confirm it returned 403/410 (expired).
    //  3. Re-fetch a fresh stream URL from /api/yt/stream/:videoId and resume
    //     from the saved position. Each track is retried at most once.
    const ytRetrySet = new Set<number>(); // track IDs that have already been retried

    const handleYtError = async (deck: Deck) => {
      const state = useAudioPlayer.getState();
      const track = state.currentTrack;
      if (!track || track.source !== 'youtube') return;

      // Only attempt recovery for network-level errors — decode errors
      // (MEDIA_ERR_DECODE = 3) are unrelated to URL expiry.
      const errCode = deck.audio.error?.code;
      const errMsg = deck.audio.error?.message ?? '';
      const codeName =
        errCode === MediaError.MEDIA_ERR_ABORTED ? 'ABORTED' :
        errCode === MediaError.MEDIA_ERR_NETWORK ? 'NETWORK' :
        errCode === MediaError.MEDIA_ERR_DECODE ? 'DECODE' :
        errCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? 'SRC_NOT_SUPPORTED' :
        `code=${errCode}`;
      console.error('[AudioEngine] YT <audio> error', { codeName, errCode, errMsg, src: deck.audio.src.slice(0, 120) });

      const isNetworkError =
        errCode === MediaError.MEDIA_ERR_NETWORK ||           // 2
        errCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;   // 4
      if (!isNetworkError) {
        // DECODE / ABORTED — surface to the user so they're not staring at a silent player
        toast({
          title: `Playback error (${codeName})`,
          description: errMsg
            ? errMsg.slice(0, 180)
            : 'The browser could not decode this audio stream. Try another track.',
          duration: 9000,
        });
        return;
      }

      if (ytRetrySet.has(track.id)) return; // already retried once — give up

      // Probe the current CDN URL to confirm it is expired (HTTP 403/410).
      // We use a byte-range GET so the probe is lightweight.
      // - If the server responds with 403 or 410 → URL expired → proceed.
      // - If the server responds with any other success/redirect → not expired → bail.
      // - If the fetch itself throws (CORS / network failure on the probe) → treat
      //   as potential expiry and proceed; worst case we do one unnecessary re-fetch.
      const currentSrc = deck.audio.src;
      if (currentSrc) {
        try {
          const probe = await fetch(currentSrc, {
            method: 'GET',
            headers: { Range: 'bytes=0-0' },
          });
          if (probe.status !== 403 && probe.status !== 410) {
            // Not an expiry error — don't consume the one-shot retry slot.
            return;
          }
        } catch {
          // CORS or network failure on the probe — treat as potential expiry.
        }
      }

      // Mark as retried before the async work to prevent concurrent retries.
      ytRetrySet.add(track.id);

      const videoId = track.fileName;
      const jwt = (() => { try { return localStorage.getItem('playd_token'); } catch { return null; } })();
      const headers: HeadersInit = jwt ? { Authorization: `Bearer ${jwt}` } : {};
      try {
        const resp = await fetch(`/api/yt/stream/${encodeURIComponent(videoId)}`, { headers });
        if (!resp.ok) {
          toast({
            title: 'Stream unavailable',
            description: 'Could not refresh the YouTube stream. Try playing the track again.',
            duration: 7000,
          });
          return;
        }
        const data: { streamUrl?: string } = await resp.json();
        if (!data.streamUrl) {
          toast({
            title: 'Stream unavailable',
            description: 'Could not refresh the YouTube stream. Try playing the track again.',
            duration: 7000,
          });
          return;
        }
        const saved = deck.audio.currentTime;
        const wasPlaying = state.isPlaying;
        deck.audio.src = data.streamUrl;
        deck.audio.load();
        // Wait for canplay so currentTime assignment takes effect reliably.
        // Setting currentTime before media metadata is ready silently no-ops.
        const onReady = () => {
          deck.audio.removeEventListener('canplay', onReady);
          deck.audio.currentTime = saved;
          if (wasPlaying) deck.audio.play().catch(() => {});
        };
        // Clear the retry slot after a successful refresh so that if this same
        // track's refreshed URL also expires in a later session, it can retry again.
        ytRetrySet.delete(track.id);
        deck.audio.addEventListener('canplay', onReady);
      } catch {
        toast({
          title: 'Stream unavailable',
          description: 'Could not refresh the YouTube stream. Try playing the track again.',
          duration: 7000,
        });
      }
    };

    const onErrA = () => { if (active.current === 'A') handleYtError(a); };
    const onErrB = () => { if (active.current === 'B') handleYtError(b); };

    const onEndA = () => handleEnded('A');
    const onEndB = () => handleEnded('B');

    a.audio.addEventListener('timeupdate',     onTuA);
    b.audio.addEventListener('timeupdate',     onTuB);
    a.audio.addEventListener('durationchange', onDcA);
    b.audio.addEventListener('durationchange', onDcB);
    a.audio.addEventListener('ended',          onEndA);
    b.audio.addEventListener('ended',          onEndB);
    a.audio.addEventListener('error',          onErrA);
    b.audio.addEventListener('error',          onErrB);

    return () => {
      a.audio.removeEventListener('timeupdate',     onTuA);
      b.audio.removeEventListener('timeupdate',     onTuB);
      a.audio.removeEventListener('durationchange', onDcA);
      b.audio.removeEventListener('durationchange', onDcB);
      a.audio.removeEventListener('ended',          onEndA);
      b.audio.removeEventListener('ended',          onEndB);
      a.audio.removeEventListener('error',          onErrA);
      b.audio.removeEventListener('error',          onErrB);
    };
  }, []);

  // ── React to store changes ───────────────────────────────────────────────────

  // ── Sleep timer expiry check (every 10 s) ────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const { sleepTimerExpiry, sleepTimerMode, pause: doPause, clearSleepTimer } = useAudioPlayer.getState();
      if (sleepTimerMode !== 'time' || sleepTimerExpiry === null) return;
      if (Date.now() < sleepTimerExpiry) return;

      doPause();
      clearSleepTimer();

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('PLAYD', { body: 'Sleep timer ended — playback stopped.' });
      }
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  // EQ band values
  useEffect(() => {
    filtersRef.current.forEach((f, i) => { f.gain.value = eqBands[i] || 0; });
  }, [eqBands]);

  // ReplayGain gain adjustment
  useEffect(() => {
    const rg = rgGainRef.current;
    if (!rg) return;
    if (replaygainEnabled && currentTrack?.replaygainGain != null) {
      // Convert dB gain to linear multiplier: 10^(dB/20)
      rg.gain.value = Math.pow(10, currentTrack.replaygainGain / 20);
    } else {
      rg.gain.value = 1.0;
    }
  }, [replaygainEnabled, currentTrack]);

  // Track change
  useEffect(() => {
    if (!currentTrack) return;
    const ctx = ctxRef.current;
    if (!ctx) return;

    const activeDeck = getActive();

    // Already preloaded by crossfade on the active deck — only call play() if it
    // is actually paused. On Android Chrome, calling play() on an already-playing
    // MediaElement from a React effect (outside a trusted event handler) is treated
    // as a fresh autoplay request; Chrome gives it ~1 s then kills it. Guarding on
    // .paused prevents that second redundant call entirely.
    if (activeDeck.loadedTrackId === currentTrack.id) {
      if (isPlayingRef.current && activeDeck.audio.paused) {
        ctx.resume().catch(() => {});
        activeDeck.audio.play().catch(() => {});
      }
      return;
    }

    // Normal load: cancel any in-progress crossfade, reset gains, load on active deck
    const doLoad = async () => {
      xfading.current = false;
      preloadedRef.current = false;
      xfadeNextIdx.current = null;

      const idleDeck = getIdle();
      activeDeck.crossGain.gain.cancelScheduledValues(ctx.currentTime);
      activeDeck.crossGain.gain.value = 1.0;
      idleDeck.crossGain.gain.cancelScheduledValues(ctx.currentTime);
      idleDeck.crossGain.gain.value = 0.0;
      idleDeck.audio.pause();

      const ok = await loadDeckFile.current(activeDeck, currentTrack);
      if (!ok) {
        // resolveTrackSrc already showed a specific toast; surface a generic
        // fallback in case it didn't (e.g. unsupported track source).
        console.warn('[AudioEngine] loadDeckFile failed', { id: currentTrack.id, source: currentTrack.source, title: currentTrack.title });
        return;
      }

      const { isPlaying: playing } = useAudioPlayer.getState();
      if (playing) {
        // Fire resume and play together — do NOT await resume before play().
        // On iOS in the background, ctx.resume() returns a Promise that won't
        // resolve until the app is foregrounded. Chaining play() after it means
        // music only starts when the user opens the app. The silent keep-alive
        // MediaElementSourceNode keeps the AudioContext alive between tracks so
        // play() succeeds immediately without waiting for an explicit resume.
        ctx.resume().catch(() => {}); // fire-and-forget
        activeDeck.audio.play().catch((e: Error) => {
          console.warn('Autoplay prevented', e);
          // For vault tracks the decrypt chain is long enough that browsers may
          // expire the user-gesture window. Show a clear prompt so they know
          // exactly what to do — pressing ▶ Play is a fresh gesture that works.
          if (currentTrack.source === 'vault' && e.name === 'NotAllowedError') {
            toast({
              title: 'Tap ▶ Play to start',
              description: 'Vault track decrypted — press the Play button to begin playback.',
              duration: 8000,
            });
          }
        });
      }
    };

    doLoad();
  }, [currentTrack]);

  // Play / Pause
  useEffect(() => {
    const act  = getActive();
    const idle = getIdle();
    if (!act) return;
    if (isPlaying) {
      const ctx = ctxRef.current;
      const doPlay = () => {
        act.audio.play().catch(e => console.warn('Autoplay prevented', e));
        if (xfading.current) idle?.audio.play().catch(() => {});
        silentAudioRef.current?.play().catch(() => {});
      };
      // Call play() immediately. ctx.resume() is fire-and-forget — do NOT chain
      // doPlay() after it. On iOS in the background, resume() never resolves until
      // the app is foregrounded, so any .then(doPlay) silently defers playback.
      ctx?.resume().catch(() => {});
      doPlay();
    } else {
      act.audio.pause();
      idle?.audio.pause();
      silentAudioRef.current?.pause();
    }
    // Tell iOS the audio session state so lock-screen controls match reality.
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying]);

  // Volume & Mute
  useEffect(() => {
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Seek
  useEffect(() => {
    const act = getActive();
    if (!act) return;
    if (Math.abs(act.audio.currentTime - progress) > 1) {
      act.audio.currentTime = progress;
    }
  }, [progress]);

  // ── Stalled-playback detection ────────────────────────────────────────────
  // If a local track is "playing" but progress is still at 0 after 3 seconds,
  // the file handle is likely gone (user needs to re-add the folder).
  const lastWarnedTrackRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isPlaying || !currentTrack || currentTrack.source !== 'local') return;
    // Only warn once per track per session
    if (lastWarnedTrackRef.current === currentTrack.id) return;

    const timerId = setTimeout(() => {
      const state = useAudioPlayer.getState();
      if (
        state.isPlaying &&
        state.progress < 0.5 &&
        state.currentTrack?.id === currentTrack.id
      ) {
        lastWarnedTrackRef.current = currentTrack.id;
        toast({
          title: 'Track not playing?',
          description:
            'The audio file may not be accessible. Open Settings → Library and re-add your music folder to restore playback.',
          duration: 9000,
        });
      }
    }, 3000);

    return () => clearTimeout(timerId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentTrack?.id]);

  return null;
}
