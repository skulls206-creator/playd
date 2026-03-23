import { useRef, useEffect, useCallback } from 'react';

interface WaveformCanvasProps {
  /** Downsampled peaks: [min0,max0, min1,max1, ...] per display column. */
  peaks: Float32Array | null;
  /** Full duration of the working buffer in seconds. */
  duration: number;
  trimStart: number;
  trimEnd: number;
  /** Fade-in duration in seconds (0 = none). */
  fadeIn: number;
  /** Fade-out duration in seconds (0 = none). */
  fadeOut: number;
  /** Current playhead position in seconds (NaN when not playing). */
  playhead: number;
  onTrimChange: (start: number, end: number) => void;
}

const ACCENT    = '#FF3C00';
const ACCENT_DIM = 'rgba(255,60,0,0.22)';
const FADE_CLR  = 'rgba(0,180,255,0.28)';
const HANDLE_HIT = 14; // px hit-target radius for trim handles

export function WaveformCanvas({
  peaks, duration, trimStart, trimEnd,
  fadeIn, fadeOut, playhead, onTrimChange,
}: WaveformCanvasProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  // Keep latest values in a ref so event handlers don't capture stale closures
  const live = useRef({ trimStart, trimEnd, duration });
  live.current = { trimStart, trimEnd, duration };

  // ── Drawing ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W   = canvas.width;
    const H   = canvas.height;
    const mid = H / 2;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, W, H);

    if (!peaks || duration <= 0) {
      // Empty state — just show a centre line
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
      return;
    }

    const steps      = peaks.length / 2;
    const tsX        = (trimStart / duration) * W;
    const teX        = (trimEnd   / duration) * W;

    // ── Waveform bars ────────────────────────────────────────────────────────
    for (let i = 0; i < steps; i++) {
      const x   = (i / steps) * W;
      const mn  = peaks[i * 2];
      const mx  = peaks[i * 2 + 1];
      const y0  = mid - mx * mid * 0.92;
      const y1  = mid - mn * mid * 0.92;
      const bW  = Math.max(1, (W / steps) - 0.5);

      const inTrim = x >= tsX && x <= teX;
      ctx.fillStyle = inTrim ? ACCENT : ACCENT_DIM;
      ctx.fillRect(x, y0, bW, Math.max(1, y1 - y0));
    }

    // ── Outside-trim dim overlay ─────────────────────────────────────────────
    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    if (tsX > 0)    ctx.fillRect(0, 0, tsX, H);
    if (teX < W)    ctx.fillRect(teX, 0, W - teX, H);

    // ── Fade-in blue gradient ────────────────────────────────────────────────
    if (fadeIn > 0) {
      const fiX  = Math.min(teX, (fadeIn / duration) * W);
      const grad = ctx.createLinearGradient(tsX, 0, tsX + fiX - tsX, 0);
      grad.addColorStop(0, FADE_CLR);
      grad.addColorStop(1, 'rgba(0,180,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(tsX, 0, fiX - tsX, H);
    }

    // ── Fade-out blue gradient ───────────────────────────────────────────────
    if (fadeOut > 0) {
      const foStart = Math.max(tsX, teX - (fadeOut / duration) * W);
      const grad    = ctx.createLinearGradient(foStart, 0, teX, 0);
      grad.addColorStop(0, 'rgba(0,180,255,0)');
      grad.addColorStop(1, FADE_CLR);
      ctx.fillStyle = grad;
      ctx.fillRect(foStart, 0, teX - foStart, H);
    }

    // ── Centre line ──────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();

    // ── Trim handle lines ────────────────────────────────────────────────────
    const drawHandle = (x: number) => {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth   = 2;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      // Small triangle marker at top
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.moveTo(x - 6, 0);
      ctx.lineTo(x + 6, 0);
      ctx.lineTo(x, 10);
      ctx.closePath();
      ctx.fill();
    };
    drawHandle(tsX);
    drawHandle(teX);

    // ── Playhead ─────────────────────────────────────────────────────────────
    if (!isNaN(playhead) && playhead >= 0) {
      const px = (playhead / duration) * W;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [peaks, trimStart, trimEnd, fadeIn, fadeOut, playhead, duration]);

  // ── Drag interaction ───────────────────────────────────────────────────────
  type DragType = 'start' | 'end' | 'new';
  const drag = useRef<{ type: DragType; anchor: number } | null>(null);

  const clientXToTime = useCallback((clientX: number): number => {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    const relX   = (clientX - rect.left) * (canvas.width / rect.width);
    const { duration: dur } = live.current;
    return Math.max(0, Math.min(dur, (relX / canvas.width) * dur));
  }, []);

  const clientXToCanvasX = useCallback((clientX: number): number => {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    return (clientX - rect.left) * (canvas.width / rect.width);
  }, []);

  const timeToCanvasX = useCallback((t: number): number => {
    const canvas = canvasRef.current!;
    return (t / live.current.duration) * canvas.width;
  }, []);

  const onPointerDown = useCallback((clientX: number) => {
    const cx  = clientXToCanvasX(clientX);
    const sx  = timeToCanvasX(live.current.trimStart);
    const ex  = timeToCanvasX(live.current.trimEnd);

    if (Math.abs(cx - sx) <= HANDLE_HIT) {
      drag.current = { type: 'start', anchor: clientX };
    } else if (Math.abs(cx - ex) <= HANDLE_HIT) {
      drag.current = { type: 'end', anchor: clientX };
    } else {
      const t = clientXToTime(clientX);
      drag.current = { type: 'new', anchor: clientX };
      onTrimChange(t, Math.min(t + 0.001, live.current.duration));
    }
  }, [clientXToCanvasX, clientXToTime, timeToCanvasX, onTrimChange]);

  const onPointerMove = useCallback((clientX: number) => {
    if (!drag.current) return;
    const t  = clientXToTime(clientX);
    const { trimStart: ts, trimEnd: te, duration: dur } = live.current;

    if (drag.current.type === 'start') {
      onTrimChange(Math.max(0, Math.min(t, te - 0.05)), te);
    } else if (drag.current.type === 'end') {
      onTrimChange(ts, Math.min(dur, Math.max(t, ts + 0.05)));
    } else {
      // new selection: anchor sets one side, pointer sets the other
      const anchorT = clientXToTime(drag.current.anchor);
      const lo = Math.min(anchorT, t);
      const hi = Math.max(anchorT, t);
      onTrimChange(Math.max(0, lo), Math.min(dur, Math.max(hi, lo + 0.05)));
    }
  }, [clientXToTime, onTrimChange]);

  const onPointerUp = useCallback(() => { drag.current = null; }, []);

  // Mouse events
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => { e.preventDefault(); onPointerDown(e.clientX); };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => onPointerMove(e.clientX);

  // Touch events (single touch only)
  const onTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => { e.preventDefault(); if (e.touches[0]) onPointerDown(e.touches[0].clientX); };
  const onTouchMove  = (e: React.TouchEvent<HTMLCanvasElement>) => { e.preventDefault(); if (e.touches[0]) onPointerMove(e.touches[0].clientX); };

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={160}
      className="w-full rounded-sm cursor-col-resize touch-none select-none block"
      style={{ height: 160, background: '#0d0d0d' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onPointerUp}
      onMouseLeave={onPointerUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onPointerUp}
    />
  );
}
