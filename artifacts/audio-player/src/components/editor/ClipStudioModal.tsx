/**
 * Clip Studio — offline audio editor for local tracks.
 *
 * Power Pack features:
 *  - Undo / Redo stack (up to MAX_UNDO levels), Ctrl+Z / Ctrl+Shift+Z
 *  - Waveform zoom (scroll wheel / pinch) + scrollbar
 *  - Auto-silence trim (snaps in/out handles to audible region)
 *  - Speed × pitch preview controls + "Bake" to OfflineAudioContext
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { LocalTrack } from '@/lib/track-store';
import { WaveformCanvas } from './WaveformCanvas';
import { encodeWav } from '@/lib/wav-encoder';
import {
  copyBuffer,
  trimBuffer,
  applyFadeIn,
  applyFadeOut,
  normalizePeak,
  computeWaveformPeaksInRange,
  detectSilence,
} from '@/lib/audio-editor';
import { useFileSystem } from '@/hooks/use-file-system';
import {
  ArrowLeft, Play, Square, RotateCcw,
  Download, Save, Scissors, Wand2, Loader2,
  Volume2, ChevronRight, Undo2, Redo2,
  Zap, Gauge,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { clsx } from 'clsx';

// ── Constants ─────────────────────────────────────────────────────────────────

const WAVEFORM_STEPS = 800;
const MAX_UNDO       = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(sec: number): string {
  if (!isFinite(sec)) return '0:00.000';
  const m  = Math.floor(sec / 60);
  const s  = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// ── Undo/Redo entry ───────────────────────────────────────────────────────────

interface HistoryEntry {
  buffer:    AudioBuffer;
  trimStart: number;
  trimEnd:   number;
  fadeIn:    number;
  fadeOut:   number;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ClipStudioModalProps {
  track:   LocalTrack;
  onClose: () => void;
}

export function ClipStudioModal({ track, onClose }: ClipStudioModalProps) {
  const { getFileFromPath, getFileHandleFromPath } = useFileSystem();

  // ── Core audio state ──────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [peaks,     setPeaks]     = useState<Float32Array | null>(null);
  const [duration,  setDuration]  = useState(0);

  // ── Trim selection ────────────────────────────────────────────────────────
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd,   setTrimEnd]   = useState(0);

  // ── Fade amounts ──────────────────────────────────────────────────────────
  const [fadeIn,  setFadeIn]  = useState(0);
  const [fadeOut, setFadeOut] = useState(0);

  // ── Zoom / view window ────────────────────────────────────────────────────
  const [viewStart, _setViewStart] = useState(0);
  const [viewEnd,   _setViewEnd]   = useState(0);
  const viewStartRef = useRef(0);
  const viewEndRef   = useRef(0);

  const setViewRange = useCallback((start: number, end: number) => {
    viewStartRef.current = start;
    viewEndRef.current   = end;
    _setViewStart(start);
    _setViewEnd(end);
  }, []);

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const undoStackRef = useRef<HistoryEntry[]>([]);
  const redoStackRef = useRef<HistoryEntry[]>([]);

  // ── Playback ──────────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead,  setPlayhead]  = useState(NaN);

  // ── Speed / Pitch ─────────────────────────────────────────────────────────
  const [previewRate,   setPreviewRate]   = useState(1.0);
  const [previewDetune, setPreviewDetune] = useState(0);
  const [isBaking,      setIsBaking]      = useState(false);
  const previewRateRef   = useRef(1.0);
  const previewDetuneRef = useRef(0);

  // Keep refs in sync with state
  previewRateRef.current   = previewRate;
  previewDetuneRef.current = previewDetune;

  // ── Status / Save ─────────────────────────────────────────────────────────
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving,   setIsSaving]   = useState(false);
  const [statusMsg,  setStatusMsg]  = useState<{ text: string; ok: boolean } | null>(null);

  // ── Audio refs ────────────────────────────────────────────────────────────
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const originalBufferRef = useRef<AudioBuffer | null>(null);
  const workingBufferRef  = useRef<AudioBuffer | null>(null);
  const sourceNodeRef     = useRef<AudioBufferSourceNode | null>(null);
  const playStartRef      = useRef(0);
  const playOffsetRef     = useRef(0);
  const rafRef            = useRef(0);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const showStatus = useCallback((text: string, ok = true, ms = 3000) => {
    setStatusMsg({ text, ok });
    setTimeout(() => setStatusMsg(null), ms);
  }, []);

  // Recompute peaks for the current view window
  const refreshPeaks = useCallback((
    buffer?: AudioBuffer,
    vsOverride?: number,
    veOverride?: number,
  ) => {
    const wb  = buffer ?? workingBufferRef.current;
    if (!wb) return;
    const vs = vsOverride ?? viewStartRef.current;
    const ve = veOverride ?? viewEndRef.current;
    const clamped_vs = Math.max(0, Math.min(vs, wb.duration));
    const clamped_ve = Math.max(clamped_vs + 0.001, Math.min(ve, wb.duration));
    setPeaks(computeWaveformPeaksInRange(wb, clamped_vs, clamped_ve, WAVEFORM_STEPS));
    setDuration(wb.duration);
  }, []);

  // ── Load & decode ─────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setLoadError(null);

      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new AudioContext();
        }
        const ctx = audioCtxRef.current;

        const file = await getFileFromPath(track.fileName || '', track.folderPath || '');
        if (!file) throw new Error('Could not access the file. Re-import the folder to grant permission.');

        const arrayBuffer = await file.arrayBuffer();
        if (cancelled) return;

        const decoded = await ctx.decodeAudioData(arrayBuffer);
        if (cancelled) return;

        originalBufferRef.current = decoded;
        workingBufferRef.current  = copyBuffer(decoded, ctx);

        const dur = decoded.duration;
        setDuration(dur);
        setTrimStart(0);
        setTrimEnd(dur);
        setHasChanges(false);
        undoStackRef.current = [];
        redoStackRef.current = [];
        setUndoCount(0);
        setRedoCount(0);
        setViewRange(0, dur);
        refreshPeaks(decoded, 0, dur);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? 'Failed to load audio');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [track.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      try { sourceNodeRef.current?.stop(); } catch { /* ok */ }
      audioCtxRef.current?.close();
    };
  }, []);

  // ── Undo / Redo ───────────────────────────────────────────────────────────

  const captureHistory = useCallback((): HistoryEntry | null => {
    const wb = workingBufferRef.current;
    if (!wb) return null;
    return {
      buffer:    wb,
      trimStart, trimEnd,
      fadeIn,    fadeOut,
    };
  }, [trimStart, trimEnd, fadeIn, fadeOut]);

  const pushUndo = useCallback(() => {
    const entry = captureHistory();
    if (!entry) return;
    undoStackRef.current.push(entry);
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
  }, [captureHistory]);

  const restoreEntry = useCallback((entry: HistoryEntry) => {
    workingBufferRef.current = entry.buffer;
    setTrimStart(entry.trimStart);
    setTrimEnd(entry.trimEnd);
    setFadeIn(entry.fadeIn);
    setFadeOut(entry.fadeOut);
    // Clamp view range to new duration
    const dur = entry.buffer.duration;
    const vs = Math.min(viewStartRef.current, dur);
    const ve = Math.min(viewEndRef.current, dur);
    setViewRange(vs, Math.max(ve, vs + 0.001));
    refreshPeaks(entry.buffer, vs, ve);
  }, [refreshPeaks, setViewRange]);

  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;

    // Push current state to redo
    const current = captureHistory();
    if (current) {
      redoStackRef.current.push(current);
      if (redoStackRef.current.length > MAX_UNDO) redoStackRef.current.shift();
    }

    restoreEntry(prev);
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    setHasChanges(undoStackRef.current.length > 0);
  }, [captureHistory, restoreEntry]);

  const handleRedo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;

    const current = captureHistory();
    if (current) {
      undoStackRef.current.push(current);
      if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
    }

    restoreEntry(next);
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    setHasChanges(true);
  }, [captureHistory, restoreEntry]);

  // ── Playback ──────────────────────────────────────────────────────────────

  const stopPreview = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    try { sourceNodeRef.current?.stop(); } catch { /* ok */ }
    sourceNodeRef.current = null;
    setIsPlaying(false);
    setPlayhead(NaN);
  }, []);

  const startPreview = useCallback(() => {
    const ctx = audioCtxRef.current;
    const wb  = workingBufferRef.current;
    if (!ctx || !wb) return;

    stopPreview();
    ctx.resume();

    const src = ctx.createBufferSource();
    src.buffer              = wb;
    src.playbackRate.value  = previewRateRef.current;
    src.detune.value        = previewDetuneRef.current;
    src.connect(ctx.destination);

    const offset = 0;
    playOffsetRef.current = offset;
    playStartRef.current  = ctx.currentTime;

    src.start(0, offset);
    src.onended = () => {
      setIsPlaying(false);
      setPlayhead(NaN);
      cancelAnimationFrame(rafRef.current);
    };

    sourceNodeRef.current = src;
    setIsPlaying(true);

    const tick = () => {
      if (!audioCtxRef.current) return;
      // Effective playback speed = playbackRate × 2^(detune/1200)
      const effectiveRate = previewRateRef.current * Math.pow(2, previewDetuneRef.current / 1200);
      const elapsed = (audioCtxRef.current.currentTime - playStartRef.current) * effectiveRate;
      const pos = playOffsetRef.current + elapsed;
      setPlayhead(Math.min(pos, wb.duration));
      if (pos < wb.duration) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopPreview]);

  const togglePreview = useCallback(() => {
    isPlaying ? stopPreview() : startPreview();
  }, [isPlaying, startPreview, stopPreview]);

  // ── Zoom / view window ────────────────────────────────────────────────────

  const handleViewChange = useCallback((start: number, end: number) => {
    setViewRange(start, end);
    refreshPeaks(undefined, start, end);
  }, [setViewRange, refreshPeaks]);

  const handleResetZoom = useCallback(() => {
    const dur = workingBufferRef.current?.duration ?? 0;
    if (dur > 0) handleViewChange(0, dur);
  }, [handleViewChange]);

  // ── Trim ──────────────────────────────────────────────────────────────────

  const handleApplyTrim = useCallback(() => {
    const ctx = audioCtxRef.current;
    const wb  = workingBufferRef.current;
    if (!ctx || !wb) return;

    stopPreview();
    pushUndo();

    const newBuf = trimBuffer(wb, trimStart, trimEnd, ctx);
    workingBufferRef.current = newBuf;

    const dur = newBuf.duration;
    setTrimStart(0);
    setTrimEnd(dur);
    setFadeIn(f => Math.min(f, dur / 2));
    setFadeOut(f => Math.min(f, dur / 2));

    // Keep view range clamped to new duration
    const vs = Math.min(viewStartRef.current, dur);
    const ve = Math.min(Math.max(viewEndRef.current, vs + 0.001), dur);
    setViewRange(vs, ve);
    refreshPeaks(newBuf, vs, ve);
    setHasChanges(true);
    showStatus('Trim applied');
  }, [trimStart, trimEnd, stopPreview, pushUndo, setViewRange, refreshPeaks, showStatus]);

  const handleAutoTrimSilence = useCallback(() => {
    const wb = workingBufferRef.current;
    if (!wb) return;
    const { startSec, endSec } = detectSilence(wb, -60);
    setTrimStart(startSec);
    setTrimEnd(endSec);
    showStatus(`Silence detected — in: ${fmtTime(startSec)}, out: ${fmtTime(endSec)}`);
  }, [showStatus]);

  // ── Fades ─────────────────────────────────────────────────────────────────

  const handleApplyFades = useCallback(() => {
    const ctx = audioCtxRef.current;
    const wb  = workingBufferRef.current;
    if (!ctx || !wb) return;

    stopPreview();
    pushUndo();

    const copy = copyBuffer(wb, ctx);
    applyFadeIn(copy, fadeIn);
    applyFadeOut(copy, fadeOut);
    workingBufferRef.current = copy;

    refreshPeaks();
    setHasChanges(true);
    showStatus(`Fades applied (in: ${fadeIn.toFixed(1)}s, out: ${fadeOut.toFixed(1)}s)`);
  }, [fadeIn, fadeOut, stopPreview, pushUndo, refreshPeaks, showStatus]);

  // ── Normalize ─────────────────────────────────────────────────────────────

  const handleNormalize = useCallback(() => {
    const ctx = audioCtxRef.current;
    const wb  = workingBufferRef.current;
    if (!ctx || !wb) return;

    stopPreview();
    pushUndo();

    const copy = copyBuffer(wb, ctx);
    const gain = normalizePeak(copy);
    workingBufferRef.current = copy;

    refreshPeaks();
    setHasChanges(true);
    const gainDb = 20 * Math.log10(gain);
    showStatus(`Normalized (${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB)`);
  }, [stopPreview, pushUndo, refreshPeaks, showStatus]);

  // ── Speed / Pitch bake ────────────────────────────────────────────────────

  const handleBakeSpeedPitch = useCallback(async () => {
    const ctx = audioCtxRef.current;
    const wb  = workingBufferRef.current;
    if (!ctx || !wb) return;

    stopPreview();
    setIsBaking(true);

    try {
      const rate    = previewRateRef.current;
      const detune  = previewDetuneRef.current;
      // Effective rate accounts for both playbackRate AND detune (cents shift)
      // detune is in cents: 1200 cents = 1 octave = 2× speed
      const effectiveRate = rate * Math.pow(2, detune / 1200);
      const outLength = Math.max(1, Math.ceil(wb.length / effectiveRate));
      const offCtx    = new OfflineAudioContext(wb.numberOfChannels, outLength, wb.sampleRate);

      const src              = offCtx.createBufferSource();
      src.buffer             = wb;
      src.playbackRate.value = rate;
      src.detune.value       = detune;
      src.connect(offCtx.destination);
      src.start(0);

      const rendered = await offCtx.startRendering();

      pushUndo();
      workingBufferRef.current = rendered;
      setPreviewRate(1.0);
      setPreviewDetune(0);

      const dur = rendered.duration;
      // Remap trim/view positions using the effective rate so handles stay accurate
      setTrimStart(ts => Math.min(ts / effectiveRate, dur));
      setTrimEnd(te => Math.min(te / effectiveRate, dur));

      const vs = Math.min(viewStartRef.current / effectiveRate, dur);
      const ve = Math.min(viewEndRef.current   / effectiveRate, dur);
      setViewRange(vs, Math.max(ve, vs + 0.001));
      refreshPeaks(rendered, vs, ve);
      setHasChanges(true);
      showStatus(`Baked: ${rate.toFixed(2)}× speed, ${detune >= 0 ? '+' : ''}${detune} ¢` +
        (effectiveRate !== rate ? ` (effective ${effectiveRate.toFixed(2)}×)` : ''));
    } catch (e: any) {
      showStatus(e?.message ?? 'Bake failed', false);
    } finally {
      setIsBaking(false);
    }
  }, [stopPreview, pushUndo, setViewRange, refreshPeaks, showStatus]);

  // ── Revert ────────────────────────────────────────────────────────────────

  const handleRevert = useCallback(() => {
    const ctx = audioCtxRef.current;
    const ob  = originalBufferRef.current;
    if (!ctx || !ob) return;

    stopPreview();
    workingBufferRef.current = copyBuffer(ob, ctx);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoCount(0);
    setRedoCount(0);

    const dur = ob.duration;
    setTrimStart(0);
    setTrimEnd(dur);
    setFadeIn(0);
    setFadeOut(0);
    setPreviewRate(1.0);
    setPreviewDetune(0);
    setViewRange(0, dur);
    refreshPeaks(ob, 0, dur);
    setHasChanges(false);
    showStatus('Reverted to original');
  }, [stopPreview, setViewRange, refreshPeaks, showStatus]);

  // ── Export ────────────────────────────────────────────────────────────────

  const handleDownload = useCallback(async () => {
    const wb = workingBufferRef.current;
    if (!wb) return;
    setIsSaving(true);
    try {
      const blob = encodeWav(wb);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const base = (track.fileName || 'clip').replace(/\.[^.]+$/, '');
      a.href     = url;
      a.download = `${base}_edited.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      showStatus('Downloaded as WAV');
    } finally {
      setIsSaving(false);
    }
  }, [track.fileName, showStatus]);

  const handleWriteBack = useCallback(async () => {
    const wb = workingBufferRef.current;
    if (!wb) return;
    setIsSaving(true);
    try {
      const blob = encodeWav(wb);

      if (getFileHandleFromPath) {
        const handle = await getFileHandleFromPath(track.fileName || '', track.folderPath || '');
        if (handle) {
          const writable = await (handle as any).createWritable();
          await writable.write(blob);
          await writable.close();
          setHasChanges(false);
          showStatus('Saved — file overwritten on disk');
          return;
        }
      }

      if ('showSaveFilePicker' in window) {
        const base = (track.fileName || 'clip').replace(/\.[^.]+$/, '');
        const newHandle = await (window as any).showSaveFilePicker({
          suggestedName: `${base}.wav`,
          types: [{ description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } }],
        });
        const writable = await newHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        setHasChanges(false);
        showStatus('Saved as new file');
        return;
      }

      await handleDownload();
    } catch (e: any) {
      if (e?.name !== 'AbortError') showStatus(e?.message ?? 'Save failed', false);
    } finally {
      setIsSaving(false);
    }
  }, [track, getFileHandleFromPath, handleDownload, showStatus]);

  // ── Close guard ───────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (hasChanges) {
      if (!confirm('You have unsaved edits. Leave without saving?')) return;
    }
    stopPreview();
    onClose();
  }, [hasChanges, stopPreview, onClose]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') { e.preventDefault(); togglePreview(); return; }
      if (e.code === 'Escape') { e.preventDefault(); handleClose(); return; }
      if (ctrl && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
        return;
      }
      if (ctrl && e.code === 'KeyY') { e.preventDefault(); handleRedo(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePreview, handleClose, handleUndo, handleRedo]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const selDuration = trimEnd - trimStart;
  const isZoomed    = duration > 0 && (viewEnd - viewStart) < duration - 0.001;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col overflow-hidden"
      style={{ fontFamily: 'inherit' }}
    >
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
        <Button
          variant="ghost" size="icon"
          className="h-8 w-8 text-zinc-400 hover:text-white"
          onClick={handleClose}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>

        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="text-primary font-semibold tracking-widest uppercase text-[10px]">
            Clip Studio
          </span>
          <ChevronRight className="w-3 h-3" />
          <span className="text-zinc-200 truncate max-w-[200px] sm:max-w-xs font-medium">
            {track.title || track.fileName}
          </span>
          {track.artist && (
            <span className="text-zinc-500 hidden sm:inline">— {track.artist}</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {hasChanges && (
            <span className="text-[10px] text-amber-400/80 hidden sm:inline">Unsaved changes</span>
          )}
          <Button
            size="sm" variant="ghost"
            className="h-7 text-xs gap-1.5 text-zinc-400 hover:text-white"
            onClick={handleDownload}
            disabled={isLoading || isSaving || !workingBufferRef.current}
          >
            <Download className="w-3 h-3" />
            <span className="hidden sm:inline">Download WAV</span>
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5 bg-primary hover:bg-primary/80 text-white"
            onClick={handleWriteBack}
            disabled={isLoading || isSaving || !workingBufferRef.current}
          >
            {isSaving
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Save className="w-3 h-3" />
            }
            <span className="hidden sm:inline">Save to Disk</span>
          </Button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-y-auto">

        {/* Status banner */}
        {statusMsg && (
          <div className={clsx(
            'px-4 py-2 text-xs text-center',
            statusMsg.ok ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400',
          )}>
            {statusMsg.text}
          </div>
        )}

        {/* ── Waveform ── */}
        <div className="px-4 pt-4">
          <div className="rounded-lg overflow-hidden border border-white/8 bg-[#0d0d0d]">
            {isLoading ? (
              <div className="flex items-center justify-center h-40 text-zinc-500 gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Decoding audio…</span>
              </div>
            ) : loadError ? (
              <div className="flex items-center justify-center h-40 text-red-400/80 text-xs px-4 text-center">
                {loadError}
              </div>
            ) : (
              <WaveformCanvas
                peaks={peaks}
                duration={duration}
                viewStart={viewStart}
                viewEnd={viewEnd}
                trimStart={trimStart}
                trimEnd={trimEnd}
                fadeIn={fadeIn}
                fadeOut={fadeOut}
                playhead={playhead}
                onTrimChange={(s, e) => { setTrimStart(s); setTrimEnd(e); }}
                onViewChange={handleViewChange}
                onSeek={(t) => {
                  // Seek playback to clicked position
                  if (audioCtxRef.current && workingBufferRef.current) {
                    const ctx = audioCtxRef.current;
                    const wb = workingBufferRef.current;
                    stopPreview();
                    playOffsetRef.current = t;
                    playStartRef.current = ctx.currentTime;
                    const src = ctx.createBufferSource();
                    src.buffer = wb;
                    src.playbackRate.value = previewRateRef.current;
                    src.detune.value = previewDetuneRef.current;
                    src.connect(ctx.destination);
                    src.start(0, t);
                    src.onended = () => {
                      setIsPlaying(false);
                      setPlayhead(NaN);
                      cancelAnimationFrame(rafRef.current);
                    };
                    sourceNodeRef.current = src;
                    setIsPlaying(true);
                    const tick = () => {
                      if (!audioCtxRef.current) return;
                      const effectiveRate = previewRateRef.current * Math.pow(2, previewDetuneRef.current / 1200);
                      const elapsed = (audioCtxRef.current.currentTime - playStartRef.current) * effectiveRate;
                      const pos = playOffsetRef.current + elapsed;
                      setPlayhead(Math.min(pos, wb.duration));
                      if (pos < wb.duration) rafRef.current = requestAnimationFrame(tick);
                    };
                    rafRef.current = requestAnimationFrame(tick);
                  }
                }}
              />
            )}
          </div>

          {/* Time ruler — shows viewStart..viewEnd when zoomed */}
          {!isLoading && !loadError && duration > 0 && (
            <div className="flex justify-between text-[10px] text-zinc-600 font-mono mt-1 px-0.5 select-none">
              {Array.from({ length: 7 }, (_, i) => {
                const t = viewStart + (i / 6) * (viewEnd - viewStart);
                return <span key={i}>{fmtTime(t).replace(/\..*/, '')}</span>;
              })}
            </div>
          )}

          {/* Zoom bar / reset */}
          <div className="flex items-center justify-between mt-1 px-0.5">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono">
              <span className="text-zinc-500">
                In:&nbsp;<span className="text-zinc-300">{fmtTime(trimStart)}</span>
              </span>
              <span className="text-zinc-500">
                Out:&nbsp;<span className="text-zinc-300">{fmtTime(trimEnd)}</span>
              </span>
              <span className="text-zinc-500">
                Sel:&nbsp;<span className="text-primary font-semibold">{fmtTime(selDuration)}</span>
              </span>
              <span className="text-zinc-600">Total: {fmtTime(duration)}</span>
            </div>
            {isZoomed && (
              <button
                onClick={handleResetZoom}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 underline transition-colors ml-2 shrink-0"
              >
                Reset zoom
              </button>
            )}
          </div>
        </div>

        {/* ── Control cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 px-4 mt-4">

          {/* Trim card */}
          <div className="bg-white/[0.03] border border-white/8 rounded-lg p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <Scissors className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-zinc-200">Trim</span>
            </div>
            <p className="text-[11px] text-zinc-500 mb-3 leading-relaxed">
              Drag the orange handles on the waveform to set in/out points.
              Scroll wheel zooms in for precision.
            </p>
            <div className="text-[11px] font-mono text-zinc-400 mb-3 space-y-0.5">
              <div>In: <span className="text-zinc-200">{fmtTime(trimStart)}</span></div>
              <div>Out: <span className="text-zinc-200">{fmtTime(trimEnd)}</span></div>
              <div>Len: <span className="text-primary">{fmtTime(selDuration)}</span></div>
            </div>
            <div className="mt-auto flex flex-col gap-2">
              <Button
                variant="ghost"
                className="w-full h-8 text-xs gap-1.5 bg-zinc-800/50 hover:bg-zinc-700/60 text-zinc-300 border border-white/10"
                onClick={handleAutoTrimSilence}
                disabled={isLoading || !workingBufferRef.current}
              >
                <Zap className="w-3 h-3 text-yellow-400" />
                Auto-Trim Silence
              </Button>
              <Button
                className="w-full h-8 text-xs gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30"
                variant="ghost"
                onClick={handleApplyTrim}
                disabled={isLoading || !workingBufferRef.current || selDuration < 0.05}
              >
                <Scissors className="w-3 h-3" />
                Apply Trim
              </Button>
            </div>
          </div>

          {/* Fade card */}
          <div className="bg-white/[0.03] border border-white/8 rounded-lg p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <Volume2 className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs font-semibold text-zinc-200">Fades</span>
            </div>
            <div className="space-y-4 mb-4 flex-1">
              <div>
                <div className="flex justify-between text-[11px] mb-1.5">
                  <span className="text-zinc-400">Fade In</span>
                  <span className="text-zinc-200 font-mono">{fadeIn.toFixed(1)}s</span>
                </div>
                <Slider
                  value={[fadeIn]}
                  onValueChange={([v]) => setFadeIn(v)}
                  min={0}
                  max={Math.max(0.1, duration / 2)}
                  step={0.1}
                />
              </div>
              <div>
                <div className="flex justify-between text-[11px] mb-1.5">
                  <span className="text-zinc-400">Fade Out</span>
                  <span className="text-zinc-200 font-mono">{fadeOut.toFixed(1)}s</span>
                </div>
                <Slider
                  value={[fadeOut]}
                  onValueChange={([v]) => setFadeOut(v)}
                  min={0}
                  max={Math.max(0.1, duration / 2)}
                  step={0.1}
                />
              </div>
            </div>
            <Button
              className="w-full h-8 text-xs gap-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30"
              variant="ghost"
              onClick={handleApplyFades}
              disabled={isLoading || !workingBufferRef.current || (fadeIn === 0 && fadeOut === 0)}
            >
              Apply Fades
            </Button>
          </div>

          {/* Normalize card */}
          <div className="bg-white/[0.03] border border-white/8 rounded-lg p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <Wand2 className="w-3.5 h-3.5 text-green-400" />
              <span className="text-xs font-semibold text-zinc-200">Normalize</span>
            </div>
            <p className="text-[11px] text-zinc-500 mb-4 leading-relaxed flex-1">
              Scans for the peak sample and boosts gain so the peak hits −1 dBFS.
              Makes quiet recordings louder without clipping.
            </p>
            <Button
              className="w-full h-8 text-xs gap-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 mt-auto"
              variant="ghost"
              onClick={handleNormalize}
              disabled={isLoading || !workingBufferRef.current}
            >
              <Wand2 className="w-3 h-3" />
              Normalize Volume
            </Button>
          </div>

          {/* Speed / Pitch card */}
          <div className="bg-white/[0.03] border border-white/8 rounded-lg p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <Gauge className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-xs font-semibold text-zinc-200">Speed / Pitch</span>
            </div>
            <div className="space-y-4 mb-4 flex-1">
              <div>
                <div className="flex justify-between text-[11px] mb-1.5">
                  <span className="text-zinc-400">Speed</span>
                  <span className="text-zinc-200 font-mono">{previewRate.toFixed(2)}×</span>
                </div>
                <Slider
                  value={[previewRate]}
                  onValueChange={([v]) => setPreviewRate(v)}
                  min={0.5}
                  max={2.0}
                  step={0.05}
                />
                <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
                  <span>0.5×</span><span>1.0×</span><span>2.0×</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[11px] mb-1.5">
                  <span className="text-zinc-400">Detune</span>
                  <span className="text-zinc-200 font-mono">
                    {previewDetune >= 0 ? '+' : ''}{previewDetune} ¢
                  </span>
                </div>
                <Slider
                  value={[previewDetune]}
                  onValueChange={([v]) => setPreviewDetune(v)}
                  min={-1200}
                  max={1200}
                  step={50}
                />
                <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
                  <span>−1200</span><span>0</span><span>+1200</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 mt-auto">
              <p className="text-[10px] text-zinc-600 leading-relaxed">
                Preview uses these values. "Bake" renders them permanently into the working buffer.
              </p>
              <Button
                className="w-full h-8 text-xs gap-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30"
                variant="ghost"
                onClick={handleBakeSpeedPitch}
                disabled={
                  isLoading || isBaking || !workingBufferRef.current
                  || (previewRate === 1.0 && previewDetune === 0)
                }
              >
                {isBaking
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Gauge className="w-3 h-3" />
                }
                Bake Speed/Pitch
              </Button>
            </div>
          </div>
        </div>

        {/* ── Action bar ── */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-4 mt-2 border-t border-white/8">

          {/* Preview */}
          <Button
            variant="outline"
            size="sm"
            className={clsx(
              'h-8 text-xs gap-1.5 border-white/15',
              isPlaying ? 'text-primary border-primary/40 bg-primary/10' : 'text-zinc-300',
            )}
            onClick={togglePreview}
            disabled={isLoading || !workingBufferRef.current}
          >
            {isPlaying
              ? <><Square className="w-3 h-3" />Stop</>
              : <><Play  className="w-3 h-3" />Preview</>
            }
          </Button>

          {/* Undo / Redo */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="sm"
              className="h-8 w-8 p-0 text-zinc-400 hover:text-white disabled:opacity-30"
              onClick={handleUndo}
              disabled={undoCount === 0}
              title={`Undo (Ctrl+Z) — ${undoCount} step${undoCount !== 1 ? 's' : ''}`}
            >
              <Undo2 className="w-3.5 h-3.5" />
            </Button>
            {undoCount > 0 && (
              <span className="text-[10px] text-zinc-600 font-mono -ml-0.5 mr-0.5">{undoCount}</span>
            )}
            <Button
              variant="ghost" size="sm"
              className="h-8 w-8 p-0 text-zinc-400 hover:text-white disabled:opacity-30"
              onClick={handleRedo}
              disabled={redoCount === 0}
              title={`Redo (Ctrl+Shift+Z) — ${redoCount} step${redoCount !== 1 ? 's' : ''}`}
            >
              <Redo2 className="w-3.5 h-3.5" />
            </Button>
            {redoCount > 0 && (
              <span className="text-[10px] text-zinc-600 font-mono -ml-0.5">{redoCount}</span>
            )}
          </div>

          <span className="text-zinc-700 text-xs hidden sm:inline">
            Space = play/stop · Ctrl+Z / Ctrl+Shift+Z = undo/redo · Scroll wheel = zoom
          </span>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost" size="sm"
              className="h-8 text-xs gap-1.5 text-zinc-400 hover:text-white"
              onClick={handleRevert}
              disabled={isLoading || (!hasChanges && undoCount === 0)}
            >
              <RotateCcw className="w-3 h-3" />
              Revert
            </Button>
          </div>
        </div>

        {/* Bottom padding */}
        <div className="h-6" />
      </div>
    </div>
  );
}
