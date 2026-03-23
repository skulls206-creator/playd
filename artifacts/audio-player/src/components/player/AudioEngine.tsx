import { useEffect, useRef } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';
import { useNowPlayingNotification } from '@/hooks/use-now-playing-notification';
import type { Track } from '@workspace/api-client-react';

const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// Shared analyser node — read by SpectrumBar
export const sharedAnalyserRef: { current: AnalyserNode | null } = { current: null };

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
  const filtersRef = useRef<BiquadFilterNode[]>([]);

  const {
    currentTrack, isPlaying, volume, isMuted, progress, eqBands, crossfadeSec,
    _setProgress, _setDuration, _trackEnded, play, pause, next, prev,
  } = useAudioPlayer();

  const { getFileFromPath } = useFileSystem();
  useNowPlayingNotification(currentTrack ?? null);

  // Stable refs for values used inside event-listener closures
  const isPlayingRef = useRef(isPlaying);
  const crossfadeSecRef = useRef(crossfadeSec);
  const getFileFromPathRef = useRef(getFileFromPath);
  isPlayingRef.current = isPlaying;
  crossfadeSecRef.current = crossfadeSec;
  getFileFromPathRef.current = getFileFromPath;

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

    // 10-band EQ chain → analyser
    const filters = EQ_FREQS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = freq;
      return f;
    });
    filtersRef.current = filters;
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
    filters[filters.length - 1].connect(analyser);

    // Create one deck with a given initial crossfade gain value
    const makeDeck = (initGain: number): Deck => {
      const audio = new Audio();
      audio.preload = 'auto';
      const source = ctx.createMediaElementSource(audio);
      const crossGain = ctx.createGain();
      crossGain.gain.value = initGain;
      source.connect(crossGain);
      crossGain.connect(filters[0]);
      return { audio, crossGain, loadedTrackId: null, objectUrl: null };
    };

    deckA.current = makeDeck(1.0); // active
    deckB.current = makeDeck(0.0); // idle

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

      let nextIdx = state.queueIndex + 1;
      if (state.isShuffle) nextIdx = Math.floor(Math.random() * state.queue.length);
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

  // EQ band values
  useEffect(() => {
    filtersRef.current.forEach((f, i) => { f.gain.value = eqBands[i] || 0; });
  }, [eqBands]);

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
    } else {
      act.audio.pause();
      idle?.audio.pause();
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

  return null;
}
