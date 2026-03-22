import { useState } from 'react';
import { get, set } from 'idb-keyval';
import * as mm from 'music-metadata-browser';
import { useBulkUpsertTracks, getListTracksQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

const ART_STORE_KEY = 'track-art';
const AUDIO_EXTS = /\.(mp3|flac|m4a|m4p|aac|wav|ogg|opus|webm|wma|aiff|aif|alac|mp4|3gp)$/i;

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

// ─── Detect MIME type from magic bytes ──────────────────────────────────────
async function detectMimeType(file: File): Promise<string | undefined> {
  try {
    const buf = await file.slice(0, 12).arrayBuffer();
    const b = new Uint8Array(buf);
    if (b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg';
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'audio/webm';
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33)                  return 'audio/mpeg';
    if (b[0] === 0xFF && (b[1] === 0xFB || b[1] === 0xF3 || b[1] === 0xF2)) return 'audio/mpeg';
    if (b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43) return 'audio/flac';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'audio/wav';
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'audio/mp4';
    if (b[0] === 0xFF && (b[1] === 0xF1 || b[1] === 0xF9))                return 'audio/aac';
    return undefined;
  } catch {
    return undefined;
  }
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

// ─── music-metadata-browser helpers (for non-OGG formats) ───────────────────
function nativeTag(native: mm.INativeTagDict | undefined, ...keys: string[]): string | undefined {
  if (!native) return undefined;
  for (const [, tagList] of Object.entries(native)) {
    for (const key of keys) {
      const hit = tagList.find(t => t.id.toUpperCase() === key.toUpperCase());
      if (hit?.value) return String(hit.value);
    }
  }
  return undefined;
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
const inMemoryFiles = new Map<string, File>();

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
function isOggFile(fileName: string): boolean {
  return /\.(opus|ogg|oga)$/i.test(fileName);
}
function isMp3File(fileName: string): boolean {
  return /\.mp3$/i.test(fileName);
}

export function useFileSystem() {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('');
  const bulkUpsert = useBulkUpsertTracks();
  const queryClient = useQueryClient();

  const verifyPermission = async (fileHandle: FileSystemHandle, readWrite = false) => {
    const options = { mode: readWrite ? 'readwrite' : 'read' } as any;
    if ((await fileHandle.queryPermission(options)) === 'granted') return true;
    if ((await fileHandle.requestPermission(options)) === 'granted') return true;
    return false;
  };

  const getStoredHandles = async (): Promise<FileSystemDirectoryHandle[]> => {
    return (await get('music-folders')) || [];
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
    setScanStatus(`Scanning ${rootName}…`);

    try {
      const tracks: any[] = [];
      const artStore: Record<string, string> = (await get(ART_STORE_KEY)) || {};
      let count = 0;

      for (const { file, relativePath } of entries) {
        const parts = relativePath.split('/');
        const fileName = parts[parts.length - 1];
        const folderPath = parts.slice(0, -1).join('/') || rootName;

        inMemoryFiles.set(`${folderPath}/${fileName}`, file);

        const fileMeta = parseFilenameMetadata(fileName);

        if (isOggFile(fileName)) {
          // ── Native Vorbis Comment parser ──────────────────────────────────
          // Reads only the beginning of the file (tags are in the 2nd OGG page,
          // typically within the first few KB). We cap at 2 MB to cover large
          // embedded album art without loading entire audio streams into RAM.
          try {
            const tagSliceSize = Math.min(file.size, 2 * 1024 * 1024);
            const tagBuf = await file.slice(0, tagSliceSize).arrayBuffer();
            const bytes = new Uint8Array(tagBuf);
            const tags = parseVorbisComments(bytes);
            const duration = await getOpusDuration(file);

            const artKey = `${folderPath}/${fileName}`;
            if (tags.albumArtDataUrl) {
              artStore[artKey] = tags.albumArtDataUrl;
            }

            tracks.push({
              title: tags.title || fileMeta.title || fileName,
              artist: tags.artist || fileMeta.artist || '',
              album: tags.album || 'Unknown Album',
              year: tags.year ?? null,
              genre: tags.genre ?? null,
              duration: Math.round(duration),
              trackNumber: tags.trackNumber ?? null,
              fileName,
              folderPath,
              albumArtDataUrl: null,
              source: 'local',
            });
          } catch (err) {
            console.error(`[playd] vorbis parse error for "${fileName}":`, err);
            tracks.push({
              title: fileMeta.title || fileName,
              artist: fileMeta.artist || '',
              album: 'Unknown Album',
              year: null, genre: null, duration: 0, trackNumber: null,
              fileName, folderPath, albumArtDataUrl: null, source: 'local',
            });
          }
        } else if (isMp3File(fileName)) {
          // ── Native ID3v2 parser for MP3 files ─────────────────────────────
          try {
            // Read only up to 10 MB for tag parsing — covers even large APIC art
            const tagSliceSize = Math.min(file.size, 10 * 1024 * 1024);
            const tagBuf = await file.slice(0, tagSliceSize).arrayBuffer();
            const bytes = new Uint8Array(tagBuf);
            const tags = parseID3v2(bytes);
            const duration = await getMp3Duration(file);

            const artKey = `${folderPath}/${fileName}`;
            if (tags.albumArtDataUrl) {
              artStore[artKey] = tags.albumArtDataUrl;
            }

            tracks.push({
              title: tags.title || fileMeta.title || fileName,
              artist: tags.artist || fileMeta.artist || '',
              album: tags.album || 'Unknown Album',
              year: tags.year ?? null,
              genre: tags.genre ?? null,
              duration: Math.round(duration),
              trackNumber: tags.trackNumber ?? null,
              fileName,
              folderPath,
              albumArtDataUrl: null,
              source: 'local',
            });
          } catch (err) {
            console.error(`[playd] id3 parse error for "${fileName}":`, err);
            tracks.push({
              title: fileMeta.title || fileName,
              artist: fileMeta.artist || '',
              album: 'Unknown Album',
              year: null, genre: null, duration: 0, trackNumber: null,
              fileName, folderPath, albumArtDataUrl: null, source: 'local',
            });
          }
        } else {
          // ── music-metadata-browser for FLAC, M4A, WAV, etc. ──────────────
          try {
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const mime = await detectMimeType(file);
            const metadata = await mm.parseBuffer(
              uint8Array,
              { mimeType: mime || file.type || undefined, path: file.name, size: file.size },
              { duration: true, skipCovers: false },
            );

            if (metadata.common.picture?.length) {
              const pic = metadata.common.picture[0];
              const artBlob = new Blob([pic.data], { type: pic.format });
              const dataUrl: string = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target?.result as string);
                reader.readAsDataURL(artBlob);
              });
              artStore[relativePath] = dataUrl;
            }

            const artist =
              metadata.common.artist ||
              (metadata.common.artists as string[] | undefined)?.[0] ||
              nativeTag(metadata.native, 'ARTIST', 'artist') ||
              fileMeta.artist || '';

            const title =
              metadata.common.title ||
              nativeTag(metadata.native, 'TITLE', 'title') ||
              fileMeta.title || fileName;

            tracks.push({
              title,
              artist,
              album: metadata.common.album || nativeTag(metadata.native, 'ALBUM') || 'Unknown Album',
              year: metadata.common.year || null,
              genre: metadata.common.genre?.[0] || nativeTag(metadata.native, 'GENRE') || null,
              duration: Math.round(metadata.format.duration || 0),
              trackNumber: (() => {
                const n = metadata.common.track?.no;
                if (n && n > 0) return n;
                const raw = nativeTag(metadata.native, 'TRACKNUMBER', 'tracknumber');
                const parsed = raw ? parseInt(raw, 10) : NaN;
                return isNaN(parsed) || parsed <= 0 ? null : parsed;
              })(),
              fileName,
              folderPath,
              albumArtDataUrl: null,
              source: 'local',
            });
          } catch (err) {
            console.error(`[playd] metadata parse error for "${fileName}":`, err);
            tracks.push({
              title: fileMeta.title || fileName,
              artist: fileMeta.artist || '',
              album: 'Unknown Album',
              year: null, genre: null, duration: 0, trackNumber: null,
              fileName, folderPath, albumArtDataUrl: null, source: 'local',
            });
          }
        }

        count++;
        setScanProgress(count);
        setScanStatus(`Scanning ${rootName}… (${count} files loaded)`);
      }

      await set(ART_STORE_KEY, artStore);

      if (tracks.length === 0) {
        const extInfo = skippedExts && skippedExts.length > 0
          ? ` Found: ${[...new Set(skippedExts)].slice(0, 6).join(', ')}`
          : '';
        setScanStatus(`No audio files found.${extInfo}`);
        setTimeout(() => setScanStatus(''), 8000);
        return;
      }

      setScanStatus(`Saving ${tracks.length} tracks to library…`);
      await bulkUpsert.mutateAsync({ data: { tracks } });

      await queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });
      setScanStatus(`✓ ${tracks.length} tracks imported successfully`);
      setTimeout(() => setScanStatus(''), 8000);
    } catch (error) {
      console.error('Scan failed', error);
      setScanStatus('Scan failed — see console for details');
      setTimeout(() => setScanStatus(''), 5000);
    } finally {
      setIsScanning(false);
    }
  };

  const scanFolder = async (dirHandle: FileSystemDirectoryHandle) => {
    const entries: Array<{ file: File; relativePath: string }> = [];
    const skippedExts: string[] = [];

    const hasPermission = await verifyPermission(dirHandle);
    if (!hasPermission) {
      setScanStatus('Permission denied');
      return;
    }

    async function walk(handle: FileSystemDirectoryHandle, path: string) {
      for await (const entry of (handle as any).values()) {
        if (entry.kind === 'directory') {
          await walk(entry, `${path}/${entry.name}`);
        } else if (entry.kind === 'file') {
          const file = await entry.getFile();
          if (isLikelyAudio(file)) {
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
      inMemoryFiles.set(relativePath, file);
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
    if (inMemoryFiles.has(memKey)) return inMemoryFiles.get(memKey)!;

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

  return {
    isScanning,
    scanProgress,
    scanStatus,
    addFolder,
    addFiles,
    loadSampleTrack,
    scanFolder,
    scanFileList,
    getStoredHandles,
    verifyPermission,
    getFileFromPath,
    getArtForTrack,
  };
}
