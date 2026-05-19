/**
 * Local track store — replaces the @workspace/api-client-react API layer.
 * Tracks are persisted to IndexedDB via idb-keyval.
 * Playlists are stored locally as well.
 *
 * No auth, no JWT, no API server. Everything is client-side only.
 */

import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';

// ── Safe IndexedDB write helper ──────────────────────────────────────────
// Catches QuotaExceededError and surfaces it to the user
async function safeIdbSet<T>(key: string, value: T): Promise<void> {
  try {
    await idbSet(key, value);
  } catch (err) {
    if (isQuotaExceededError(err)) {
      console.error(
        `[playd] IndexedDB write failed: storage quota exceeded for key "${key}". ` +
        `Try clearing old data or freeing disk space.`
      );
      // Dispatch a custom event so the UI can show a banner if desired
      window.dispatchEvent(
        new CustomEvent('playd:storage-quota-exceeded', {
          detail: { key, message: 'Storage is full. Try removing some tracks or clearing app data.' },
        })
      );
    } else {
      console.error(`[playd] IndexedDB write failed for key "${key}":`, err);
      throw err;
    }
  }
}

function isQuotaExceededError(err: unknown): boolean {
  if (err instanceof DOMException) {
    // QuotaExceededError has code 22 in older browsers, name 'QuotaExceededError' in modern ones
    return err.name === 'QuotaExceededError' || err.code === 22;
  }
  if (err instanceof Error) {
    return (
      /quota/i.test(err.message) ||
      /exceeded/i.test(err.message) ||
      /storage/i.test(err.message) ||
      /no space/i.test(err.message)
    );
  }
  return false;
}

// ── Track type (matches what use-file-system produces) ───────────────────

