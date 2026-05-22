import { useState, useRef } from 'react';
import { toast } from '@/hooks/use-toast';
import { get, set } from 'idb-keyval';
import { useTrackStore } from '@/lib/track-store';
import type { LocalTrack } from '@/lib/track-store';
import { scanReplaygain } from '@/lib/replaygain-scanner';
import { parseCueSheet, isCueFile, resolveCueAudioFileName, getCueTrackDuration } from '@/lib/cue-parser';

const ART_STORE_KEY = 'track-art';
const AUDIO_EXTS = /\.(mp3|flac|m4a|m4p|aac|wav|ogg|opus|webm|wma|aiff|aif|alac|mp4|3gp)$/i;

// ── Handle cache for gesture-dependent paths ──────────────────────────────
// On Android Chrome, reading IndexedDB (async) inside a click handler
// consumes the user gesture. requestPermission and showDirectoryPicker
// need that gesture to show the permission/picker dialog.
//
// We keep a synchronously-accessible cache of stored handles so the
// Sync Now and refresh buttons can check BEFORE any await, preserving
// the gesture for permission re-authorization.
let _handleCache: FileSystemDirectoryHandle[] | null = null;

async function _ensureHandleCache(): Promise<FileSystemDirectoryHandle[]> {
  if (_handleCache === null) {
    _handleCache = (await get('music-folders')) || [];
  }
  return _handleCache;
}
function _invalidateHandleCache() {
  _handleCache = null;
}

/** Sync access — call inside click handlers before any await */
export function getStoredHandlesSync(): FileSystemDirectoryHandle[] {
  return _handleCache ? [..._handleCache] : [];
}


// ─── Native Vorbis Comment parser (OGG / Opus files) ────────────────────────
// Bypasses music-metadata-browser entirely for these formats.
// OGG Opus layout:
//   Page 0 → "OpusHead" (ID header)
//   Page 1 → "OpusTags" (Vorbis Comment header — contains metadata)
//
// Vorbis Comment wire format (after "OpusTags"):
//   uint32le  vendor_string_length
//   <bytes>   vendor_string
//   uint32le  comment_count
//   for each comment:
//     uint32le  length
//     <bytes>   "KEY=value"  (UTF-8)
// ────────────────────────────────────────────────────────────────────────────

function readLE32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function readBE32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function decodeVorbisCommentPicture(
  base64Val: string,
): { mimeType: string; data: Uint8Array } | null {
  try {
    const raw = atob(base64Val);
    const b = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i);
    let o = 4; // skip picture_type
    const mimeLen = readBE32(b, o); o += 4;
    const mimeType = new TextDecoder().decode(b.subarray(o, o + mimeLen)); o += mimeLen;
    const descLen = readBE32(b, o); o += 4 + descLen;
    o += 16; // skip width, height, depth, color-count
    const dataLen = readBE32(b, o); o += 4;
    return { mimeType, data: b.subarray(o, o + dataLen) };
  } catch {
    return null;
  }
}

interface VorbisTags {
  title?: string;
  artist?: string;
  album?: string;
  trackNumber?: number;
  year?: number;
  genre?: string;
  albumArtDataUrl?: string;
}

function parseVorbisComments(bytes: Uint8Array): VorbisTags {
  // Locate "OpusTags" magic bytes (the Opus comment header magic signature)
  const magic = [0x4F, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73];
  let offset = -1;
  outer: for (let i = 0; i < bytes.length - 8; i++) {
    for (let j = 0; j < 8; j++) {
      if (bytes[i + j] !== magic[j]) continue outer;
    }
    offset = i + 8;
    break;
  }
  if (offset < 0) return {};

  if (offset + 8 > bytes.length) return {};

  const vendorLen = readLE32(bytes, offset); offset += 4;
  if (offset + vendorLen + 4 > bytes.length) return {};
  offset += vendorLen;

  const numComments = readLE32(bytes, offset); offset += 4;
  if (numComments > 10000) return {}; // sanity check

  const dec = new TextDecoder('utf-8');
  const result: VorbisTags = {};

  for (let i = 0; i < numComments; i++) {
    if (offset + 4 > bytes.length) break;
    const len = readLE32(bytes, offset); offset += 4;
    if (offset + len > bytes.length) break;

    const comment = dec.decode(bytes.subarray(offset, offset + len));
    offset += len;

    const eq = comment.indexOf('=');
    if (eq < 0) continue;

    const key = comment.slice(0, eq).toUpperCase();
    const val = comment.slice(eq + 1);

    if (key === 'TITLE') result.title = val;
    else if (key === 'ARTIST') result.artist = val;
    else if (key === 'ALBUMARTIST' && !result.artist) result.artist = val;
    else if (key === 'ALBUM') result.album = val;
    else if (key === 'TRACKNUMBER') {
      const n = parseInt(val, 10);
      if (!isNaN(n) && n > 0) result.trackNumber = n;
    } else if (key === 'DATE' || key === 'YEAR') {
      const y = parseInt(val.slice(0, 4), 10);
      if (!isNaN(y) && y > 0) result.year = y;
    } else if (key === 'GENRE') {
      result.genre = val;
    } else if (key === 'METADATA_BLOCK_PICTURE') {
      const pic = decodeVorbisCommentPicture(val);
      if (pic && !result.albumArtDataUrl) {
        let bin = '';
        for (let b = 0; b < pic.data.length; b++) bin += String.fromCharCode(pic.data[b]);
        result.albumArtDataUrl = `data:${pic.mimeType};base64,${btoa(bin)}`;
      }
    }
  }

  return result;
}

// Read the last 65 KB of an Opus file to find the final OGG page's granule
// position. For Opus, duration = granulePosition / 48000 seconds.
async function getOpusDuration(file: File): Promise<number> {
  try {
    const TAIL = 65536;
    const start = Math.max(0, file.size - TAIL);
    const buf = await file.slice(start).arrayBuffer();
    const b = new Uint8Array(buf);
    let lastGranuleLo = 0;
    let lastGranuleHi = 0;

    for (let i = 0; i < b.length - 13; i++) {
      if (b[i] === 0x4F && b[i + 1] === 0x67 && b[i + 2] === 0x67 && b[i + 3] === 0x53) {
        const lo = readLE32(b, i + 6);
        const hi = readLE32(b, i + 10);
        if (hi !== 0xFFFFFFFF || lo !== 0xFFFFFFFF) {
          lastGranuleLo = lo;
          lastGranuleHi = hi;
        }
      }
    }

    if (lastGranuleHi === 0 && lastGranuleLo === 0) return 0;
    const granule = lastGranuleHi * 4294967296 + lastGranuleLo;
    return granule / 48000;
  } catch {
    return 0;
  }
}

// ─── Native ID3v2 parser (MP3 files) ────────────────────────────────────────
// Supports ID3v2.2, ID3v2.3, ID3v2.4.
// ────────────────────────────────────────────────────────────────────────────

