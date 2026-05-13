/**
 * Local track store — replaces the @workspace/api-client-react API layer.
 * Tracks are persisted to IndexedDB via idb-keyval.
 * Playlists are stored locally as well.
 *
 * No auth, no JWT, no API server. Everything is client-side only.
 */

import { create } from 'zustand';
import { get, set } from 'idb-keyval';

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
  subsonicId: string | null;
  subsonicServerId: number | null;
  replaygainGain: number | null;
  vaultEncryptedKey?: string | null;
  vaultKeyIv?: string | null;
  vaultDataIv?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalPlaylist {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
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
  createPlaylist: (name: string) => Promise<LocalPlaylist>;
  updatePlaylist: (id: number, name: string) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
  addTrackToPlaylist: (playlistId: number, trackId: number) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: number, trackId: number) => Promise<void>;

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
  loaded: false,
  loading: false,

  // ── Tracks ───────────────────────────────────────────────────────────

  loadTracks: async () => {
    set({ loading: true });
    try {
      const stored = await get<LocalTrack[]>(TRACKS_KEY);
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
          id: inc.id ?? nextTrackId(),
          createdAt: now,
          updatedAt: now,
        } as LocalTrack;
        current.push(nt);
        newTracks.push(nt);
      }
    }

    await set(TRACKS_KEY, current);
    set({ tracks: [...current] });
    return newTracks;
  },

  updateTrack: async (id, patch) => {
    const current = get().tracks;
    const idx = current.findIndex(t => t.id === id);
    if (idx < 0) return;
    current[idx] = { ...current[idx], ...patch, updatedAt: new Date().toISOString() };
    await set(TRACKS_KEY, current);
    set({ tracks: [...current] });
  },

  deleteTracks: async (ids) => {
    const idSet = new Set(ids);
    const current = get().tracks.filter(t => !idSet.has(t.id));
    // Also remove from playlistTracks
    const pt = get().playlistTracks.filter(t => !idSet.has(t.trackId));
    await set(TRACKS_KEY, current);
    await set(PLAYLIST_TRACKS_KEY, pt);
    set({ tracks: current, playlistTracks: pt });
  },

  clearTracks: async () => {
    await set(TRACKS_KEY, []);
    set({ tracks: [] });
  },

  getTracksForPlaylist: (playlistId) => {
    const { tracks, playlistTracks } = get();
    const ptIds = new Set(
      playlistTracks
        .filter(pt => pt.playlistId === playlistId)
        .sort((a, b) => a.position - b.position)
        .map(pt => pt.trackId)
    );
    return tracks.filter(t => ptIds.has(t.id));
  },

  // ── Playlists ─────────────────────────────────────────────────────────

  loadPlaylists: async () => {
    try {
      const pl = await get<LocalPlaylist[]>(PLAYLISTS_KEY);
      const pt = await get<LocalPlaylistTrack[]>(PLAYLIST_TRACKS_KEY);
      set({ playlists: pl ?? [], playlistTracks: pt ?? [] });
    } catch {}
  },

  createPlaylist: async (name) => {
    const now = new Date().toISOString();
    const pl: LocalPlaylist = { id: nextPlaylistId(), name, createdAt: now, updatedAt: now };
    const playlists = [...get().playlists, pl];
    await set(PLAYLISTS_KEY, playlists);
    set({ playlists });
    return pl;
  },

  updatePlaylist: async (id, name) => {
    const playlists = get().playlists.map(p =>
      p.id === id ? { ...p, name, updatedAt: new Date().toISOString() } : p
    );
    await set(PLAYLISTS_KEY, playlists);
    set({ playlists });
  },

  deletePlaylist: async (id) => {
    const playlists = get().playlists.filter(p => p.id !== id);
    const pt = get().playlistTracks.filter(p => p.playlistId !== id);
    await set(PLAYLISTS_KEY, playlists);
    await set(PLAYLIST_TRACKS_KEY, pt);
    set({ playlists, playlistTracks: pt });
  },

  addTrackToPlaylist: async (playlistId, trackId) => {
    const pt = get().playlistTracks;
    const playlistItems = pt.filter(p => p.playlistId === playlistId);
    const existing = playlistItems.find(p => p.trackId === trackId);
    if (existing) return; // already in playlist
    const maxPos = playlistItems.reduce((max, p) => Math.max(max, p.position), -1);
    const newPt = [...pt, { playlistId, trackId, position: maxPos + 1 }];
    await set(PLAYLIST_TRACKS_KEY, newPt);
    set({ playlistTracks: newPt });
  },

  removeTrackFromPlaylist: async (playlistId, trackId) => {
    const pt = get().playlistTracks.filter(
      p => !(p.playlistId === playlistId && p.trackId === trackId)
    );
    await set(PLAYLIST_TRACKS_KEY, pt);
    set({ playlistTracks: pt });
  },

  // ── EQ Presets ────────────────────────────────────────────────────────

  eqPresets: [],

  loadEqPresets: async () => {
    try {
      const stored = await get<LocalEqPreset[]>(EQ_PRESETS_KEY);
      if (stored && stored.length > 0) {
        set({ eqPresets: stored });
      } else {
        // First load — seed with builtins
        const builtins: LocalEqPreset[] = BUILTIN_EQ_PRESETS.map((p) => ({
          ...p,
          id: nextPresetId(),
        }));
        await set(EQ_PRESETS_KEY, builtins);
        set({ eqPresets: builtins });
      }
    } catch {
      // Fallback: use builtins in-memory
      set({ eqPresets: BUILTIN_EQ_PRESETS.map((p) => ({ ...p, id: nextPresetId() })) });
    }
  },

  createEqPreset: async (name, bands) => {
    const preset: LocalEqPreset = { id: nextPresetId(), name, bands, isBuiltin: false };
    const eqPresets = [...get().eqPresets, preset];
    await set(EQ_PRESETS_KEY, eqPresets);
    set({ eqPresets });
    return preset;
  },

  deleteEqPreset: async (id) => {
    const eqPresets = get().eqPresets.filter(p => p.id !== id);
    await set(EQ_PRESETS_KEY, eqPresets);
    set({ eqPresets });
  },
}));

export type Track = LocalTrack;