export interface LocalTrack {
  id: number;
  title: string;
  artist: string;
  album: string;
  year: number | null;
  genre: string | null;
  duration: number;
  trackNumber: number | null;
  fileName: string;
  folderPath: string;
  albumArtDataUrl: string | null;
  rating: number;
  source: 'local'; // always local now
  replaygainGain: number | null;
  /** CUE sheet: offset into the audio file where this track starts (seconds) */
  cueOffset: number | null;
  /** CUE sheet: actual duration of this segment (seconds), null means full file */
  cueDuration: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SmartPlaylistRule {
  field: 'title' | 'artist' | 'album' | 'genre' | 'year' | 'trackNumber' | 'duration' | 'rating';
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startsWith' | 'endsWith';
  value: string | number;
}

export interface PlaylistFolder {
  id: number;
  name: string;
  parentId: number | null; // null = root-level folder; nested 1 level deep
}

export interface LocalPlaylist {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  isSmart?: boolean;
  rules?: SmartPlaylistRule[];
  matchMode?: 'all' | 'any';
  folderId?: number | null; // links to PlaylistFolder.id
}

export interface LocalPlaylistTrack {
  playlistId: number;
  trackId: number;
  position: number;
}

export interface LocalEqPreset {
  id: number;
  name: string;
  bands: string; // JSON string of number[]
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

const TRACKS_KEY = 'local-tracks';
const PLAYLISTS_KEY = 'local-playlists';
const PLAYLIST_TRACKS_KEY = 'local-playlist-tracks';
const EQ_PRESETS_KEY = 'local-eq-presets';
const PLAYLIST_FOLDERS_KEY = 'playlist-folders';

// ── Built-in EQ presets (10-band) ──────────────────────────────────────

const BUILTIN_EQ_PRESETS: Omit<LocalEqPreset, 'id'>[] = [
  { name: 'Flat', bands: '[0,0,0,0,0,0,0,0,0,0]', isBuiltin: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { name: 'Rock', bands: '[5,4,3,2,1,0,-1,-2,-3,-4]', isBuiltin: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { name: 'Pop', bands: '[-2,-1,0,2,4,4,2,0,-1,-2]', isBuiltin: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { name: 'Jazz', bands: '[4,3,1,2,-1,-2,0,1,3,4]', isBuiltin: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { name: 'Classical', bands: '[5,4,3,2,1,0,0,0,0,0]', isBuiltin: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { name: 'Hip-Hop', bands: '[5,4,0,2,4,4,0,2,2,3]', isBuiltin: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { name: 'Electronic', bands: '[4,3,0,0,-2,1,0,2,4,5]', isBuiltin: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { name: 'Vocal Boost', bands: '[-1,-2,-3,-2,1,4,4,3,2,1]', isBuiltin: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { name: 'Bass Boost', bands: '[6,5,4,3,2,0,0,0,0,0]', isBuiltin: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { name: 'Treble Boost', bands: '[0,0,0,0,0,2,4,5,6,7]', isBuiltin: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

let _nextPresetId = 1000;
const nextPresetId = () => ++_nextPresetId;

// ── ID helpers ───────────────────────────────────────────────────────────

let _trackIdCounter = Date.now();
function nextTrackId(): number {
  _trackIdCounter += 1;
  return _trackIdCounter;
}

let _playlistIdCounter = Date.now() + 100000;
function nextPlaylistId(): number {
  _playlistIdCounter += 1;
  return _playlistIdCounter;
}

// ── Store interface ──────────────────────────────────────────────────────

interface TrackStoreState {
  tracks: LocalTrack[];
  playlists: LocalPlaylist[];
  playlistTracks: LocalPlaylistTrack[];
  loaded: boolean;
  loading: boolean;

  // Tracks
  loadTracks: () => Promise<void>;
  upsertTracks: (incoming: Omit<LocalTrack, 'id' | 'createdAt' | 'updatedAt'>[]) => Promise<LocalTrack[]>;
  updateTrack: (id: number, patch: Partial<LocalTrack>) => Promise<void>;
  deleteTracks: (ids: number[]) => Promise<void>;
  clearTracks: () => Promise<void>;
  getTracksForPlaylist: (playlistId: number) => LocalTrack[];

  // Playlists
  loadPlaylists: () => Promise<void>;
  createPlaylist: (name: string, isSmart?: boolean, rules?: SmartPlaylistRule[], matchMode?: 'all' | 'any', folderId?: number | null) => Promise<LocalPlaylist>;
  updatePlaylist: (id: number, name: string, folderId?: number | null) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
  addTrackToPlaylist: (playlistId: number, trackId: number) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: number, trackId: number) => Promise<void>;
  reorderPlaylistTrack: (playlistId: number, trackId: number, newPosition: number) => Promise<void>;
  evaluateSmartPlaylist: (playlistId: number) => Promise<void>;

  // Playlist Folders
  playlistFolders: PlaylistFolder[];
  loadPlaylistFolders: () => Promise<void>;
  createPlaylistFolder: (name: string, parentId?: number | null) => Promise<PlaylistFolder>;
  renamePlaylistFolder: (id: number, name: string) => Promise<void>;
  deletePlaylistFolder: (id: number) => Promise<void>;
  getPlaylistsInFolder: (folderId: number | null) => LocalPlaylist[];
  getFolders: (parentId: number | null) => PlaylistFolder[];

  // EQ Presets
  eqPresets: LocalEqPreset[];
  loadEqPresets: () => Promise<void>;
  createEqPreset: (name: string, bands: string) => Promise<LocalEqPreset>;
  deleteEqPreset: (id: number) => Promise<void>;
}

export const useTrackStore = create<TrackStoreState>((set, get) => ({
  tracks: [],
  playlists: [],
  playlistTracks: [],
  eqPresets: [],
  playlistFolders: [],
  loaded: false,
  loading: false,

  // ── Tracks ───────────────────────────────────────────────────────────

  loadTracks: async () => {
    set({ loading: true });
    try {
      const stored = await idbGet<LocalTrack[]>(TRACKS_KEY);
      set({ tracks: stored ?? [], loaded: true, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  upsertTracks: async (incoming) => {
    const now = new Date().toISOString();
    const current = get().tracks;
    const newTracks: LocalTrack[] = [];

    for (const inc of incoming) {
      // Match by folderPath + fileName
      const existing = current.find(
        t => t.folderPath === inc.folderPath && t.fileName === inc.fileName
      );
      if (existing) {
        Object.assign(existing, inc, { updatedAt: now });
        newTracks.push(existing);
      } else {
        const nt: LocalTrack = {
          ...inc,
          id: nextTrackId(),
          createdAt: now,
          updatedAt: now,
        } as LocalTrack;
        current.push(nt);
        newTracks.push(nt);
      }
    }

    await safeIdbSet(TRACKS_KEY, current);
    set({ tracks: [...current] });
    return newTracks;
  },

  updateTrack: async (id, patch) => {
    const current = get().tracks;
    const idx = current.findIndex(t => t.id === id);
    if (idx < 0) return;
    current[idx] = { ...current[idx], ...patch, updatedAt: new Date().toISOString() };
    await safeIdbSet(TRACKS_KEY, current);
    set({ tracks: [...current] });
  },

  deleteTracks: async (ids) => {
    const idSet = new Set(ids);
    const current = get().tracks.filter(t => !idSet.has(t.id));
    // Also remove from playlistTracks
    const pt = get().playlistTracks.filter(t => !idSet.has(t.trackId));
    await safeIdbSet(TRACKS_KEY, current);
    await safeIdbSet(PLAYLIST_TRACKS_KEY, pt);
    set({ tracks: current, playlistTracks: pt });
  },

  clearTracks: async () => {
    await safeIdbSet(TRACKS_KEY, []);
    set({ tracks: [] });
  },

  getTracksForPlaylist: (playlistId) => {
    const { tracks, playlistTracks } = get();
    const ptIds = new Set(
      (playlistTracks ?? [])
        .filter(pt => pt.playlistId === playlistId)
        .sort((a, b) => a.position - b.position)
        .map(pt => pt.trackId)
    );
    return tracks.filter(t => ptIds.has(t.id));
  },

  // ── Playlists ─────────────────────────────────────────────────────────

  loadPlaylists: async () => {
    try {
      const pl = await idbGet<LocalPlaylist[]>(PLAYLISTS_KEY);
      const pt = await idbGet<LocalPlaylistTrack[]>(PLAYLIST_TRACKS_KEY);
      const folders = await idbGet<PlaylistFolder[]>(PLAYLIST_FOLDERS_KEY);
      set({ playlists: pl ?? [], playlistTracks: pt ?? [], playlistFolders: folders ?? [] });
    } catch {}
  },

  createPlaylist: async (name, isSmart = false, rules = [], matchMode = 'all', folderId = null) => {
    const now = new Date().toISOString();
    const pl: LocalPlaylist = { id: nextPlaylistId(), name, createdAt: now, updatedAt: now, isSmart, rules, matchMode, folderId };
    const playlists = [...get().playlists, pl];
    await safeIdbSet(PLAYLISTS_KEY, playlists);
    set({ playlists });
    return pl;
  },

  updatePlaylist: async (id, name, folderId?) => {
    const playlists = (get().playlists ?? []).map(p =>
      p.id === id ? { ...p, name, folderId: folderId !== undefined ? folderId : p.folderId, updatedAt: new Date().toISOString() } : p
    );
    await safeIdbSet(PLAYLISTS_KEY, playlists);
    set({ playlists });
  },

  deletePlaylist: async (id) => {
    const playlists = get().playlists.filter(p => p.id !== id);
    const pt = get().playlistTracks.filter(p => p.playlistId !== id);
    await safeIdbSet(PLAYLISTS_KEY, playlists);
    await safeIdbSet(PLAYLIST_TRACKS_KEY, pt);
    set({ playlists, playlistTracks: pt });
  },

  // ── Playlist Folders ───────────────────────────────────────────────────

  loadPlaylistFolders: async () => {
    try {
      const folders = await idbGet<PlaylistFolder[]>(PLAYLIST_FOLDERS_KEY);
      set({ playlistFolders: folders ?? [] });
    } catch {}
  },

  createPlaylistFolder: async (name, parentId = null) => {
    const folder: PlaylistFolder = {
      id: nextPlaylistId(), // re-use playlist ID counter (simple enough)
      name,
      parentId: parentId ?? null,
    };
    const folders = [...get().playlistFolders, folder];
    await safeIdbSet(PLAYLIST_FOLDERS_KEY, folders);
    set({ playlistFolders: folders });
    return folder;
  },

  renamePlaylistFolder: async (id, name) => {
    const folders = get().playlistFolders.map(f =>
      f.id === id ? { ...f, name } : f
    );
    await safeIdbSet(PLAYLIST_FOLDERS_KEY, folders);
    set({ playlistFolders: folders });
  },

  deletePlaylistFolder: async (id) => {
    const { playlists, playlistFolders } = get();
    // Remove folder from playlists that reference it
    const updatedPlaylists = playlists.map(p =>
      p.folderId === id ? { ...p, folderId: null } : p
    );
    // Also delete any sub-folders (cascade)
    const subIds = new Set<number>();
    subIds.add(id);
    for (const f of playlistFolders) {
      if (f.parentId === id) subIds.add(f.id);
    }
    const updatedFolders = playlistFolders.filter(f => !subIds.has(f.id));
    await safeIdbSet(PLAYLISTS_KEY, updatedPlaylists);
    await safeIdbSet(PLAYLIST_FOLDERS_KEY, updatedFolders);
    set({ playlists: updatedPlaylists, playlistFolders: updatedFolders });
  },

  getPlaylistsInFolder: (folderId) => {
    return get().playlists.filter(p => p.folderId === folderId);
  },

  getFolders: (parentId) => {
    return get().playlistFolders.filter(f => f.parentId === parentId);
  },

  addTrackToPlaylist: async (playlistId, trackId) => {
    const pt = get().playlistTracks;
    const playlistItems = pt.filter(p => p.playlistId === playlistId);
    const existing = playlistItems.find(p => p.trackId === trackId);
    if (existing) return; // already in playlist
    const maxPos = playlistItems.reduce((max, p) => Math.max(max, p.position), -1);
    const newPt = [...pt, { playlistId, trackId, position: maxPos + 1 }];
    await safeIdbSet(PLAYLIST_TRACKS_KEY, newPt);
    set({ playlistTracks: newPt });
  },

  removeTrackFromPlaylist: async (playlistId, trackId) => {
    const pt = get().playlistTracks.filter(
      p => !(p.playlistId === playlistId && p.trackId === trackId)
    );
    await safeIdbSet(PLAYLIST_TRACKS_KEY, pt);
    set({ playlistTracks: pt });
  },

  reorderPlaylistTrack: async (playlistId, trackId, newPosition) => {
    const pt = [...get().playlistTracks];
    const items = pt.filter(p => p.playlistId === playlistId).sort((a, b) => a.position - b.position);
    const idx = items.findIndex(p => p.trackId === trackId);
    if (idx < 0) return;
    const [moved] = items.splice(idx, 1);
    items.splice(newPosition, 0, moved);
    const updated = items.map((p, i) => ({ ...p, position: i }));
    const other = pt.filter(p => p.playlistId !== playlistId);
    const newPt = [...other, ...updated];
    await safeIdbSet(PLAYLIST_TRACKS_KEY, newPt);
    set({ playlistTracks: newPt });
  },

  evaluateSmartPlaylist: async (playlistId) => {
    const { playlists, tracks } = get();
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl || !pl.isSmart || !pl.rules || pl.rules.length === 0) return;

    // Numeric fields that should use Number comparison (not string coercion)
    const NUMERIC_FIELDS = new Set(['year', 'trackNumber', 'duration', 'rating'] as const);

    const matched = tracks.filter(t => {
      const results = pl.rules!.map(rule => {
        const field = rule.field;
        const ruleValue = rule.value;

        if (NUMERIC_FIELDS.has(field as typeof NUMERIC_FIELDS extends Set<infer E> ? E : never)) {
          // Numeric comparison with proper type guards
          const trackVal: number = typeof t[field as keyof typeof t] === 'number'
            ? (t[field as keyof typeof t] as number)
            : (t[field as keyof typeof t] != null ? Number(t[field as keyof typeof t]) : NaN);
          const ruleNum: number = typeof ruleValue === 'number' ? ruleValue : Number(ruleValue);

          if (isNaN(trackVal) || isNaN(ruleNum)) return false;

          switch (rule.op) {
            case 'eq':  return trackVal === ruleNum;
            case 'neq': return trackVal !== ruleNum;
            case 'gt':  return trackVal > ruleNum;
            case 'gte': return trackVal >= ruleNum;
            case 'lt':  return trackVal < ruleNum;
            case 'lte': return trackVal <= ruleNum;
            default:    return false; // contains/startsWith/endsWith not valid for numeric
          }
        }

        // String comparison for text fields (title, artist, album, genre)
        const val: string = t[field as keyof typeof t] != null ? String(t[field as keyof typeof t]) : '';
        const ruleVal: string = String(ruleValue);

        const STRING_OPS = new Set(['eq', 'neq', 'contains', 'startsWith', 'endsWith']);
        if (!(STRING_OPS as Set<string>).has(rule.op)) return false; // gt/gte/lt/lte invalid on strings

        switch (rule.op) {
          case 'eq':        return val.toLowerCase() === ruleVal.toLowerCase();
          case 'neq':       return val.toLowerCase() !== ruleVal.toLowerCase();
          case 'contains':  return val.toLowerCase().includes(ruleVal.toLowerCase());
          case 'startsWith': return val.toLowerCase().startsWith(ruleVal.toLowerCase());
          case 'endsWith':  return val.toLowerCase().endsWith(ruleVal.toLowerCase());
          default:          return false;
        }
      });
      return pl.matchMode === 'all' ? results.every(Boolean) : results.some(Boolean);
    });
    const existing = get().playlistTracks.filter(p => p.playlistId !== playlistId);
    const newPt = [...existing, ...matched.map((t, i) => ({ playlistId, trackId: t.id, position: i }))];
    await safeIdbSet(PLAYLIST_TRACKS_KEY, newPt);
    set({ playlistTracks: newPt });
  },

  // ── EQ Presets ────────────────────────────────────────────────────────

  loadEqPresets: async () => {
    try {
      const stored = await idbGet<LocalEqPreset[]>(EQ_PRESETS_KEY);
      if (stored && stored.length > 0) {
        set({ eqPresets: stored });
      } else {
        // First load — seed with builtins
        const builtins: LocalEqPreset[] = BUILTIN_EQ_PRESETS.map((p) => ({
          ...p,
          id: nextPresetId(),
        }));
        await safeIdbSet(EQ_PRESETS_KEY, builtins);
        set({ eqPresets: builtins });
      }
    } catch {
      // Fallback: use builtins in-memory
      set({ eqPresets: BUILTIN_EQ_PRESETS.map((p) => ({ ...p, id: nextPresetId() })) });
    }
  },

  createEqPreset: async (name, bands) => {
    const preset: LocalEqPreset = { id: nextPresetId(), name, bands, isBuiltin: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const eqPresets = [...get().eqPresets, preset];
    await safeIdbSet(EQ_PRESETS_KEY, eqPresets);
    set({ eqPresets });
    return preset;
  },

  deleteEqPreset: async (id) => {
    const eqPresets = get().eqPresets.filter(p => p.id !== id);
    await safeIdbSet(EQ_PRESETS_KEY, eqPresets);
    set({ eqPresets });
  },
}));

export type Track = LocalTrack;
