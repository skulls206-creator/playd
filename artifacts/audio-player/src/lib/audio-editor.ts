/**
 * Core AudioBuffer editing operations.
 * All functions are pure — they return new buffers or modify in place where documented.
 */

/**
 * Returns a deep copy of an AudioBuffer.
 */
export function copyBuffer(src: AudioBuffer, ctx: BaseAudioContext): AudioBuffer {
  const out = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    out.getChannelData(ch).set(src.getChannelData(ch));
  }
  return out;
}

/**
 * Returns a new AudioBuffer containing only the samples between [startSec, endSec].
 */
export function trimBuffer(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  ctx: BaseAudioContext,
): AudioBuffer {
  const sr          = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sr));
  const endSample   = Math.min(buffer.length, Math.ceil(endSec * sr));
  const length      = Math.max(1, endSample - startSample);

  const out = ctx.createBuffer(buffer.numberOfChannels, length, sr);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(startSample, endSample));
  }
  return out;
}

/**
 * Applies a cosine fade-in over the first `fadeSec` seconds IN PLACE.
 * Cosine ramp (0 → 1) sounds more natural than a linear ramp.
 */
export function applyFadeIn(buffer: AudioBuffer, fadeSec: number): void {
  if (fadeSec <= 0) return;
  const samples = Math.min(buffer.length, Math.round(fadeSec * buffer.sampleRate));
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < samples; i++) {
      const t = i / samples;
      data[i] *= 0.5 - 0.5 * Math.cos(Math.PI * t); // 0 → 1 cosine
    }
  }
}

/**
 * Applies a cosine fade-out over the last `fadeSec` seconds IN PLACE.
 */
export function applyFadeOut(buffer: AudioBuffer, fadeSec: number): void {
  if (fadeSec <= 0) return;
  const samples = Math.min(buffer.length, Math.round(fadeSec * buffer.sampleRate));
  const start   = buffer.length - samples;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < samples; i++) {
      const t = i / samples;
      data[start + i] *= 0.5 + 0.5 * Math.cos(Math.PI * t); // 1 → 0 cosine
    }
  }
}

/**
 * Peak-normalizes all channels so the loudest sample hits `targetPeak` (default −1 dBFS ≈ 0.891).
 * Operates IN PLACE. Returns the gain factor applied (1 = already at target or silent).
 */
export function normalizePeak(buffer: AudioBuffer, targetPeak = 0.891): number {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  if (peak < 1e-10) return 1; // silent
  const gain = targetPeak / peak;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.max(-1, Math.min(1, data[i] * gain));
    }
  }
  return gain;
}

/**
 * Computes downsampled min/max peaks for the FULL buffer for waveform rendering.
 * Returns a Float32Array of length `steps * 2`: [min0, max0, min1, max1, ...].
 * Uses the average of both channels if stereo.
 */
export function computeWaveformPeaks(buffer: AudioBuffer, steps: number): Float32Array {
  return computeWaveformPeaksInRange(buffer, 0, buffer.duration, steps);
}

/**
 * Computes downsampled min/max peaks for a specific time range within the buffer.
 * Use this for zoomed waveform display.
 * Returns a Float32Array of length `steps * 2`: [min0, max0, min1, max1, ...].
 */
export function computeWaveformPeaksInRange(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  steps: number,
): Float32Array {
  const sr       = buffer.sampleRate;
  const numCh    = buffer.numberOfChannels;
  const startIdx = Math.max(0, Math.floor(startSec * sr));
  const endIdx   = Math.min(buffer.length, Math.ceil(endSec * sr));
  const rangeLen = Math.max(1, endIdx - startIdx);
  const chunkSz  = Math.ceil(rangeLen / steps);
  const out      = new Float32Array(steps * 2);

  for (let i = 0; i < steps; i++) {
    const s = startIdx + i * chunkSz;
    const e = Math.min(s + chunkSz, endIdx);
    let mn = 0, mx = 0;

    for (let j = s; j < e; j++) {
      let sample = 0;
      for (let ch = 0; ch < numCh; ch++) {
        sample += buffer.getChannelData(ch)[j];
      }
      sample /= numCh;
      if (sample < mn) mn = sample;
      if (sample > mx) mx = sample;
    }

    out[i * 2]     = mn;
    out[i * 2 + 1] = mx;
  }

  return out;
}

/**
 * Detects silence at the start and end of a buffer.
 * Returns the time range (in seconds) of the audible content.
 * If completely silent, returns the full buffer range.
 *
 * @param thresholdDb  Amplitude threshold in dBFS (default −60 dB)
 */
export function detectSilence(
  buffer: AudioBuffer,
  thresholdDb = -60,
): { startSec: number; endSec: number } {
  const thresh = Math.pow(10, thresholdDb / 20); // linear threshold
  const numCh  = buffer.numberOfChannels;
  const len    = buffer.length;
  const sr     = buffer.sampleRate;

  const isAudible = (i: number): boolean => {
    for (let ch = 0; ch < numCh; ch++) {
      if (Math.abs(buffer.getChannelData(ch)[i]) > thresh) return true;
    }
    return false;
  };

  // Scan forward from start
  let startIdx = 0;
  for (let i = 0; i < len; i++) {
    if (isAudible(i)) { startIdx = i; break; }
  }

  // Scan backward from end
  let endIdx = len - 1;
  for (let i = len - 1; i >= 0; i--) {
    if (isAudible(i)) { endIdx = i; break; }
  }

  // Add a tiny pad around detected edges (5ms) to avoid hard cuts
  const padSamples = Math.round(0.005 * sr);
  return {
    startSec: Math.max(0, (startIdx - padSamples) / sr),
    endSec:   Math.min(buffer.duration, (endIdx + 1 + padSamples) / sr),
  };
}
