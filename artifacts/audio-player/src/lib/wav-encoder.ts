/**
 * Encodes an AudioBuffer as a 16-bit PCM WAV blob.
 * Pure JS — no external dependencies.
 */
export function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate  = buffer.sampleRate;
  const numSamples  = buffer.length;
  const BPS         = 2; // bytes per sample (16-bit)
  const dataSize    = numChannels * numSamples * BPS;

  const ab   = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  // Helper: write ASCII string
  const ws = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  // RIFF header
  ws(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ws(8, 'WAVE');

  // fmt chunk
  ws(12, 'fmt ');
  view.setUint32(16, 16, true);                          // chunk size
  view.setUint16(20, 1, true);                           // PCM = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * BPS, true); // byte rate
  view.setUint16(32, numChannels * BPS, true);           // block align
  view.setUint16(34, 16, true);                          // bits per sample

  // data chunk
  ws(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channels as signed 16-bit little-endian PCM
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += BPS;
    }
  }

  return new Blob([ab], { type: 'audio/wav' });
}
