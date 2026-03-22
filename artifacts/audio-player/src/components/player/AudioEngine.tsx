import { useEffect, useRef, useState } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';

const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export function AudioEngine() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const filtersRef = useRef<BiquadFilterNode[]>([]);
  const gainRef = useRef<GainNode | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const { 
    currentTrack, 
    isPlaying, 
    volume, 
    isMuted, 
    progress, 
    eqBands,
    _setProgress, 
    _setDuration, 
    _trackEnded,
    play,
    pause,
    next,
    prev
  } = useAudioPlayer();

  const { getFileFromPath } = useFileSystem();

  // Initialize Web Audio API
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      contextRef.current = ctx;
      
      const source = ctx.createMediaElementSource(audioRef.current);
      sourceRef.current = source;
      
      const gain = ctx.createGain();
      gainRef.current = gain;
      
      // Create 10-band EQ
      let prevNode: AudioNode = source;
      filtersRef.current = FREQUENCIES.map((freq, i) => {
        const filter = ctx.createBiquadFilter();
        filter.type = i === 0 ? 'lowshelf' : i === FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
        filter.frequency.value = freq;
        prevNode.connect(filter);
        prevNode = filter;
        return filter;
      });
      
      prevNode.connect(gain);
      gain.connect(ctx.destination);

      // Media Session Handlers
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => play());
        navigator.mediaSession.setActionHandler('pause', () => pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => prev());
        navigator.mediaSession.setActionHandler('nexttrack', () => next());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.fastSeek && 'fastSeek' in audioRef.current!) {
            audioRef.current.fastSeek(details.seekTime || 0);
          } else {
            audioRef.current!.currentTime = details.seekTime || 0;
          }
        });
      }
    }

    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  // Update EQ
  useEffect(() => {
    filtersRef.current.forEach((filter, i) => {
      filter.gain.value = eqBands[i] || 0;
    });
  }, [eqBands]);

  // Handle Track Source Changes
  useEffect(() => {
    const loadTrack = async () => {
      if (!currentTrack || !audioRef.current) return;
      
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }

      let src = '';
      if (currentTrack.source === 'local') {
        const file = await getFileFromPath(currentTrack.fileName, currentTrack.folderPath);
        if (file) {
          src = URL.createObjectURL(file);
          objectUrlRef.current = src;
        } else {
          console.error("Could not read local file (needs permission grant?)");
          return;
        }
      } else if (currentTrack.source === 'subsonic') {
        // Construct subsonic stream URL
        // Requires user credentials which we'd normally pull from settings
        src = `${currentTrack.folderPath}/rest/stream?id=${currentTrack.subsonicId}&v=1.16.1&c=web`; 
      }

      if (src) {
        audioRef.current.src = src;
        if (isPlaying) {
          contextRef.current?.resume();
          audioRef.current.play().catch(e => console.warn('Autoplay prevented', e));
        }
      }
    };

    loadTrack();
  }, [currentTrack]);

  // Play/Pause Control
  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      contextRef.current?.resume();
      audioRef.current.play().catch(e => console.warn('Autoplay prevented', e));
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  // Volume & Mute
  useEffect(() => {
    if (gainRef.current) {
      gainRef.current.gain.value = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Seek Control from external state
  useEffect(() => {
    if (!audioRef.current) return;
    // Only update if difference is > 1s to prevent fighting with internal timeupdate
    if (Math.abs(audioRef.current.currentTime - progress) > 1) {
      audioRef.current.currentTime = progress;
    }
  }, [progress]);

  // Native Audio Events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => _setProgress(audio.currentTime);
    const onDurationChange = () => _setDuration(audio.duration);
    const onEnded = () => _trackEnded();

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  return null; // Headless component
}