const ID3_GENRES: Record<number, string> = {
  0:'Blues',1:'Classic Rock',2:'Country',3:'Dance',4:'Disco',5:'Funk',
  6:'Grunge',7:'Hip-Hop',8:'Jazz',9:'Metal',10:'New Age',11:'Oldies',
  12:'Other',13:'Pop',14:'R&B',15:'Rap',16:'Reggae',17:'Rock',
  18:'Techno',19:'Industrial',20:'Alternative',21:'Ska',22:'Death Metal',
  23:'Pranks',24:'Soundtrack',25:'Euro-Techno',26:'Ambient',27:'Trip-Hop',
  28:'Vocal',29:'Jazz+Funk',30:'Fusion',31:'Trance',32:'Classical',
  33:'Instrumental',34:'Acid',35:'House',36:'Game',37:'Sound Clip',
  38:'Gospel',39:'Noise',40:'AlternRock',41:'Bass',42:'Soul',43:'Punk',
  44:'Space',45:'Meditative',46:'Instrumental Pop',47:'Instrumental Rock',
  48:'Ethnic',49:'Gothic',50:'Darkwave',51:'Techno-Industrial',52:'Electronic',
  53:'Pop-Folk',54:'Eurodance',55:'Dream',56:'Southern Rock',57:'Comedy',
  58:'Cult',59:'Gangsta',60:'Top 40',61:'Christian Rap',62:'Pop/Funk',
  63:'Jungle',64:'Native American',65:'Cabaret',66:'New Wave',67:'Psychadelic',
  68:'Rave',69:'Showtunes',70:'Trailer',71:'Lo-Fi',72:'Tribal',73:'Acid Punk',
  74:'Acid Jazz',75:'Polka',76:'Retro',77:'Musical',78:'Rock & Roll',79:'Hard Rock',
};

function decodeSynchsafeInt(b: Uint8Array, offset: number): number {
  return ((b[offset] & 0x7F) << 21) | ((b[offset+1] & 0x7F) << 14) |
         ((b[offset+2] & 0x7F) << 7)  |  (b[offset+3] & 0x7F);
}

function decodeID3Text(b: Uint8Array): string {
  if (b.length === 0) return '';
  const enc = b[0];
  const data = b.subarray(1);
  let text = '';
  try {
    if (enc === 1) text = new TextDecoder('utf-16').decode(data);
    else if (enc === 2) text = new TextDecoder('utf-16be').decode(data);
    else if (enc === 3) text = new TextDecoder('utf-8').decode(data);
    else text = new TextDecoder('latin1').decode(data);
  } catch {
    text = new TextDecoder('utf-8', { fatal: false }).decode(data);
  }
  // Strip null terminators and everything after
  const nul = text.indexOf('\0');
  return nul >= 0 ? text.slice(0, nul) : text;
}

interface ID3Tags {
  title?: string;
  artist?: string;
  album?: string;
  trackNumber?: number;
  year?: number;
  genre?: string;
  albumArtDataUrl?: string;
  id3Size: number; // bytes consumed by ID3 tag (for duration calc)
}

function parseID3v2(bytes: Uint8Array): ID3Tags {
  const result: ID3Tags = { id3Size: 0 };
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return result;

  const major = bytes[3];
  const flags = bytes[5];
  const tagSize = decodeSynchsafeInt(bytes, 6);
  result.id3Size = tagSize + 10;

  let pos = 10;

  // Skip extended header (ID3v2.3+)
  if (major >= 3 && (flags & 0x40)) {
    const extSize = major === 4
      ? decodeSynchsafeInt(bytes, pos)
      : readBE32(bytes, pos);
    pos += extSize;
  }

  const end = Math.min(10 + tagSize, bytes.length);
  const isV22 = major === 2;
  const hdSize = isV22 ? 6 : 10;

  while (pos + hdSize <= end) {
    let fid: string, fsize: number, fstart: number;

    if (isV22) {
      fid = String.fromCharCode(bytes[pos], bytes[pos+1], bytes[pos+2]);
      fsize = (bytes[pos+3] << 16) | (bytes[pos+4] << 8) | bytes[pos+5];
      fstart = pos + 6;
    } else {
      fid = String.fromCharCode(bytes[pos], bytes[pos+1], bytes[pos+2], bytes[pos+3]);
      fsize = major === 4
        ? decodeSynchsafeInt(bytes, pos + 4)
        : readBE32(bytes, pos + 4);
      fstart = pos + 10;
    }

    if (fsize === 0 || bytes[pos] === 0) break;
    if (fstart + fsize > end) break;

    const fd = bytes.subarray(fstart, fstart + fsize);

    if (fid === 'TIT2' || fid === 'TT2') result.title = decodeID3Text(fd);
    else if (fid === 'TPE1' || fid === 'TP1') result.artist = decodeID3Text(fd);
    else if (fid === 'TALB' || fid === 'TAL') result.album = decodeID3Text(fd);
    else if (fid === 'TRCK' || fid === 'TRK') {
      const n = parseInt(decodeID3Text(fd).split('/')[0], 10);
      if (!isNaN(n) && n > 0) result.trackNumber = n;
    } else if (fid === 'TYER' || fid === 'TYE' || fid === 'TDRC') {
      const y = parseInt(decodeID3Text(fd).slice(0, 4), 10);
      if (!isNaN(y) && y > 0) result.year = y;
    } else if (fid === 'TCON' || fid === 'TCO') {
      let g = decodeID3Text(fd);
      const m = g.match(/^\((\d+)\)/);
      if (m) g = ID3_GENRES[parseInt(m[1], 10)] || g;
      result.genre = g.replace(/^\(.*?\)/, '').trim() || g;
    } else if ((fid === 'APIC' || fid === 'PIC') && !result.albumArtDataUrl) {
      try {
        let p = 0;
        const enc = fd[p++];
        let mimeType: string;
        if (isV22) {
          // PIC: 3-char format code
          mimeType = String.fromCharCode(fd[p], fd[p+1], fd[p+2]) === 'PNG'
            ? 'image/png' : 'image/jpeg';
          p += 3;
        } else {
          // APIC: null-terminated MIME type
          let mEnd = p;
          while (mEnd < fd.length && fd[mEnd] !== 0) mEnd++;
          mimeType = new TextDecoder('latin1').decode(fd.subarray(p, mEnd)) || 'image/jpeg';
          p = mEnd + 1;
        }
        p++; // skip picture type byte
        // Skip description (null-terminated, encoding-aware)
        if (enc === 1 || enc === 2) {
          while (p + 1 < fd.length && !(fd[p] === 0 && fd[p+1] === 0)) p += 2;
          p += 2;
        } else {
          while (p < fd.length && fd[p] !== 0) p++;
          p++;
        }
        const imgData = fd.subarray(p);
        if (imgData.length > 0) {
          const b64 = btoa(Array.from(imgData, (x: number) => String.fromCharCode(x)).join(''));
          result.albumArtDataUrl = `data:${mimeType};base64,${b64}`;
        }
      } catch { /* skip broken art */ }
    }

    pos = fstart + fsize;
  }

  return result;
}

