import { useEffect, useRef } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { sharedAnalyserRef } from './AudioEngine';

const BARS = 32;
const BAR_COLOR_R = 255;
const BAR_COLOR_G = 60;
const BAR_COLOR_B = 0;

export function SpectrumBar() {
  const { showSpectrum, isPlaying } = useAudioPlayer();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef(0);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    if (!showSpectrum) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataArray = new Uint8Array(BARS);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const analyser = sharedAnalyserRef.current;
      if (!analyser || !isPlayingRef.current) {
        // Flat baseline when silent/paused
        ctx.fillStyle = `rgba(${BAR_COLOR_R},${BAR_COLOR_G},${BAR_COLOR_B},0.12)`;
        ctx.fillRect(0, H - 1, W, 1);
        return;
      }

      analyser.getByteFrequencyData(dataArray);

      const barW = W / BARS;
      for (let i = 0; i < BARS; i++) {
        const v     = dataArray[i] / 255;
        const barH  = Math.max(1, v * H);
        const alpha = 0.25 + v * 0.75;
        ctx.fillStyle = `rgba(${BAR_COLOR_R},${BAR_COLOR_G},${BAR_COLOR_B},${alpha})`;
        ctx.fillRect(i * barW + 0.5, H - barH, Math.max(1, barW - 1), barH);
      }
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [showSpectrum]);

  if (!showSpectrum) return null;

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={32}
      className="w-full shrink-0 block"
      style={{ height: 32, imageRendering: 'pixelated' }}
      aria-hidden
    />
  );
}
