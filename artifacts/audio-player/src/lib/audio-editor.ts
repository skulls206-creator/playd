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
 * Computes downsampled min/max peaks for waveform rendering.
 * Returns a Float32Array of length `steps * 2`: [min0, max0, min1, max1, ...].
 * Uses the average of both channels if stereo.
 */
export function computeWaveformPeaks(buffer: AudioBuffer, steps: number): Float32Array {
  const numCh = buffer.numberOfChannels;
  const size  = Math.ceil(buffer.length / steps);
  const out   = new Float32Array(steps * 2);

  for (let i = 0; i < steps; i++) {
    const start = i * size;
    const end   = Math.min(start + size, buffer.length);
    let mn = 0, mx = 0;

    for (let j = start; j < end; j++) {
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