// Estimate MP3 duration from Xing/Info VBR header or CBR frame header.
// Reads only the first ~4 KB so it's very fast.
async function getMp3Duration(file: File): Promise<number> {
  try {
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());

    // Find the first sync frame (FF Ex or FF Fx) after any ID3 tag
    let pos = 0;
    // Skip ID3v2 tag if present
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      const id3size = decodeSynchsafeInt(head, 6) + 10;
      pos = id3size;
    }

    // Scan for MPEG sync word
    for (; pos < head.length - 4; pos++) {
      if (head[pos] === 0xFF && (head[pos+1] & 0xE0) === 0xE0) {
        const h = (head[pos] << 24) | (head[pos+1] << 16) | (head[pos+2] << 8) | head[pos+3];

        const versionBits = (h >> 19) & 3;
        const layerBits   = (h >> 17) & 3;
        const bitrateBits = (h >> 12) & 15;
        const srBits      = (h >> 10) & 3;

        if (versionBits === 1 || layerBits === 0 || bitrateBits === 0 ||
            bitrateBits === 15 || srBits === 3) { continue; }

        const BITRATES: Record<string, number[]> = {
          'V1L1': [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],
          'V1L2': [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
          'V1L3': [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],
          'V2L1': [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
          'V2L3': [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
        };
        const SAMPLERATES: Record<number, number[]> = {
          3:[44100,48000,32000], 2:[22050,24000,16000], 0:[11025,12000,8000],
        };

        const ver = versionBits === 3 ? 'V1' : 'V2';
        const lay = `L${4 - layerBits}`;
        const brKey = `${ver}${lay}`;
        const brArr = BITRATES[brKey] || BITRATES['V1L3'];
        const bitrate = brArr[bitrateBits] * 1000; // bps
        const sampleRate = (SAMPLERATES[versionBits] || SAMPLERATES[3])[srBits];

        if (!bitrate || !sampleRate) continue;

        // Check for Xing/Info VBR header inside this frame
        const sideInfoSize = (versionBits === 3)
          ? ((h >> 6) & 3 ? 17 : 32)  // mono vs stereo MPEG1
          : ((h >> 6) & 3 ? 9 : 17);   // MPEG2
        const xingOff = pos + 4 + sideInfoSize;
        if (xingOff + 8 <= head.length) {
          const xingId = String.fromCharCode(head[xingOff], head[xingOff+1], head[xingOff+2], head[xingOff+3]);
          if (xingId === 'Xing' || xingId === 'Info') {
            const xflags = readBE32(head, xingOff + 4);
            if (xflags & 1) { // FRAMES flag set
              const frameCount = readBE32(head, xingOff + 8);
              const samplesPerFrame = lay === 'L1' ? 384 : 1152;
              return (frameCount * samplesPerFrame) / sampleRate;
            }
          }
        }

        // CBR estimate: (file_size - id3_header) / bytes_per_second
        const audioBytes = file.size - pos;
        return (audioBytes * 8) / bitrate;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

// ─── Native FLAC parser ──────────────────────────────────────────────────────
// FLAC uses metadata blocks: 1 byte (is_last<<7 | block_type) + 3 bytes length
// Block types: STREAMINFO=0, VORBIS_COMMENT=4, PICTURE=6
// VORBIS_COMMENT block has the SAME wire format as OGG Vorbis Comments
// (but WITHOUT the "OpusTags" magic prefix — the comment data starts directly).
// STREAMINFO is 34 bytes of bit-packed fields containing sample_rate and total_samples.
// ────────────────────────────────────────────────────────────────────────────

function parseFlacPictureBlock(b: Uint8Array): string | null {
  try {
    let o = 4; // skip picture_type
    const mimeLen = readBE32(b, o); o += 4;
    const mimeType = new TextDecoder().decode(b.subarray(o, o + mimeLen)); o += mimeLen;
    const descLen = readBE32(b, o); o += 4 + descLen;
    o += 16; // skip width, height, depth, color-count
    const dataLen = readBE32(b, o); o += 4;
    const imgData = b.subarray(o, o + dataLen);
    const b64 = btoa(Array.from(imgData, (x: number) => String.fromCharCode(x)).join(''));
    return `data:${mimeType};base64,${b64}`;
  } catch { return null; }
}

function parseFlacVorbisCommentBlock(b: Uint8Array): VorbisTags {
  // Same format as OGG Vorbis Comments, but starts immediately with the vendor string
  // (no "OpusTags" magic — the block IS the comment header data)
  let offset = 0;
  if (offset + 4 > b.length) return {};
  const vendorLen = readLE32(b, offset); offset += 4;
  if (offset + vendorLen + 4 > b.length) return {};
  offset += vendorLen;
  const numComments = readLE32(b, offset); offset += 4;
  if (numComments > 10000) return {};

  const dec = new TextDecoder('utf-8');
  const result: VorbisTags = {};

  for (let i = 0; i < numComments; i++) {
    if (offset + 4 > b.length) break;
    const len = readLE32(b, offset); offset += 4;
    if (offset + len > b.length) break;
    const comment = dec.decode(b.subarray(offset, offset + len));
    offset += len;
    const eq = comment.indexOf('=');
    if (eq < 0) continue;
    const key = comment.slice(0, eq).toUpperCase();
    const val = comment.slice(eq + 1);
    if (key === 'TITLE') result.title = val;
    else if (key === 'ARTIST') result.artist = val;
    else if (key === 'ALBUMARTIST' && !result.artist) result.artist = val;
    else if (key === 'ALBUM') result.album = val;
    else if (key === 'TRACKNUMBER') { const n = parseInt(val, 10); if (!isNaN(n) && n > 0) result.trackNumber = n; }
    else if (key === 'DATE' || key === 'YEAR') { const y = parseInt(val.slice(0, 4), 10); if (!isNaN(y)) result.year = y; }
    else if (key === 'GENRE') result.genre = val;
  }
  return result;
}

interface FlacData { tags: VorbisTags; duration: number; albumArtDataUrl?: string }

function parseFlac(bytes: Uint8Array): FlacData {
  const result: FlacData = { tags: {}, duration: 0 };
  // Verify "fLaC" magic
  if (bytes[0] !== 0x66 || bytes[1] !== 0x4C || bytes[2] !== 0x61 || bytes[3] !== 0x43) return result;

  let pos = 4;
  while (pos + 4 <= bytes.length) {
    const header = bytes[pos];
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7F;
    const blockLen = (bytes[pos+1] << 16) | (bytes[pos+2] << 8) | bytes[pos+3];
    pos += 4;
    if (pos + blockLen > bytes.length) break;

    const block = bytes.subarray(pos, pos + blockLen);

    if (blockType === 0 && blockLen >= 18) {
      // STREAMINFO — extract sample_rate (20 bits) and total_samples (36 bits)
      // Bit layout (from byte 10): [20-bit samplerate][3-bit ch][5-bit bps][36-bit total_samples]
      const sampleRate = ((block[10] << 12) | (block[11] << 4) | (block[12] >> 4)) >>> 0;
      const tsHi = block[13] & 0x0F;
      const tsLo = readBE32(block, 14);
      const totalSamples = tsHi * 0x100000000 + tsLo;
      if (sampleRate > 0 && totalSamples > 0) {
        result.duration = totalSamples / sampleRate;
      }
    } else if (blockType === 4) {
      // VORBIS_COMMENT
      result.tags = parseFlacVorbisCommentBlock(block);
    } else if (blockType === 6 && !result.albumArtDataUrl) {
      // PICTURE
      result.albumArtDataUrl = parseFlacPictureBlock(block) ?? undefined;
    }

    pos += blockLen;
    if (isLast) break;
  }

  return result;
}

// ─── Native WAV parser ───────────────────────────────────────────────────────
// RIFF/WAVE: "RIFF" + uint32le size + "WAVE" + chunks
// Relevant chunks:
//   "fmt " — audio format, sample rate, byte_rate → used for duration
//   "data" — audio data size → duration = size / byte_rate
//   "LIST" + "INFO" — RIFF INFO tags (INAM, IART, IPRD, ITRK, ICRD, IGNR)
//   "id3 " / "ID3 " — embedded ID3v2 tag (reuse parseID3v2)
// ────────────────────────────────────────────────────────────────────────────

interface WavData { tags: VorbisTags; duration: number; albumArtDataUrl?: string }

function parseWav(bytes: Uint8Array): WavData {
  const result: WavData = { tags: {}, duration: 0 };
  const dec = new TextDecoder('latin1');

  const id = dec.decode(bytes.subarray(0, 4));
  const riff = dec.decode(bytes.subarray(8, 12));
  if (id !== 'RIFF' || riff !== 'WAVE') return result;

  let byteRate = 0;
  let dataSize = 0;
  let pos = 12;

  while (pos + 8 <= bytes.length) {
    const chunkId = dec.decode(bytes.subarray(pos, pos + 4));
    const chunkSize = readLE32(bytes, pos + 4);
    pos += 8;
    if (pos + chunkSize > bytes.length + 1) break; // allow 1 byte for odd padding

    const chunk = bytes.subarray(pos, pos + chunkSize);

    if (chunkId === 'fmt ') {
      // Audio format chunk: byte_rate at offset 8 (uint32 LE)
      if (chunk.length >= 12) {
        byteRate = readLE32(chunk, 8);
      }
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      if (byteRate > 0) {
        result.duration = dataSize / byteRate;
      }
    } else if (chunkId === 'LIST' && chunk.length >= 4) {
      const listType = dec.decode(chunk.subarray(0, 4));
      if (listType === 'INFO') {
        let lPos = 4;
        while (lPos + 8 <= chunk.length) {
          const tagId = dec.decode(chunk.subarray(lPos, lPos + 4));
          const tagSize = readLE32(chunk, lPos + 4);
          lPos += 8;
          if (lPos + tagSize > chunk.length) break;
          const rawVal = dec.decode(chunk.subarray(lPos, lPos + tagSize)).replace(/\0.*$/, '').trim();
          if (rawVal) {
            if (tagId === 'INAM') result.tags.title = rawVal;
            else if (tagId === 'IART') result.tags.artist = rawVal;
            else if (tagId === 'IPRD') result.tags.album = rawVal;
            else if (tagId === 'IGNR') result.tags.genre = rawVal;
            else if (tagId === 'ITRK') { const n = parseInt(rawVal, 10); if (!isNaN(n) && n > 0) result.tags.trackNumber = n; }
            else if (tagId === 'ICRD') { const y = parseInt(rawVal.slice(0, 4), 10); if (!isNaN(y)) result.tags.year = y; }
          }
          lPos += tagSize + (tagSize % 2); // pad to even
        }
      }
    } else if ((chunkId === 'id3 ' || chunkId === 'ID3 ') && !result.tags.title) {
      // Embedded ID3v2 — reuse our parser
      const id3 = parseID3v2(chunk);
      if (id3.title) result.tags.title = id3.title;
      if (id3.artist) result.tags.artist = id3.artist;
      if (id3.album) result.tags.album = id3.album;
      if (id3.trackNumber) result.tags.trackNumber = id3.trackNumber;
      if (id3.year) result.tags.year = id3.year;
      if (id3.genre) result.tags.genre = id3.genre;
      if (id3.albumArtDataUrl) result.albumArtDataUrl = id3.albumArtDataUrl;
    }

    pos += chunkSize + (chunkSize % 2); // RIFF chunks are padded to even byte boundaries
  }

  return result;
}


// ─── Filename metadata fallback ──────────────────────────────────────────────
function parseFilenameMetadata(fileName: string): { artist: string; title: string } {
  let name = fileName.replace(/\.[^.]+$/, '');
  name = name.replace(/\s*-\s*\(p\)\s*$/, '').trim();
  const sep = name.indexOf(' - ');
  if (sep > 0) {
    return { artist: name.slice(0, sep).trim(), title: name.slice(sep + 3).trim() };
  }
  return { artist: '', title: name.trim() };
}

// ─── Native M4A / MP4 atom parser ───────────────────────────────────────────
// Parses MPEG-4 container atoms to extract iTunes metadata and duration.
// Covers M4A, M4P, AAC wrapped in MP4, ALAC, and generic MP4 audio.
// ────────────────────────────────────────────────────────────────────────────

interface M4ATags {
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string;
  trackNumber?: number;
  albumArtDataUrl?: string;
  duration: number;
}

function parseM4A(bytes: Uint8Array): M4ATags {
  const result: M4ATags = { duration: 0 };
  const dec = new TextDecoder('utf-8');

  function readAtoms(buf: Uint8Array, base: number, limit: number, cb: (type: string, data: Uint8Array, abs: number) => void) {
    let pos = base;
    while (pos + 8 <= limit) {
      let size = readBE32(buf, pos);
      const type = String.fromCharCode(buf[pos+4], buf[pos+5], buf[pos+6], buf[pos+7]);
      let headerSize = 8;
      if (size === 1) {
        // Extended size (64-bit) — skip high word, use low word only (files < 4 GB)
        size = readBE32(buf, pos + 12);
        headerSize = 16;
      }
      if (size < headerSize || pos + size > limit) break;
      cb(type, buf.subarray(pos + headerSize, pos + size), pos);
      pos += size;
    }
  }

  function findAtom(buf: Uint8Array, base: number, limit: number, target: string): Uint8Array | null {
    let found: Uint8Array | null = null;
    readAtoms(buf, base, limit, (type, data) => { if (type === target) found = data; });
    return found;
  }

  // Walk top-level atoms
  readAtoms(bytes, 0, bytes.length, (type, data, abs) => {
    if (type === 'moov') {
      // ── Duration from mvhd ──
      const mvhd = findAtom(bytes, abs + 8, abs + 8 + data.length, 'mvhd');
      if (mvhd && mvhd.length >= 20) {
        const ver = mvhd[0];
        if (ver === 0) {
          const ts = readBE32(mvhd, 12);
          const dur = readBE32(mvhd, 16);
          if (ts > 0) result.duration = dur / ts;
        } else if (ver === 1 && mvhd.length >= 28) {
          const ts = readBE32(mvhd, 20);
          const durHi = readBE32(mvhd, 24);
          const durLo = mvhd.length >= 32 ? readBE32(mvhd, 28) : 0;
          if (ts > 0) result.duration = (durHi * 4294967296 + durLo) / ts;
        }
      }

      // ── iTunes metadata from udta.meta.ilst ──
      const udta = findAtom(bytes, abs + 8, abs + 8 + data.length, 'udta');
      if (!udta) return;

      // meta has a 4-byte version+flags before its children
      const metaRaw = findAtom(udta, 0, udta.length, 'meta');
      if (!metaRaw || metaRaw.length < 4) return;
      const meta = metaRaw.subarray(4);

      const ilst = findAtom(meta, 0, meta.length, 'ilst');
      if (!ilst) return;

      function readDataAtom(container: Uint8Array): Uint8Array | null {
        return findAtom(container, 0, container.length, 'data');
      }

      function textValue(container: Uint8Array): string | undefined {
        const d = readDataAtom(container);
        if (!d || d.length < 8) return undefined;
        const text = dec.decode(d.subarray(8)).trim();
        return text || undefined;
      }

      const ID3_GENRES_M4A: Record<number, string> = {
        1:'Blues',2:'Classic Rock',3:'Country',4:'Dance',5:'Disco',6:'Funk',
        7:'Grunge',8:'Hip-Hop',9:'Jazz',10:'Metal',11:'New Age',12:'Oldies',
        13:'Other',14:'Pop',15:'R&B',16:'Rap',17:'Reggae',18:'Rock',
        19:'Techno',20:'Industrial',21:'Alternative',22:'Ska',23:'Death Metal',
        24:'Pranks',25:'Soundtrack',32:'Classical',33:'Instrumental',40:'AlternRock',
        42:'Soul',52:'Electronic',255:'None',
      };

      readAtoms(ilst, 0, ilst.length, (tag, tagData) => {
        if (tag === '\u00a9nam') result.title = textValue(tagData);
        else if (tag === '\u00a9ART' || tag === 'aART') {
          const v = textValue(tagData); if (v && !result.artist) result.artist = v;
        }
        else if (tag === '\u00a9alb') result.album = textValue(tagData);
        else if (tag === '\u00a9day') {
          const v = textValue(tagData);
          if (v) { const y = parseInt(v.slice(0, 4), 10); if (!isNaN(y) && y > 0) result.year = y; }
        }
        else if (tag === '\u00a9gen') result.genre = textValue(tagData);
        else if (tag === 'gnre') {
          const d = readDataAtom(tagData);
          if (d && d.length >= 10) { const idx = (d[8] << 8) | d[9]; result.genre = ID3_GENRES_M4A[idx] || undefined; }
        }
        else if (tag === 'trkn') {
          const d = readDataAtom(tagData);
          if (d && d.length >= 12) { const n = (d[10] << 8) | d[11]; if (n > 0) result.trackNumber = n; }
        }
        else if (tag === 'covr' && !result.albumArtDataUrl) {
          const d = readDataAtom(tagData);
          if (d && d.length > 8) {
            const flags = (d[1] << 16) | (d[2] << 8) | d[3];
            const mime = flags === 14 ? 'image/png' : 'image/jpeg';
            const imgBytes = d.subarray(8);
            try {
              const b64 = btoa(Array.from(imgBytes, (x: number) => String.fromCharCode(x)).join(''));
              result.albumArtDataUrl = `data:${mime};base64,${b64}`;
            } catch { /* skip large art */ }
          }
        }
      });
    }
  });

  return result;
}

// ─── Audio file detection ────────────────────────────────────────────────────
const SKIP_EXTS = /\.(jpg|jpeg|png|gif|webp|bmp|svg|pdf|txt|xml|json|html|css|js|db|sqlite|ini|log|zip|rar|7z|exe|dll|lnk|url|nfo|cue|m3u|m3u8|pls|xspf)$/i;

function isLikelyAudio(file: File): boolean {
  if (AUDIO_EXTS.test(file.name)) return true;
  if (file.type.startsWith('audio/')) return true;
  if (file.type.startsWith('video/')) return true;
  if (!file.name.includes('.')) return true;
  if (SKIP_EXTS.test(file.name)) return false;
  return true;
}

// ─── In-memory file store (session-only, for playback) ──────────────────────
// Entries are cleaned up after FILE_CACHE_TTL_MS of inactivity.
// Accessing or re-setting a key refreshes its TTL.
const FILE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const fileTimestamps = new Map<string, number>();
const inMemoryFiles = new Map<string, File>();

function setInMemoryFile(key: string, file: File): void {
  inMemoryFiles.set(key, file);
  fileTimestamps.set(key, Date.now());
}

function getInMemoryFile(key: string): File | undefined {
  const file = inMemoryFiles.get(key);
  if (file) {
    fileTimestamps.set(key, Date.now()); // refresh TTL on access
  }
  return file;
}

function sweepExpiredFiles(): void {
  const cutoff = Date.now() - FILE_CACHE_TTL_MS;
  for (const [key, ts] of fileTimestamps) {
    if (ts < cutoff) {
      inMemoryFiles.delete(key);
      fileTimestamps.delete(key);
    }
  }
}

// Periodic sweep every 5 minutes
setInterval(sweepExpiredFiles, 5 * 60 * 1000);

function hasInMemoryFile(key: string): boolean {
  return inMemoryFiles.has(key);
}

function pickFilesViaInput(): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    (input as any).webkitdirectory = true;

    let settled = false;
    const settle = (value: FileList | null) => {
      if (!settled) { settled = true; resolve(value); }
    };

    input.addEventListener('change', () => settle(input.files));
    const onFocus = () => setTimeout(() => settle(null), 500);
    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}

// ─── Format routing helpers ──────────────────────────────────────────────────
function isOggFile(fileName: string): boolean  { return /\.(opus|ogg|oga)$/i.test(fileName); }
function isMp3File(fileName: string): boolean  { return /\.mp3$/i.test(fileName); }
function isFlacFile(fileName: string): boolean { return /\.flac$/i.test(fileName); }
function isWavFile(fileName: string): boolean  { return /\.(wav|wave)$/i.test(fileName); }

/**
 * Probe the real duration of any audio file using the browser's native decoder.
 * This is the universal fallback — it works for every format the browser can
 * play (MP3, FLAC, OPUS, WAV, M4A, AAC, WEBM, …) regardless of whether our
 * custom binary parsers could read the container. We use `preload="metadata"`
 * so the browser only fetches the header, not the whole file. Returns 0 if the
 * file cannot be decoded (corrupted / unsupported format).
 */
async function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const cleanup = (val: number) => {
      audio.src = '';
      URL.revokeObjectURL(url);
      resolve(val);
    };
    audio.addEventListener('loadedmetadata', () => {
      cleanup(isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
    }, { once: true });
    audio.addEventListener('error', () => cleanup(0), { once: true });
    audio.preload = 'metadata';
    audio.src = url;
  });
}

// ─── Concurrency-limited async batch processor ────────────────────────────
// Processes items from an array in batches, with up to `concurrency` items
// being processed simultaneously. Returns results in original order.
// `onProgress(total)` is called after each item completes for progress updates.
async function asyncBatch<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
      completed++;
      onProgress?.(completed);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export function useFileSystem() {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('');
  const statusClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { upsertTracks } = useTrackStore();

  // Always cancel any pending clear before setting a new status message.
  // Pass clearAfterMs to auto-clear; omit to leave it up indefinitely.
  const setStatus = (msg: string, clearAfterMs?: number) => {
    if (statusClearRef.current) {
      clearTimeout(statusClearRef.current);
      statusClearRef.current = null;
    }
    setScanStatus(msg);
    if (clearAfterMs) {
      statusClearRef.current = setTimeout(() => {
        setScanStatus('');
        statusClearRef.current = null;
      }, clearAfterMs);
    }
  };

  const verifyPermission = async (fileHandle: FileSystemHandle, readWrite = false) => {
    const options = { mode: readWrite ? 'readwrite' : 'read' } as any;
    // Check existing permission state first — no user gesture needed here
    const current = await fileHandle.queryPermission(options);
    if (current === 'granted') return true;
    // If permission is 'prompt', we may be in a user-gesture context — try requesting
    if (current === 'prompt') {
      try {
        const result = await fileHandle.requestPermission(options);
        if (result === 'granted') return true;
      } catch {
        return false;
      }
    }
    return false;
  };

  const getStoredHandles = async (): Promise<FileSystemDirectoryHandle[]> => {
    return _ensureHandleCache();
  };

  const getArtForTrack = async (fileName: string, folderPath: string): Promise<string | null> => {
    const artStore: Record<string, string> = (await get(ART_STORE_KEY)) || {};
    return artStore[`${folderPath}/${fileName}`] || null;
  };

  const processTracks = async (
    entries: Array<{ file: File; relativePath: string }>,
    rootName: string,
    skippedExts?: string[],
  ) => {
    setIsScanning(true);
    setScanProgress(0);
    setStatus(`Scanning ${rootName}…`);

    try {
      // Mobile Chrome has tighter memory limits — lower concurrency to avoid
      // Aw-Snap crashes from stacking multiple arrayBuffer() calls.
      // Desktop can handle 8 concurrent workers fine.
      const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const CONCURRENCY = isMobile ? 3 : 8;
      const artStore: Record<string, string> = (await get(ART_STORE_KEY)) || {};

      // Phase 1: Parse metadata from files with concurrency limit.
      // Tracks are flushed to the store incrementally so the user sees
      // them appear as they scan, not all at once at the end.
      const totalFiles = entries.length;
      const cachedTracks: Array<{ track: any; file: File }> = [];
      const FLUSH_EVERY = 15;

      const parseOne = async ({ file, relativePath }: { file: File; relativePath: string }, idx: number) => {
        setScanProgress(idx + 1);
        setStatus(`Scanning ${rootName}… (${idx + 1}/${totalFiles})`);
        const parts = relativePath.split('/');
        const fileName = parts[parts.length - 1];
        const folderPath = parts.slice(0, -1).join('/') || rootName;

        setInMemoryFile(`${folderPath}/${fileName}`, file);

        const fileMeta = parseFilenameMetadata(fileName);
        const isOgg = isOggFile(fileName);
        const isFlac = isFlacFile(fileName);
        const isWav = isWavFile(fileName);
        const isMp3 = isMp3File(fileName);
        const isM4a = !isOgg && !isFlac && !isWav && !isMp3 && AUDIO_EXTS.test(fileName);

        const makeTrack = (meta: {
          title?: string; artist?: string; album?: string;
          year?: number | null; genre?: string | null;
          duration: number; trackNumber?: number | null;
          albumArtDataUrl?: string | null;
        }) => ({
          title: meta.title || fileMeta.title || fileName,
          artist: meta.artist || fileMeta.artist || '',
          album: meta.album || 'Unknown Album',
          year: meta.year ?? null,
          genre: meta.genre ?? null,
          duration: Math.round(meta.duration),
          trackNumber: meta.trackNumber ?? null,
          rating: 0,
          replaygainGain: null,
          cueOffset: null,
          cueDuration: null,
          fileName, folderPath, albumArtDataUrl: null, source: 'local',
        });

        try {
          if (isOgg) {
            const tagSliceSize = Math.min(file.size, 2 * 1024 * 1024);
            const tagBuf = await file.slice(0, tagSliceSize).arrayBuffer();
            const bytes = new Uint8Array(tagBuf);
            const tags = parseVorbisComments(bytes);
            let dur = await getOpusDuration(file);
            if (!(dur > 0)) dur = await probeDuration(file);
            const artKey = `${folderPath}/${fileName}`;
            if (tags.albumArtDataUrl) artStore[artKey] = tags.albumArtDataUrl;
            return { track: makeTrack({
              title: tags.title, artist: tags.artist,
              album: tags.album, year: tags.year,
              genre: tags.genre, duration: dur,
              trackNumber: tags.trackNumber,
            }), file };
          } else if (isMp3) {
            const tagSliceSize = Math.min(file.size, 10 * 1024 * 1024);
            const tagBuf = await file.slice(0, tagSliceSize).arrayBuffer();
            const bytes = new Uint8Array(tagBuf);
            const tags = parseID3v2(bytes);
            let dur = await getMp3Duration(file);
            if (!(dur > 0)) dur = await probeDuration(file);
            const artKey = `${folderPath}/${fileName}`;
            if (tags.albumArtDataUrl) artStore[artKey] = tags.albumArtDataUrl;
            return { track: makeTrack({
              title: tags.title, artist: tags.artist,
              album: tags.album, year: tags.year,
              genre: tags.genre, duration: dur,
              trackNumber: tags.trackNumber,
            }), file };
          } else if (isFlac) {
            const tagSliceSize = Math.min(file.size, 4 * 1024 * 1024);
            const tagBuf = await file.slice(0, tagSliceSize).arrayBuffer();
            const flac = parseFlac(new Uint8Array(tagBuf));
            const artKey = `${folderPath}/${fileName}`;
            if (flac.albumArtDataUrl) artStore[artKey] = flac.albumArtDataUrl;
            const dur = flac.duration > 0 ? flac.duration : await probeDuration(file);
            return { track: makeTrack({
              title: flac.tags.title, artist: flac.tags.artist,
              album: flac.tags.album, year: flac.tags.year,
              genre: flac.tags.genre, duration: dur,
              trackNumber: flac.tags.trackNumber,
            }), file };
          } else if (isWav) {
            const tagSliceSize = Math.min(file.size, 4 * 1024 * 1024);
            const tagBuf = await file.slice(0, tagSliceSize).arrayBuffer();
            const wav = parseWav(new Uint8Array(tagBuf));
            const artKey = `${folderPath}/${fileName}`;
            if (wav.albumArtDataUrl) artStore[artKey] = wav.albumArtDataUrl;
            const dur = wav.duration > 0 ? wav.duration : await probeDuration(file);
            return { track: makeTrack({
              title: wav.tags.title, artist: wav.tags.artist,
              album: wav.tags.album, year: wav.tags.year,
              genre: wav.tags.genre, duration: dur,
              trackNumber: wav.tags.trackNumber,
            }), file };
          } else if (isM4a) {
            const sliceSize = Math.min(file.size, 8 * 1024 * 1024);
            const tagBuf = await file.slice(0, sliceSize).arrayBuffer();
            const m4a = parseM4A(new Uint8Array(tagBuf));
            const artKey = `${folderPath}/${fileName}`;
            if (m4a.albumArtDataUrl) artStore[artKey] = m4a.albumArtDataUrl;
            const dur = m4a.duration > 0 ? m4a.duration : await probeDuration(file);
            return { track: makeTrack({
              title: m4a.title, artist: m4a.artist,
              album: m4a.album, year: m4a.year,
              genre: m4a.genre, duration: dur,
              trackNumber: m4a.trackNumber,
            }), file };
          }
        } catch (err) {
          console.error(`[playd] parse error for "${fileName}":`, err);
        }

        // Fallback: unknown file type or parse error
        const dur = await probeDuration(file);
        return { track: makeTrack({ duration: dur }), file };
      };

      // Process files concurrently but flush to store in batches every FLUSH_EVERY
      await asyncBatch(entries, CONCURRENCY, async (entry, idx) => {
        const result = await parseOne(entry, idx);
        cachedTracks.push(result);
        if (cachedTracks.length >= FLUSH_EVERY) {
          const batch = cachedTracks.splice(0, cachedTracks.length);
          await upsertTracks(batch.map(r => r.track));
          setScanProgress(idx + 1); // re-set after re-render from store update
          setStatus(`Scanning ${rootName}… (${idx + 1}/${totalFiles})`);
        }
      });

      // Flush remaining
      if (cachedTracks.length > 0) {
        await upsertTracks(cachedTracks.map(r => r.track));
      }

      setStatus(`Saving album art…`);
      await set(ART_STORE_KEY, artStore);

      const tracks = useTrackStore.getState().tracks
        .filter(t => t.folderPath === rootName ||
          entries.some(e => e.relativePath.includes(t.fileName)))
        .reverse();

      // Collect references for ReplayGain (need the File objects + matching tracks)
      const cachedFileRefs = cachedTracks.slice(); // files we flushed
      const fileRefs: Array<{ fileName: string; file: File }> = [];
      for (const ref of cachedFileRefs) {
        // Only keep files we can still reference (not already garbage collected)
        if (ref.file) fileRefs.push({ fileName: ref.track.fileName, file: ref.file });
      }

      if (entries.length === 0) {
        const extInfo = skippedExts && skippedExts.length > 0
          ? ` Found: ${[...new Set(skippedExts)].slice(0, 6).join(', ')}`
          : '';
        setStatus(`No audio files found.${extInfo}`, 8000);
        return;
      }

      // ── CUE sheet post-processing ──────────────────────────────────────
      const cueFiles = entries.filter(e => isCueFile(e.relativePath));
      if (cueFiles.length > 0) {
        setStatus('Parsing CUE sheets…');
        let cueTracksCreated = 0;
        const storedTracks = useTrackStore.getState().tracks;

        for (const { file, relativePath } of cueFiles) {
          try {
            const cueText = await file.text();
            const cue = parseCueSheet(cueText);
            if (!cue) {
              console.warn(`[CUE] Failed to parse: ${relativePath}`);
              continue;
            }

            const availableFiles = storedTracks
              .filter(t => t.folderPath === rootName)
              .map(t => t.fileName);
            const audioFileName = resolveCueAudioFileName(cue, availableFiles);
            if (!audioFileName) {
              console.warn(`[CUE] No matching audio file found for: ${cue.file.fileName}`);
              continue;
            }

            const parentTrack = storedTracks.find(t =>
              t.folderPath === rootName && t.fileName === audioFileName
            );
            if (!parentTrack) continue;

            const virtualTracks: Array<Omit<LocalTrack, 'id' | 'createdAt' | 'updatedAt'>> = [];

            for (const ct of cue.tracks) {
              const end = getCueTrackDuration(cue, ct);
              virtualTracks.push({
                title: ct.title || `Track ${ct.number}`,
                artist: ct.performer || cue.albumPerformer || parentTrack.artist,
                album: cue.albumTitle || parentTrack.album,
                year: null, genre: null,
                duration: Math.round(end),
                trackNumber: ct.number,
                fileName: parentTrack.folderPath + '#' + parentTrack.fileName + '#cue' + String(ct.index),
                folderPath: parentTrack.folderPath,
                albumArtDataUrl: parentTrack.albumArtDataUrl,
                rating: 0,
                source: 'local',
                replaygainGain: null,
                cueOffset: ct.index,
                cueDuration: Math.round(end),
              });
            }

            if (virtualTracks.length > 0) {
              await upsertTracks(virtualTracks);
              cueTracksCreated += virtualTracks.length;
            }
          } catch (err) {
            console.error(`[CUE] Error processing ${relativePath}:`, err);
          }
        }

        if (cueTracksCreated > 0) {
          setStatus(`✓ ${entries.length} tracks + ${cueTracksCreated} CUE tracks ready`, 8000);
        }
      } else {
        setStatus(`✓ ${entries.length} tracks ready`, 8000);
      }

      // Phase 2: ReplayGain — fire-and-forget, never blocks track visibility.
      // scanReplaygain() decodes the entire file via OfflineAudioContext which
      // is memory-intensive. Processed in background after tracks are visible.
      const RG_CONCURRENCY = isMobile ? 1 : 3;
      const RG_MAX_BYTES = isMobile ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
      const rgCandidates: Array<{ fileName: string; file: File }> = [];
      for (const ref of fileRefs) {
        if (ref.file.size < RG_MAX_BYTES) {
          rgCandidates.push(ref);
        }
      }
      // Fire and forget — RG trickles in the background.
      // After each batch, look up the store track by fileName and update it.
      (async () => {
        await asyncBatch(rgCandidates, RG_CONCURRENCY, async ({ fileName, file }) => {
          try {
            const gain = await scanReplaygain(file);
            const storeTracks = useTrackStore.getState().tracks;
            const match = storeTracks.find(t => t.fileName === fileName && t.folderPath === rootName);
            if (match) {
              await useTrackStore.getState().updateTrack(match.id, {
                replaygainGain: Math.round(gain * 10) / 10,
              });
            }
          } catch { /* non-critical */ }
        });
      })();
    } catch (error) {
      console.error('Scan failed', error);
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(`Scan failed: ${msg.slice(0, 120)}`, 10000);
    } finally {
      setIsScanning(false);
    }
  };

  const scanFolder = async (dirHandle: FileSystemDirectoryHandle): Promise<number> => {
    const entries: Array<{ file: File; relativePath: string }> = [];
    const skippedExts: string[] = [];

    const hasPermission = await verifyPermission(dirHandle);
    if (!hasPermission) {
      setStatus('Permission denied', 5000);
      return 0;
    }

    async function walk(handle: FileSystemDirectoryHandle, path: string) {
      for await (const entry of (handle as any).values()) {
        if (entry.kind === 'directory') {
          await walk(entry, `${path}/${entry.name}`);
        } else if (entry.kind === 'file') {
          const file = await entry.getFile();
          if (isLikelyAudio(file) || /\.cue$/i.test(entry.name)) {
            entries.push({ file, relativePath: `${path}/${entry.name}` });
          } else {
            const ext = entry.name.includes('.')
              ? '.' + entry.name.split('.').pop()!.toLowerCase()
              : '(no ext)';
            skippedExts.push(ext);
          }
        }
      }
    }

    await walk(dirHandle, dirHandle.name);
    await processTracks(entries, dirHandle.name, skippedExts);
    return entries.length;
  };

  const scanFileList = async (files: FileList) => {
    if (!files.length) return;
    const entries: Array<{ file: File; relativePath: string }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      entries.push({ file, relativePath: (file as any).webkitRelativePath || file.name });
    }
    const rootName = entries[0]?.relativePath.split('/')[0] || 'Imported';
    await processTracks(entries, rootName);
  };

  const loadSampleTrack = async (): Promise<boolean> => {
    try {
      const resp = await fetch(`${import.meta.env.BASE_URL}GRAHAM_-_Enough_For_Me.mp3`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const fileName = 'GRAHAM_-_Enough_For_Me.mp3';
      const file = new File([blob], fileName, { type: 'audio/mpeg' });
      const relativePath = `Samples/${fileName}`;
      setInMemoryFile(relativePath, file);
      await processTracks([{ file, relativePath }], 'Samples');
      return true;
    } catch (e) {
      console.error('Failed to load sample track', e);
      return false;
    }
  };

  const addFiles = async (): Promise<boolean> => {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.mp3,.flac,.m4a,.aac,.wav,.ogg,.opus';

      let settled = false;
      const finish = (result: boolean) => {
        if (!settled) { settled = true; resolve(result); }
      };

      input.addEventListener('change', async () => {
        if (input.files && input.files.length > 0) {
          await scanFileList(input.files);
          finish(true);
        } else {
          finish(false);
        }
      });

      const onFocus = () => setTimeout(() => finish(false), 500);
      window.addEventListener('focus', onFocus, { once: true });
      input.click();
    });
  };

  const addFolder = async (): Promise<boolean> => {
    if (typeof (window as any).showDirectoryPicker === 'function') {
      try {
        const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
        const existing = await getStoredHandles();
        if (!existing.some(h => h.name === handle.name)) {
          await set('music-folders', [...existing, handle]);
          _invalidateHandleCache();
        }
        // Also sync to local-folder-names so PreferencesPanel's Sources tab shows it
        const folderNames: string[] = (await get('local-folder-names')) || [];
        if (!folderNames.includes(handle.name)) {
          await set('local-folder-names', [...folderNames, handle.name]);
        }
        await scanFolder(handle);
        return true;
      } catch (e: any) {
        if (e?.name === 'AbortError') return false;
        console.info('showDirectoryPicker unavailable, using file input fallback:', e?.name);
      }
    }

    const files = await pickFilesViaInput();
    if (!files || files.length === 0) return false;
    await scanFileList(files);
    return true;
  };

  const getFileFromPath = async (fileName: string, folderPath: string): Promise<File | null> => {
    const memKey = `${folderPath}/${fileName}`;
    if (hasInMemoryFile(memKey)) return getInMemoryFile(memKey)!;

    try {
      const handles = await getStoredHandles();
      const rootFolderName = folderPath.split('/')[0];
      const rootHandle = handles.find(h => h.name === rootFolderName);

      if (!rootHandle) return null;
      if (!(await verifyPermission(rootHandle))) return null;

      const pathParts = folderPath.split('/').slice(1);
      let currentHandle: FileSystemDirectoryHandle = rootHandle;
      for (const part of pathParts) {
        currentHandle = await currentHandle.getDirectoryHandle(part);
      }
      const fileHandle = await currentHandle.getFileHandle(fileName);
      return await fileHandle.getFile();
    } catch (e) {
      console.error('Failed to get file from path', e);
      return null;
    }
  };

  // Returns the FileSystemFileHandle (not just the File), enabling createWritable() for save-back.
  const getFileHandleFromPath = async (
    fileName: string,
    folderPath: string,
  ): Promise<FileSystemFileHandle | null> => {
    try {
      const handles = await getStoredHandles();
      const rootFolderName = folderPath.split('/')[0];
      const rootHandle = handles.find(h => h.name === rootFolderName);
      if (!rootHandle) return null;
      if (!(await verifyPermission(rootHandle))) return null;

      const pathParts = folderPath.split('/').slice(1);
      let currentHandle: FileSystemDirectoryHandle = rootHandle;
      for (const part of pathParts) {
        currentHandle = await currentHandle.getDirectoryHandle(part);
      }
      return await currentHandle.getFileHandle(fileName);
    } catch (e) {
      console.error('Failed to get file handle from path', e);
      return null;
    }
  };

  const rescanAll = async (): Promise<{ total: number; folders: number }> => {
    const handles = await getStoredHandles();
    if (handles.length === 0) {
      setStatus('No folders added — use Add Folder to import music', 5000);
      return { total: 0, folders: 0 };
    }
    let anyDenied = false;
    let totalTracks = 0;
    for (const handle of handles) {
      // Use the two-step permission check (don't rely on verifyPermission which
      // may fail when requestPermission returns 'denied' without user gesture).
      let perm: PermissionState;
      try {
        perm = await handle.queryPermission({ mode: 'read' });
        if (perm === 'prompt') {
          // We have a user gesture (Sync Now button click) — request permission fresh
          perm = await handle.requestPermission({ mode: 'read' });
        }
      } catch {
        perm = 'denied';
      }

      if (perm !== 'granted') {
        anyDenied = true;
        console.warn('[playd] Permission denied for folder:', handle.name);
        continue;
      }
      const count = await scanFolder(handle);
      totalTracks += count;
    }
    if (anyDenied) {
      setStatus('Some folders need re-authorization — open Settings → Sources to re-add them', 8000);
    }
    if (totalTracks > 0) {
      const label = `✓ ${totalTracks} track${totalTracks !== 1 ? 's' : ''} synced to PLAYD`;
      setStatus(label, 8000);
      toast({ title: label });
    }
    return { total: totalTracks, folders: handles.length };
  };

  const importDroppedItems = async (items: DataTransferItemList): Promise<void> => {
    if (!items.length) return;

    // Try File System Access API first (Chrome/Edge) — gives us persistent directory handles
    const fsApiAvailable = typeof (DataTransferItem.prototype as any).getAsFileSystemHandle === 'function';
    if (fsApiAvailable) {
      const itemArray = Array.from(items);
      const dirHandles: FileSystemDirectoryHandle[] = [];
      for (const item of itemArray) {
        if (item.kind !== 'file') continue;
        const handle = await (item as any).getAsFileSystemHandle() as FileSystemHandle | null;
        if (!handle) continue;
        if (handle.kind === 'directory') {
          const dirHandle = handle as FileSystemDirectoryHandle;
          dirHandles.push(dirHandle);
          const existing = await getStoredHandles();
          if (!existing.some(h => h.name === dirHandle.name)) {
            await set('music-folders', [...existing, dirHandle]);
          _invalidateHandleCache();
          }
        }
      }
      if (dirHandles.length > 0) {
        for (const handle of dirHandles) await scanFolder(handle);
        return;
      }
    }

    // Fallback: webkitGetAsEntry — works everywhere for recursive directory reads
    const fileEntries: Array<{ file: File; relativePath: string }> = [];
    const rootEntries: FileSystemEntry[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.();
      if (entry) rootEntries.push(entry);
    }

    async function traverseEntry(entry: FileSystemEntry, basePath: string): Promise<void> {
      if (entry.isFile) {
        await new Promise<void>((resolve) => {
          (entry as FileSystemFileEntry).file((f) => {
            if (isLikelyAudio(f)) {
              fileEntries.push({ file: f, relativePath: `${basePath}/${f.name}` });
            }
            resolve();
          }, () => resolve());
        });
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const subEntries = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject)
        );
        for (const sub of subEntries) {
          await traverseEntry(sub, `${basePath}/${entry.name}`);
        }
      }
    }

    for (const entry of rootEntries) {
      await traverseEntry(entry, entry.name);
    }

    if (fileEntries.length > 0) {
      const rootName = fileEntries[0].relativePath.split('/')[0] || 'Dropped';
      await processTracks(fileEntries, rootName);
    }
  };

  return {
    isScanning,
    scanProgress,
    scanStatus,
    addFolder,
    addFiles,
    loadSampleTrack,
    scanFolder,
    scanFileList,
    rescanAll,
    importDroppedItems,
    getStoredHandles,
    verifyPermission,
    getFileFromPath,
    getFileHandleFromPath,
    getArtForTrack,
  };
}
