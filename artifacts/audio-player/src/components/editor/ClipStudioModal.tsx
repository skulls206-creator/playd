/**
 * Clip Studio — offline audio editor for local tracks.
 *
 * Architecture:
 *  - originalBuffer: decoded once, never mutated (for Revert)
 *  - workingBuffer:  copy of original; trim / fade / normalize are applied here
 *  - Preview plays workingBuffer directly via AudioBufferSourceNode
 *  - Export renders workingBuffer → WAV blob → download or File System write-back
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Track } from '@workspace/api-client-react';
import { WaveformCanvas } from './WaveformCanvas';
import { encodeWav } from '@/lib/wav-encoder';
import {
  copyBuffer,
  trimBuffer,
  applyFadeIn,
  applyFadeOut,
  normalizePeak,
  computeWaveformPeaks,
} from '@/lib/audio-editor';
import { useFileSystem } from '@/hooks/use-file-system';
import {
  ArrowLeft, Play, Square, RotateCcw,
  Download, Save, Scissors, Wand2, Loader2,
  Volume2, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { clsx } from 'clsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(sec: number): string {
  if (!isFinite(sec)) return '0:00.000';
  const m   = Math.floor(sec / 60);
  const s   = Math.floor(sec % 60);
  const ms  = Math.round((sec % 1) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

const WAVEFORM_STEPS = 800; // one peak column per canvas pixel

// ── Component ─────────────────────────────────────────────────────────────────

interface ClipStudioModalProps {
  track: Track;
  onClose: () => void;
}

export function ClipStudioModal({ track, onClose }: ClipStudioModalProps) {
  const { getFileFromPath, getFileHandleFromPath } = useFileSystem();

  // ── Audio state ─────────────────────────────────────────────────────────────
  const [isLoading,  setIsLoading]  = useState(true);
  const [loadError,  setLoadError]  = useState<string | null>(null);
  const [peaks,      setPeaks]      = useState<Float32Array | null>(null);
  const [duration,   setDuration]   = useState(0);      // workingBuffer duration

  // Trim selection (seconds relative to workingBuffer)
  const [trimStart,  setTrimStart]  = useState(0);
  const [trimEnd,    setTrimEnd]    = useState(0);

  // Fade amounts (seconds)
  const [fadeIn,     setFadeIn]     = useState(0);
  const [fadeOut,    setFadeOut]    = useState(0);

  // Playback
  const [isPlaying,  setIsPlaying]  = useState(false);
  const [playhead,   setPlayhead]   = useState(NaN);

  // Operation feedback
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving,   setIsSaving]   = useState(false);
  const [statusMsg,  setStatusMsg]  = useState<{ text: string; ok: boolean } | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const audioCtxRef        = useRef<AudioContext | null>(null);
  const originalBufferRef  = useRef<AudioBuffer | null>(null);
  const workingBufferRef   = useRef<AudioBuffer | null>(null);
  const sourceNodeRef      = useRef<AudioBufferSourceNode | null>(null);
  const playStartRef       = useRef(0);   // audioCtx.currentTime when play started
  const playOffsetRef      = useRef(0);   // buffer offset (seconds) we started from
  const rafRef             = useRef(0);

  // ── Status helper ─────────────────────────────────────────────────────────────
  const showStatus = useCallback((text: string, ok = true, ms = 3000) => {
    setStatusMsg({ text, ok });
    setTimeout(() => setStatusMsg(null), ms);
  }, []);

  // ── Load & decode ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setLoadError(null);

      try {
        // Re-use or create an AudioContext for the editor (separate from the player's)
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
        const p   = computeWaveformPeaks(decoded, WAVEFORM_STEPS);

        setDuration(dur);
        setTrimStart(0);
        setTrimEnd(dur);
        setPeaks(p);
        setHasChanges(false);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? 'Failed to load audio');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [track.id]);

  // Cleanup AudioContext on unmount
  useEffect(() => {
    return () => {
      stopPreview();
      audioCtxRef.current?.close();
    };
  }, []);

  // ── Recompute peaks whenever workingBuffer changes ────────────────────────────
  const refreshPeaks = useCallback(() => {
    const wb = workingBufferRef.current;
    if (!wb) return;
    setPeaks(computeWaveformPeaks(wb, WAVEFORM_STEPS));
    setDuration(wb.duration);
  }, []);

  // ── Playback ──────────────────────────────────────────────────────────────────
  const stopPreview = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    try { sourceNodeRef.current?.stop(); } catch { /* already stopped */ }
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
    src.buffer = wb;
    src.connect(ctx.destination);

    const offset     = 0; // always play from start of working buffer
    playOffsetRef.current   = offset;
    playStartRef.current    = ctx.currentTime;

    src.start(0, offset);
    src.onended = () => {
      setIsPlaying(false);
      setPlayhead(NaN);
      cancelAnimationFrame(rafRef.current);
    };

    sourceNodeRef.current = src;
    setIsPlaying(true);

    // Animate playhead
    const tick = () => {
      if (!audioCtxRef.current) return;
      const elapsed = audioCtxRef.current.currentTime - playStartRef.current;
      const pos     = playOffsetRef.current + elapsed;
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

  // ── Trim operation ────────────────────────────────────────────────────────────
  const handleApplyTrim = useCallback(() => {
    const ctx = audioCtxRef.current;
    const wb  = workingBufferRef.current;
    if (!ctx || !wb) return;

    stopPreview();
    const newBuf = trimBuffer(wb, trimStart, trimEnd, ctx);
    workingBufferRef.current = newBuf;

    // Reset trim selection to cover whole new buffer
    setTrimStart(0);
    setTrimEnd(newBuf.duration);
    setFadeIn(f => Math.min(f, newBuf.duration / 2));
    setFadeOut(f => Math.min(f, newBuf.duration / 2));
    refreshPeaks();
    setHasChanges(true);
    showStatus('Trim applied');
  }, [trimStart, trimEnd, stopPreview, refreshPeaks, showStatus]);

  // ── Fade operation ────────────────────────────────────────────────────────────
  const handleApplyFades = useCallback(() => {
    const ctx = audioCtxRef.current;
    const wb  = workingBufferRef.current;
    if (!ctx || !wb) return;

    stopPreview();
    // Work on a copy so we can still revert
    const copy = copyBuffer(wb, ctx);
    applyFadeIn(copy, fadeIn);
    applyFadeOut(copy, fadeOut);
    workingBufferRef.current = copy;

    refreshPeaks();
    setHasChanges(true);
    showStatus(`Fades applied (in: ${fadeIn.toFixed(1)}s, out: ${fadeOut.toFixed(1)}s)`);
  }, [fadeIn, fadeOut, stopPreview, refreshPeaks, showStatus]);

  // ── Normalize ─────────────────────────────────────────────────────────────────
  const handleNormalize = useCallback(() => {
    const ctx = audioCtxRef.current;
    const wb  = workingBufferRef.current;
    if (!ctx || !wb) return;

    stopPreview();
    const copy = copyBuffer(wb, ctx);
    const gain = normalizePeak(copy);
    workingBufferRef.current = copy;

    refreshPeaks();
    setHasChanges(true);
    const gainDb = 20 * Math.log10(gain);
    showStatus(`Normalized (+${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB)`);
  }, [stopPreview, refreshPeaks, showStatus]);

  // ── Revert ────────────────────────────────────────────────────────────────────
  const handleRevert = useCallback(() => {
    const ctx = audioCtxRef.current;
    const ob  = originalBufferRef.current;
    if (!ctx || !ob) return;

    stopPreview();
    workingBufferRef.current = copyBuffer(ob, ctx);

    setTrimStart(0);
    setTrimEnd(ob.duration);
    setFadeIn(0);
    setFadeOut(0);
    refreshPeaks();
    setHasChanges(false);
    showStatus('Reverted to original');
  }, [stopPreview, refreshPeaks, showStatus]);

  // ── Export ────────────────────────────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    const wb = workingBufferRef.current;
    if (!wb) return;
    setIsSaving(true);
    try {
      const blob = encodeWav(wb);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const base = (track.fileName || 'clip').replace(/\.[^.]+$/, '');
      a.href = url;
      a.download = `${base}_edited.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
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

      // Try File System Access API write-back first
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

      // Fallback: try showSaveFilePicker
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

      // Last resort: regular download
      await handleDownload();
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        showStatus(e?.message ?? 'Save failed', false);
      }
    } finally {
      setIsSaving(false);
    }
  }, [track, getFileHandleFromPath, handleDownload, showStatus]);

  // ── Close guard ───────────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    if (hasChanges) {
      if (!confirm('You have unsaved edits. Leave without saving?')) return;
    }
    stopPreview();
    onClose();
  }, [hasChanges, stopPreview, onClose]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); togglePreview(); }
      if (e.code === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePreview, handleClose]);

  // ── Render ────────────────────────────────────────────────────────────────────
  const selDuration = trimEnd - trimStart;

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col overflow-hidden" style={{ fontFamily: 'inherit' }}>

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
          <span className="text-primary font-semibold tracking-widest uppercase text-[10px]">Clip Studio</span>
          <ChevronRight className="w-3 h-3" />
          <span className="text-zinc-200 truncate max-w-[200px] sm:max-w-xs font-medium">{track.title || track.fileName}</span>
          {track.artist && <span className="text-zinc-500 hidden sm:inline">— {track.artist}</span>}
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
            'px-4 py-2 text-xs text-center transition-all',
            statusMsg.ok ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
          )}>
            {statusMsg.text}
          </div>
        )}

        {/* Waveform area */}
        <div className="px-4 pt-4">
          <div className="rounded-lg overflow-hidden border border-white/8 bg-[#0d0d0d] relative">
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
                trimStart={trimStart}
                trimEnd={trimEnd}
                fadeIn={fadeIn}
                fadeOut={fadeOut}
                playhead={playhead}
                onTrimChange={(s, e) => { setTrimStart(s); setTrimEnd(e); }}
              />
            )}
          </div>

          {/* Time ruler */}
          {!isLoading && !loadError && duration > 0 && (
            <div className="flex justify-between text-[10px] text-zinc-600 font-mono mt-1 px-0.5">
              {Array.from({ length: 7 }, (_, i) => {
                const t = (i / 6) * duration;
                return (
                  <span key={i}>{fmtTime(t).replace(/\..*/, '')}</span>
                );
              })}
            </div>
          )}

          {/* Selection info */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2 px-0.5 text-[11px] font-mono">
            <span className="text-zinc-500">
              Start: <span className="text-zinc-300">{fmtTime(trimStart)}</span>
            </span>
            <span className="text-zinc-500">
              End: <span className="text-zinc-300">{fmtTime(trimEnd)}</span>
            </span>
            <span className="text-zinc-500">
              Selection: <span className="text-primary font-semibold">{fmtTime(selDuration)}</span>
            </span>
            <span className="text-zinc-600">
              Total: {fmtTime(duration)}
            </span>
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-4 mt-4">

          {/* Trim card */}
          <div className="bg-white/[0.03] border border-white/8 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Scissors className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-zinc-200">Trim</span>
            </div>
            <p className="text-[11px] text-zinc-500 mb-3 leading-relaxed">
              Drag the orange handles on the waveform to set the in/out points, then apply.
            </p>
            <div className="text-[11px] font-mono text-zinc-400 mb-3 space-y-0.5">
              <div>In:  <span className="text-zinc-200">{fmtTime(trimStart)}</span></div>
              <div>Out: <span className="text-zinc-200">{fmtTime(trimEnd)}</span></div>
              <div>Len: <span className="text-primary">{fmtTime(selDuration)}</span></div>
            </div>
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

          {/* Fade card */}
          <div className="bg-white/[0.03] border border-white/8 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Volume2 className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs font-semibold text-zinc-200">Fades</span>
            </div>

            <div className="space-y-4 mb-4">
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
                  className="w-full"
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
                  className="w-full"
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
          <div className="bg-white/[0.03] border border-white/8 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Wand2 className="w-3.5 h-3.5 text-green-400" />
              <span className="text-xs font-semibold text-zinc-200">Normalize</span>
            </div>
            <p className="text-[11px] text-zinc-500 mb-4 leading-relaxed">
              Scans the entire clip for the peak sample and boosts gain so that peak hits −1 dBFS. Makes quiet recordings louder without clipping.
            </p>
            <Button
              className="w-full h-8 text-xs gap-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30"
              variant="ghost"
              onClick={handleNormalize}
              disabled={isLoading || !workingBufferRef.current}
            >
              <Wand2 className="w-3 h-3" />
              Normalize Volume
            </Button>
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
              : <><Play className="w-3 h-3" />Preview</>
            }
          </Button>

          <span className="text-zinc-700 text-xs hidden sm:inline">Space to play/stop</span>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs gap-1.5 text-zinc-400 hover:text-white"
              onClick={handleRevert}
              disabled={isLoading || !hasChanges}
            >
              <RotateCcw className="w-3 h-3" />
              Revert
            </Button>
          </div>
        </div>

        {/* Bottom padding for scroll */}
        <div className="h-6" />
      </div>
    </div>
  );
}
