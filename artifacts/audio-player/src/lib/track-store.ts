/**
 * Local track store — replaces the @workspace/api-client-react API layer.
 * Tracks are persisted to IndexedDB via idb-keyval.
 * Playlists are stored locally as well.
 *
 * No auth, no JWT, no API server. Everything is client-side only.
 */

import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';

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

    await idbSet(TRACKS_KEY, current);
    set({ tracks: [...current] });
    return newTracks;
  },

  updateTrack: async (id, patch) => {
    const current = get().tracks;
    const idx = current.findIndex(t => t.id === id);
    if (idx < 0) return;
    current[idx] = { ...current[idx], ...patch, updatedAt: new Date().toISOString() };
    await idbSet(TRACKS_KEY, current);
    set({ tracks: [...current] });
  },

  deleteTracks: async (ids) => {
    const idSet = new Set(ids);
    const current = get().tracks.filter(t => !idSet.has(t.id));
    // Also remove from playlistTracks
    const pt = get().playlistTracks.filter(t => !idSet.has(t.trackId));
    await idbSet(TRACKS_KEY, current);
    await idbSet(PLAYLIST_TRACKS_KEY, pt);
    set({ tracks: current, playlistTracks: pt });
  },

  clearTracks: async () => {
    await idbSet(TRACKS_KEY, []);
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
    await idbSet(PLAYLISTS_KEY, playlists);
    set({ playlists });
    return pl;
  },

  updatePlaylist: async (id, name, folderId?) => {
    const playlists = (get().playlists ?? []).map(p =>
      p.id === id ? { ...p, name, folderId: folderId !== undefined ? folderId : p.folderId, updatedAt: new Date().toISOString() } : p
    );
    await idbSet(PLAYLISTS_KEY, playlists);
    set({ playlists });
  },

  deletePlaylist: async (id) => {
    const playlists = get().playlists.filter(p => p.id !== id);
    const pt = get().playlistTracks.filter(p => p.playlistId !== id);
    await idbSet(PLAYLISTS_KEY, playlists);
    await idbSet(PLAYLIST_TRACKS_KEY, pt);
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
    await idbSet(PLAYLIST_FOLDERS_KEY, folders);
    set({ playlistFolders: folders });
    return folder;
  },

  renamePlaylistFolder: async (id, name) => {
    const folders = get().playlistFolders.map(f =>
      f.id === id ? { ...f, name } : f
    );
    await idbSet(PLAYLIST_FOLDERS_KEY, folders);
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
    await idbSet(PLAYLISTS_KEY, updatedPlaylists);
    await idbSet(PLAYLIST_FOLDERS_KEY, updatedFolders);
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
    await idbSet(PLAYLIST_TRACKS_KEY, newPt);
    set({ playlistTracks: newPt });
  },

  removeTrackFromPlaylist: async (playlistId, trackId) => {
    const pt = get().playlistTracks.filter(
      p => !(p.playlistId === playlistId && p.trackId === trackId)
    );
    await idbSet(PLAYLIST_TRACKS_KEY, pt);
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
    await idbSet(PLAYLIST_TRACKS_KEY, newPt);
    set({ playlistTracks: newPt });
  },

  evaluateSmartPlaylist: async (playlistId) => {
    const { playlists, tracks } = get();
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl || !pl.isSmart || !pl.rules || pl.rules.length === 0) return;
    const matched = tracks.filter(t => {
      const results = pl.rules!.map(rule => {
        const val = String(t[rule.field as keyof typeof t] ?? '');
        const ruleVal = String(rule.value);
        switch (rule.op) {
          case 'eq': return val.toLowerCase() === ruleVal.toLowerCase();
          case 'neq': return val.toLowerCase() !== ruleVal.toLowerCase();
          case 'gt': return Number(val) > Number(ruleVal);
          case 'gte': return Number(val) >= Number(ruleVal);
          case 'lt': return Number(val) < Number(ruleVal);
          case 'lte': return Number(val) <= Number(ruleVal);
          case 'contains': return val.toLowerCase().includes(ruleVal.toLowerCase());
          case 'startsWith': return val.toLowerCase().startsWith(ruleVal.toLowerCase());
          case 'endsWith': return val.toLowerCase().endsWith(ruleVal.toLowerCase());
          default: return false;
        }
      });
      return pl.matchMode === 'all' ? results.every(Boolean) : results.some(Boolean);
    });
    const existing = get().playlistTracks.filter(p => p.playlistId !== playlistId);
    const newPt = [...existing, ...matched.map((t, i) => ({ playlistId, trackId: t.id, position: i }))];
    await idbSet(PLAYLIST_TRACKS_KEY, newPt);
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
        await idbSet(EQ_PRESETS_KEY, builtins);
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
    await idbSet(EQ_PRESETS_KEY, eqPresets);
    set({ eqPresets });
    return preset;
  },

  deleteEqPreset: async (id) => {
    const eqPresets = get().eqPresets.filter(p => p.id !== id);
    await idbSet(EQ_PRESETS_KEY, eqPresets);
    set({ eqPresets });
  },
}));

export type Track = LocalTrack;
