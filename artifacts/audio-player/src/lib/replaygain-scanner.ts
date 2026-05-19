/**
 * ReplayGain scanner — browser-side, no native dependencies.
 *
 * Algorithm:
 *   1. Decode the entire audio file via OfflineAudioContext (browser-native).
 *   2. Compute the true-peak RMS across all channels.
 *   3. Convert RMS to dBFS: 20 * log10(rms).
 *   4. Return the gain adjustment needed to reach a -18 dBFS target:
 *        gain_dB = TARGET_LUFS - measured_dBFS
 *
 * -18 dBFS is the standard ReplayGain reference level (89 dB SPL).
 * A positive gain means the file is too quiet; negative means too loud.
 */

const TARGET_DBFS = -18;

// ⚠️  WARNING: This function reads the ENTIRE audio file into RAM via
// file.arrayBuffer(). For very large files (>10 MB) this can consume
// significant memory. Consider adding a max-read-size check or streaming
// chunked read if this becomes a bottleneck.
//
// TODO: Add a configurable max-read-size limit (e.g. warn/skip files > 50 MB).
export async function scanReplaygain(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer();

  // Decode audio — OfflineAudioContext does NOT need a sample rate matched to
  // the file; it resamples automatically.
  const ctx = new OfflineAudioContext(1, 1, 44100);
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    throw new Error(`Cannot decode audio: ${file.name}`);
  }

  // Compute RMS across all channels
  let sumOfSquares = 0;
  let sampleCount = 0;
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      sumOfSquares += data[i] * data[i];
    }
    sampleCount += data.length;
  }

  if (sampleCount === 0) return 0;

  const rms = Math.sqrt(sumOfSquares / sampleCount);

  if (rms === 0) return 0; // silence

  const measuredDbfs = 20 * Math.log10(rms);
  const gainDb = TARGET_DBFS - measuredDbfs;

  // Clamp to a sane range to avoid extreme boosts on near-silent tracks
  return Math.max(-20, Math.min(20, gainDb));
}
