import { useEffect, useRef } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { sharedAnalyserRef } from './AudioEngine';

const BARS = 24;
const BAR_H_PX = 32;
const BAR_COLOR_R = 255;
const BAR_COLOR_G = 60;
const BAR_COLOR_B = 0;

export function SpectrumBar() {
  const { showSpectrum, isPlaying } = useAudioPlayer();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const rafRef       = useRef(0);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // Keep canvas internal resolution in sync with layout size + device pixel ratio
  useEffect(() => {
    if (!showSpectrum) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sync = () => {
      const dpr = window.devicePixelRatio || 1;
      const w   = canvas.offsetWidth;
      const h   = canvas.offsetHeight;
      if (!w || !h) return;
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };

    const ro = new ResizeObserver(sync);
    ro.observe(canvas);
    sync();
    return () => ro.disconnect();
  }, [showSpectrum]);

  // rAF draw loop
  useEffect(() => {
    if (!showSpectrum) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataArray = new Uint8Array(BARS);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return;

      const W = canvas.width;
      const H = canvas.height;
      ctx2d.clearRect(0, 0, W, H);

      const analyser = sharedAnalyserRef.current;
      if (!analyser || !isPlayingRef.current) {
        ctx2d.fillStyle = `rgba(${BAR_COLOR_R},${BAR_COLOR_G},${BAR_COLOR_B},0.12)`;
        ctx2d.fillRect(0, H - 1, W, 1);
        return;
      }

      analyser.getByteFrequencyData(dataArray);

      const barW = W / BARS;
      for (let i = 0; i < BARS; i++) {
        const v     = dataArray[i] / 255;
        const barH  = Math.max(1, v * H);
        const alpha = 0.25 + v * 0.75;
        ctx2d.fillStyle = `rgba(${BAR_COLOR_R},${BAR_COLOR_G},${BAR_COLOR_B},${alpha})`;
        ctx2d.fillRect(i * barW + 0.5, H - barH, Math.max(1, barW - 1), barH);
      }
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [showSpectrum]);

  if (!showSpectrum) return null;

  return (
    <canvas
      ref={canvasRef}
      className="w-full shrink-0 block"
      style={{ height: BAR_H_PX }}
      aria-hidden
    />
  );
}
