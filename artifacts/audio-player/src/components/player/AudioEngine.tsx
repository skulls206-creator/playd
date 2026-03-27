import { useEffect, useRef } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';
import { useNowPlayingNotification } from '@/hooks/use-now-playing-notification';
import { useToast } from '@/hooks/use-toast';
import type { Track } from '@workspace/api-client-react';
import { requestVaultKey, decryptVaultBlob } from '@/hooks/use-vault-crypto';

const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// Shared analyser node — read by SpectrumBar
export const sharedAnalyserRef: { current: AnalyserNode | null } = { current: null };

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

  // Resolve a playable URL for any track source
  const resolveTrackSrc = useRef(async (track: Track): Promise<string | null> => {
    if (track.source === 'local') {
      const file = await getFileFromPathRef.current(track.fileName, track.folderPath);
      if (!file) { console.error('Cannot access local file'); return null; }
      return URL.createObjectURL(file);
    }

    if (track.source === 'subsonic' && track.subsonicServerId && track.subsonicId) {
      // Audio elements cannot set custom headers, so we embed the JWT token as a
      // query param. The API's requireAuth middleware accepts ?token= on GET requests.
      const jwt = (() => { try { return localStorage.getItem('playd_token'); } catch { return null; } })();
      const qs = jwt ? `?token=${encodeURIComponent(jwt)}` : '';
      return `/api/subsonic-servers/${track.subsonicServerId}/stream/${encodeURIComponent(track.subsonicId)}${qs}`;
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

    // Silent audio keep-alive: a 1-sample WAV looping natively (NOT in the Web
    // Audio graph). iOS keeps the audio session alive as long as a native <audio>
    // element is playing, which lets the AudioContext stay running while the
    // screen is locked. Volume is 0 so the user hears nothing extra.
    const silent = new Audio(SILENT_WAV_URI);
    silent.loop   = true;
    silent.volume = 0;
    silent.style.cssText = 'position:absolute;width:0;height:0;left:-9999px;top:-9999px;pointer-events:none';
    silent.setAttribute('aria-hidden', 'true');
    document.body.appendChild(silent);
    silentAudioRef.current = silent;

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

    // Start crossfade when the active deck is close to ending
    const maybeCrossfade = (myDeck: Deck, otherDeck: Deck, slot: 'A' | 'B') => {
      if (active.current !== slot) return;
      if (xfading.current) return;
      const secs = crossfadeSecRef.current;
      if (secs <= 0) return;

      const remaining = myDeck.audio.duration - myDeck.audio.currentTime;
      // Non-finite duration (live streams, some formats): skip crossfade silently
      if (!isFinite(remaining) || remaining > secs || remaining <= 0) return;

      // Peek at the next track without advancing the queue
      const state = useAudioPlayer.getState();

      // Crossfade doesn't make sense in repeat-one mode (next track = same track)
      if (state.repeatMode === 'one') return;

      // End-of-track sleep timer: let the track finish naturally so _trackEnded fires
      if (state.sleepTimerMode === 'track') return;

      let nextIdx = state.queueIndex + 1;
      if (state.isShuffle) {
        // Avoid re-picking the track currently playing
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

      // Pin the chosen index so handleEnded uses the exact same track
      xfadeNextIdx.current = nextIdx;
      xfading.current = true;
      const ctx = ctxRef.current!;
      // Use the full configured crossfade duration for the ramp.
      // If timeupdate fired a little late (remaining < crossfadeSec), the ramp still
      // plays for the full duration — the old track ends naturally, handleEnded cancels
      // its gain and pauses it, while the new track continues fading in to 1.
      const fadeDur = crossfadeSecRef.current;

      // Fire-and-forget async preload + ramp
      (async () => {
        const ok = await loadDeckFile.current(otherDeck, nextTrack);
        if (!ok || !xfading.current) { xfading.current = false; return; }

        // Start idle deck at gain 0, ramp to 1 over the full crossfade duration
        otherDeck.crossGain.gain.cancelScheduledValues(ctx.currentTime);
        otherDeck.crossGain.gain.setValueAtTime(0, ctx.currentTime);
        otherDeck.crossGain.gain.linearRampToValueAtTime(1, ctx.currentTime + fadeDur);
        ctx.resume();
        otherDeck.audio.play().catch(() => {});

        // Ramp active deck from its current value down to 0
        myDeck.crossGain.gain.cancelScheduledValues(ctx.currentTime);
        myDeck.crossGain.gain.setValueAtTime(myDeck.crossGain.gain.value, ctx.currentTime);
        myDeck.crossGain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeDur);
      })();
    };

    // Called when the active deck's audio ends naturally
    const handleEnded = (slot: 'A' | 'B') => {
      if (active.current !== slot) return;
      const ctx = ctxRef.current;

      if (xfading.current && ctx) {
        const oldActive = slot === 'A' ? a : b;
        swap();
        oldActive.crossGain.gain.cancelScheduledValues(ctx.currentTime);
        oldActive.crossGain.gain.value = 0;
        oldActive.audio.pause();
        xfading.current = false;

        // Use the exact same index that was peeked at crossfade start —
        // prevents re-randomisation in shuffle mode.
        const pinnedIdx = xfadeNextIdx.current;
        xfadeNextIdx.current = null;
        if (pinnedIdx !== null) {
          const { _advanceToIndex } = useAudioPlayer.getState();
          _advanceToIndex(pinnedIdx);
          return;
        }
      }

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
    const onEndA = () => handleEnded('A');
    const onEndB = () => handleEnded('B');

    a.audio.addEventListener('timeupdate',     onTuA);
    b.audio.addEventListener('timeupdate',     onTuB);
    a.audio.addEventListener('durationchange', onDcA);
    b.audio.addEventListener('durationchange', onDcB);
    a.audio.addEventListener('ended',          onEndA);
    b.audio.addEventListener('ended',          onEndB);

    return () => {
      a.audio.removeEventListener('timeupdate',     onTuA);
      b.audio.removeEventListener('timeupdate',     onTuB);
      a.audio.removeEventListener('durationchange', onDcA);
      b.audio.removeEventListener('durationchange', onDcB);
      a.audio.removeEventListener('ended',          onEndA);
      b.audio.removeEventListener('ended',          onEndB);
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
        new Notification('playd', { body: 'Sleep timer ended — playback stopped.' });
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

    // Already preloaded by crossfade on the active deck — just ensure it's playing
    if (activeDeck.loadedTrackId === currentTrack.id) {
      if (isPlayingRef.current) {
        ctx.resume();
        activeDeck.audio.play().catch(() => {});
      }
      return;
    }

    // Normal load: cancel any in-progress crossfade, reset gains, load on active deck
    const doLoad = async () => {
      if (xfading.current) {
        xfading.current = false;
      }

      const idleDeck = getIdle();
      activeDeck.crossGain.gain.cancelScheduledValues(ctx.currentTime);
      activeDeck.crossGain.gain.value = 1.0;
      idleDeck.crossGain.gain.cancelScheduledValues(ctx.currentTime);
      idleDeck.crossGain.gain.value = 0.0;
      idleDeck.audio.pause();

      const ok = await loadDeckFile.current(activeDeck, currentTrack);
      if (!ok) return;

      const { isPlaying: playing } = useAudioPlayer.getState();
      if (playing) {
        ctx.resume();
        activeDeck.audio.play().catch(e => console.warn('Autoplay prevented', e));
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
      ctxRef.current?.resume();
      act.audio.play().catch(e => console.warn('Autoplay prevented', e));
      if (xfading.current) idle?.audio.play().catch(() => {});
      // Keep iOS audio session alive so the AudioContext is never suspended by the OS.
      silentAudioRef.current?.play().catch(() => {});
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
