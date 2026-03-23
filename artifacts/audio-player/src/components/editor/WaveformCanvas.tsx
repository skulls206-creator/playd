import { useRef, useEffect, useCallback } from 'react';

interface WaveformCanvasProps {
  /**
   * Downsampled peaks for the CURRENT VIEW RANGE only.
   * Format: [min0,max0, min1,max1, ...] — one pair per display column.
   */
  peaks: Float32Array | null;
  /** Full working-buffer duration in seconds. */
  duration: number;
  /** View window start in seconds (0 when not zoomed). */
  viewStart: number;
  /** View window end in seconds (= duration when not zoomed). */
  viewEnd: number;
  trimStart: number;
  trimEnd: number;
  /** Fade-in duration in seconds (0 = none). Relative to buffer start. */
  fadeIn: number;
  /** Fade-out duration in seconds (0 = none). Relative to buffer end. */
  fadeOut: number;
  /** Current playhead in seconds (NaN = not playing). */
  playhead: number;
  onTrimChange: (start: number, end: number) => void;
  /** Called when the user zooms or scrolls — new view window in seconds. */
  onViewChange: (start: number, end: number) => void;
}

const ACCENT     = '#FF3C00';
const ACCENT_DIM = 'rgba(255,60,0,0.22)';
const FADE_CLR   = 'rgba(0,180,255,0.28)';
const HANDLE_HIT = 14; // px hit-target radius for trim handles

export function WaveformCanvas({
  peaks, duration, viewStart, viewEnd,
  trimStart, trimEnd, fadeIn, fadeOut,
  playhead, onTrimChange, onViewChange,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Keep mutable snapshot for event-handler closures
  const live = useRef({ trimStart, trimEnd, duration, viewStart, viewEnd });
  live.current = { trimStart, trimEnd, duration, viewStart, viewEnd };

  const isZoomed = viewEnd - viewStart < duration - 0.001;

  // ── Canvas coordinate helpers ──────────────────────────────────────────────
  // Map an absolute buffer time to a canvas X pixel
  const timeToCanvasX = (t: number, W: number): number => {
    const { viewStart: vs, viewEnd: ve } = live.current;
    const range = ve - vs;
    if (range <= 0) return 0;
    return ((t - vs) / range) * W;
  };

  // Map a canvas X pixel to absolute buffer time
  const canvasXToTime = (cx: number, W: number): number => {
    const { viewStart: vs, viewEnd: ve, duration: dur } = live.current;
    const range = ve - vs;
    return Math.max(0, Math.min(dur, vs + (cx / W) * range));
  };

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

    if (!peaks || duration <= 0 || viewEnd <= viewStart) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
      return;
    }

    const steps = peaks.length / 2;
    const tsX   = Math.max(0, Math.min(W, timeToCanvasX(trimStart, W)));
    const teX   = Math.max(0, Math.min(W, timeToCanvasX(trimEnd,   W)));

    // ── Waveform bars ───────────────────────────────────────────────────────
    for (let i = 0; i < steps; i++) {
      const x  = (i / steps) * W;
      const mn = peaks[i * 2];
      const mx = peaks[i * 2 + 1];
      const y0 = mid - mx * mid * 0.92;
      const y1 = mid - mn * mid * 0.92;
      const bW = Math.max(1, (W / steps) - 0.5);

      const inTrim = x >= tsX && x <= teX;
      ctx.fillStyle = inTrim ? ACCENT : ACCENT_DIM;
      ctx.fillRect(x, y0, bW, Math.max(1, y1 - y0));
    }

    // ── Outside-trim dim overlay ────────────────────────────────────────────
    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    if (tsX > 0) ctx.fillRect(0, 0, tsX, H);
    if (teX < W) ctx.fillRect(teX, 0, W - teX, H);

    // ── Fade-in blue gradient ───────────────────────────────────────────────
    if (fadeIn > 0) {
      const fiStart = Math.max(0, timeToCanvasX(0, W));
      const fiEnd   = Math.max(fiStart, Math.min(teX, timeToCanvasX(fadeIn, W)));
      if (fiEnd > fiStart) {
        const grad = ctx.createLinearGradient(fiStart, 0, fiEnd, 0);
        grad.addColorStop(0, FADE_CLR);
        grad.addColorStop(1, 'rgba(0,180,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(fiStart, 0, fiEnd - fiStart, H);
      }
    }

    // ── Fade-out blue gradient ──────────────────────────────────────────────
    if (fadeOut > 0) {
      const foStart = Math.max(tsX, Math.max(0, timeToCanvasX(duration - fadeOut, W)));
      const foEnd   = Math.min(W, timeToCanvasX(duration, W));
      if (foEnd > foStart) {
        const grad = ctx.createLinearGradient(foStart, 0, foEnd, 0);
        grad.addColorStop(0, 'rgba(0,180,255,0)');
        grad.addColorStop(1, FADE_CLR);
        ctx.fillStyle = grad;
        ctx.fillRect(foStart, 0, foEnd - foStart, H);
      }
    }

    // ── Centre line ─────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();

    // ── Trim handle lines ───────────────────────────────────────────────────
    const drawHandle = (x: number) => {
      if (x < -HANDLE_HIT || x > W + HANDLE_HIT) return; // off-screen
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth   = 2;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
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

    // ── Playhead ────────────────────────────────────────────────────────────
    if (!isNaN(playhead) && playhead >= 0) {
      const px = timeToCanvasX(playhead, W);
      if (px >= 0 && px <= W) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ── Zoom indicator label ────────────────────────────────────────────────
    if (isZoomed) {
      const viewRange = viewEnd - viewStart;
      const ratio     = (duration / viewRange).toFixed(1);
      ctx.fillStyle   = 'rgba(255,255,255,0.25)';
      ctx.font        = '10px monospace';
      ctx.textAlign   = 'right';
      ctx.fillText(`${ratio}×`, W - 6, 14);
      ctx.textAlign   = 'left';
    }
  }, [peaks, trimStart, trimEnd, fadeIn, fadeOut, playhead, duration, viewStart, viewEnd, isZoomed]);

  // ── Drag-to-trim interaction ───────────────────────────────────────────────
  type DragType = 'start' | 'end' | 'new';
  const trimDrag = useRef<{ type: DragType; anchorX: number } | null>(null);

  const getCanvasX = useCallback((clientX: number): number => {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    return (clientX - rect.left) * (canvas.width / rect.width);
  }, []);

  const pointerDown = useCallback((clientX: number) => {
    const canvas = canvasRef.current!;
    const cx  = getCanvasX(clientX);
    const W   = canvas.width;
    const sx  = timeToCanvasX(live.current.trimStart, W);
    const ex  = timeToCanvasX(live.current.trimEnd, W);

    if (Math.abs(cx - sx) <= HANDLE_HIT) {
      trimDrag.current = { type: 'start', anchorX: cx };
    } else if (Math.abs(cx - ex) <= HANDLE_HIT) {
      trimDrag.current = { type: 'end', anchorX: cx };
    } else {
      const t = canvasXToTime(cx, W);
      trimDrag.current = { type: 'new', anchorX: cx };
      onTrimChange(t, Math.min(t + 0.001, live.current.duration));
    }
  }, [getCanvasX, onTrimChange]);

  const pointerMove = useCallback((clientX: number) => {
    if (!trimDrag.current) return;
    const canvas = canvasRef.current!;
    const cx  = getCanvasX(clientX);
    const t   = canvasXToTime(cx, canvas.width);
    const { trimStart: ts, trimEnd: te, duration: dur } = live.current;

    if (trimDrag.current.type === 'start') {
      onTrimChange(Math.max(0, Math.min(t, te - 0.05)), te);
    } else if (trimDrag.current.type === 'end') {
      onTrimChange(ts, Math.min(dur, Math.max(t, ts + 0.05)));
    } else {
      const anchorT = canvasXToTime(trimDrag.current.anchorX, canvas.width);
      const lo = Math.min(anchorT, t);
      const hi = Math.max(anchorT, t);
      onTrimChange(Math.max(0, lo), Math.min(dur, Math.max(hi, lo + 0.05)));
    }
  }, [getCanvasX, onTrimChange]);

  const pointerUp = useCallback(() => { trimDrag.current = null; }, []);

  // ── Scroll-wheel zoom ─────────────────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current!;
    const { duration: dur, viewStart: vs, viewEnd: ve } = live.current;
    if (dur <= 0) return;

    const cx       = getCanvasX(e.clientX);
    const centerT  = canvasXToTime(cx, canvas.width);
    const viewRange = ve - vs;
    const MIN_RANGE = Math.max(0.5, dur * 0.02); // minimum 2% of duration or 0.5s
    const zoomFactor = e.deltaY < 0 ? 0.7 : 1.0 / 0.7; // zoom in vs out

    const newRange  = Math.min(dur, Math.max(MIN_RANGE, viewRange * zoomFactor));
    const ratio     = (centerT - vs) / viewRange;
    let   newStart  = centerT - ratio * newRange;
    let   newEnd    = newStart + newRange;

    if (newStart < 0) { newStart = 0; newEnd = Math.min(dur, newRange); }
    if (newEnd > dur) { newEnd = dur; newStart = Math.max(0, dur - newRange); }

    onViewChange(newStart, newEnd);
  }, [getCanvasX, onViewChange]);

  // ── Scrollbar drag ────────────────────────────────────────────────────────
  const scrollDrag = useRef<{ startX: number; startVs: number; startVe: number } | null>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);

  const onScrollbarPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrollDrag.current = {
      startX:  e.clientX,
      startVs: live.current.viewStart,
      startVe: live.current.viewEnd,
    };
  }, []);

  const onScrollbarPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrollDrag.current) return;
    const bar = scrollbarRef.current;
    if (!bar) return;
    const barW      = bar.clientWidth;
    const { duration: dur } = live.current;
    const dx        = e.clientX - scrollDrag.current.startX;
    const dtSec     = (dx / barW) * dur;
    const rangeLen  = scrollDrag.current.startVe - scrollDrag.current.startVs;
    let   newStart  = scrollDrag.current.startVs + dtSec;
    newStart = Math.max(0, Math.min(dur - rangeLen, newStart));
    onViewChange(newStart, newStart + rangeLen);
  }, [onViewChange]);

  const onScrollbarPointerUp = useCallback(() => { scrollDrag.current = null; }, []);

  // Mouse/touch event wiring
  const onMouseDown  = (e: React.MouseEvent<HTMLCanvasElement>)  => { e.preventDefault(); pointerDown(e.clientX); };
  const onMouseMove  = (e: React.MouseEvent<HTMLCanvasElement>)  => pointerMove(e.clientX);
  const onTouchStart = (e: React.TouchEvent<HTMLCanvasElement>)  => { e.preventDefault(); if (e.touches[0]) pointerDown(e.touches[0].clientX); };
  const onTouchMove  = (e: React.TouchEvent<HTMLCanvasElement>)  => { e.preventDefault(); if (e.touches[0]) pointerMove(e.touches[0].clientX); };

  // Scrollbar thumb geometry
  const thumbLeft  = duration > 0 ? (viewStart / duration) * 100 : 0;
  const thumbWidth = duration > 0 ? ((viewEnd - viewStart) / duration) * 100 : 100;

  return (
    <div className="flex flex-col">
      <canvas
        ref={canvasRef}
        width={800}
        height={160}
        className="w-full rounded-sm cursor-col-resize touch-none select-none block"
        style={{ height: 160, background: '#0d0d0d' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={pointerUp}
        onMouseLeave={pointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={pointerUp}
        onWheel={onWheel}
      />

      {/* ── Scrollbar (visible when zoomed) ── */}
      <div
        ref={scrollbarRef}
        className="relative h-2 mt-0.5 rounded-full bg-white/5 overflow-hidden"
        style={{ visibility: isZoomed ? 'visible' : 'hidden' }}
      >
        <div
          className="absolute top-0 h-full rounded-full bg-white/20 hover:bg-white/35 cursor-grab active:cursor-grabbing transition-colors"
          style={{ left: `${thumbLeft}%`, width: `${thumbWidth}%` }}
          onPointerDown={onScrollbarPointerDown}
          onPointerMove={onScrollbarPointerMove}
          onPointerUp={onScrollbarPointerUp}
        />
      </div>
    </div>
  );
}
