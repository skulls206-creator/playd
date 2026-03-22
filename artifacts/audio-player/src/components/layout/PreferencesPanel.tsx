import { useState, useEffect, useRef, useCallback } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';
import {
  useListSubsonicServers,
  useCreateSubsonicServer,
  useUpdateSubsonicServer,
  useDeleteSubsonicServer,
  useListEqPresets,
  useCreateEqPreset,
  useDeleteEqPreset,
  getListEqPresetsQueryKey,
  getListSubsonicServersQueryKey,
  getListTracksQueryKey,
  customFetch,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  FolderOpen, RefreshCw, Trash2, Plus, Server, CheckCircle2,
  XCircle, Loader2, ChevronDown, ChevronUp, Info, HardDrive,
  Cloud, Database, Monitor, Save, FileMusic, Bell, BellOff
} from 'lucide-react';
import { clsx } from 'clsx';
import { get, del, set } from 'idb-keyval';
import {
  notificationsEnabled,
  setNotificationsEnabled,
  requestNotificationPermission,
} from '@/hooks/use-now-playing-notification';

interface SubsonicFormState {
  name: string;
  url: string;
  username: string;
  password: string;
}

const EMPTY_SUBSONIC: SubsonicFormState = { name: '', url: '', username: '', password: '' };

// ── Client-side Subsonic helpers ──────────────────────────────────────────────
interface SubsonicConfig { id: number; name: string; url: string; username: string; password: string }

function buildSubsonicUrl(cfg: Omit<SubsonicConfig, 'id' | 'name'>, endpoint: string, extra?: Record<string, string | number>) {
  const base = cfg.url.replace(/\/$/, '');
  const params = new URLSearchParams({ v: '1.16.1', c: 'playd', f: 'json', u: cfg.username, p: cfg.password, ...Object.fromEntries(Object.entries(extra ?? {}).map(([k, v]) => [k, String(v)])) });
  return `${base}/rest/${endpoint}?${params}`;
}

async function subsonicApiFetch(url: string): Promise<any> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json() as any;
  const sub = data?.['subsonic-response'];
  if (sub?.status !== 'ok') throw new Error(sub?.error?.message ?? 'Subsonic API error');
  return sub;
}

async function fetchSubsonicConfig(id: number): Promise<SubsonicConfig> {
  return customFetch<SubsonicConfig>(`/api/subsonic-servers/${id}/config`);
}

export function PreferencesPanel() {
  const { isPrefsOpen, togglePrefs, eqBands, setActiveEqPreset } = useAudioPlayer();
  const { loadSampleTrack, scanFileList, isScanning, scanStatus } = useFileSystem();

  // Hidden file inputs — clicked directly by buttons to preserve browser user-gesture.
  // Dynamic input.click() inside async functions loses the gesture context in sandboxed
  // iframes, causing the picker to silently do nothing.
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef  = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Subsonic
  const { data: servers = [] } = useListSubsonicServers();
  const createServer = useCreateSubsonicServer();
  const updateServer = useUpdateSubsonicServer();
  const deleteServer = useDeleteSubsonicServer();

  // EQ Presets
  const { data: presets = [] } = useListEqPresets();
  const createPreset = useCreateEqPreset();
  const deletePreset = useDeleteEqPreset();

  // Local folders — stored as plain name strings (webkitdirectory gives no persistent handle)
  const [localFolders, setLocalFolders] = useState<string[]>([]);
  const [scanningFolderName, setScanningFolderName] = useState<string | null>(null);
  const [clearingLibrary, setClearingLibrary] = useState(false);
  const [clearingSubsonic, setClearingSubsonic] = useState(false);

  // Subsonic form state
  const [showSubsonicForm, setShowSubsonicForm] = useState(false);
  const [editingServerId, setEditingServerId] = useState<number | null>(null);
  const [subsonicForm, setSubsonicForm] = useState<SubsonicFormState>(EMPTY_SUBSONIC);
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; msg: string } | 'loading'>>({});
  const [syncStates, setSyncStates] = useState<Record<number, { status: 'idle' | 'syncing' | 'done' | 'error'; msg?: string }>>({});

  // EQ save form
  const [newPresetName, setNewPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);

  // Notifications
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied'
  );
  const [notifOn, setNotifOn] = useState(notificationsEnabled);

  const handleRequestNotifPermission = useCallback(async () => {
    const perm = await requestNotificationPermission();
    setNotifPermission(perm);
    if (perm === 'granted') {
      setNotificationsEnabled(true);
      setNotifOn(true);
    }
  }, []);

  const handleToggleNotif = useCallback((val: boolean) => {
    setNotificationsEnabled(val);
    setNotifOn(val);
  }, []);

  useEffect(() => {
    if (isPrefsOpen) {
      loadLocalFolders();
    }
  }, [isPrefsOpen]);

  const loadLocalFolders = async () => {
    const names: string[] = (await get('local-folder-names')) || [];
    setLocalFolders(names);
  };

  const handleRescanFolder = (folderName: string) => {
    // webkitdirectory gives no persistent handle — re-import triggers the same picker
    setScanningFolderName(folderName);
    folderInputRef.current?.click();
  };

  const handleRemoveFolder = async (folderName: string) => {
    const ok = confirm(
      `Remove "${folderName}" from saved folders?\n\nThis will also delete all its tracks from your library — you'll need to re-import to get them back.`
    );
    if (!ok) return;
    await customFetch(`/api/tracks/folder?name=${encodeURIComponent(folderName)}`, { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });
    const updated = localFolders.filter(n => n !== folderName);
    await set('local-folder-names', updated);
    setLocalFolders(updated);
  };

  const handleClearLibrary = async () => {
    if (!confirm('Remove all local tracks from the library? Subsonic tracks are kept. You can re-import anytime.')) return;
    setClearingLibrary(true);
    try {
      await customFetch('/api/tracks/local', { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });
    } finally {
      setClearingLibrary(false);
    }
  };

  const handleClearSubsonic = async () => {
    if (!confirm('Remove all Subsonic-synced tracks from the library? Local tracks are kept. Re-sync from the server to restore.')) return;
    setClearingSubsonic(true);
    try {
      await customFetch('/api/tracks/subsonic', { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });
    } finally {
      setClearingSubsonic(false);
    }
  };

  // Always use the rendered hidden <input webkitdirectory> — it reliably
  // enumerates all files (including protected/cloud locations) and is the only
  // approach that consistently works across both iframe and standalone contexts.
  const handleAddFolder = () => folderInputRef.current?.click();

  const handleAddFiles  = () => filesInputRef.current?.click();

  const onFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // Derive the root folder name from the first file's relative path
      const rootName =
        (files[0] as any).webkitRelativePath?.split('/')?.[0] ||
        files[0].name;
      await scanFileList(files);
      // Save folder name to IndexedDB so it shows in the list
      const existing: string[] = (await get('local-folder-names')) || [];
      if (!existing.includes(rootName)) {
        await set('local-folder-names', [...existing, rootName]);
      }
      setScanningFolderName(null);
      await loadLocalFolders();
    }
    e.target.value = '';
  };

  const onFilesInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) await scanFileList(files);
    e.target.value = '';
  };

  // Subsonic helpers
  const handleSubsonicSubmit = async () => {
    if (!subsonicForm.name || !subsonicForm.url || !subsonicForm.username) return;
    const normalizedUrl = subsonicForm.url.replace(/\/$/, '');

    if (editingServerId !== null) {
      await updateServer.mutateAsync({
        id: editingServerId,
        data: { ...subsonicForm, url: normalizedUrl },
      });
    } else {
      await createServer.mutateAsync({
        data: { ...subsonicForm, url: normalizedUrl },
      });
    }
    await queryClient.invalidateQueries({ queryKey: getListSubsonicServersQueryKey() });
    setSubsonicForm(EMPTY_SUBSONIC);
    setShowSubsonicForm(false);
    setEditingServerId(null);
  };

  const handleEditServer = (server: typeof servers[0]) => {
    setSubsonicForm({
      name: server.name,
      url: server.url,
      username: server.username,
      password: '',
    });
    setEditingServerId(server.id);
    setShowSubsonicForm(true);
  };

  const handleDeleteServer = async (id: number) => {
    await deleteServer.mutateAsync({ id });
    await queryClient.invalidateQueries({ queryKey: getListSubsonicServersQueryKey() });
  };

  const handleTestServer = async (id: number) => {
    setTestResults(r => ({ ...r, [id]: 'loading' }));
    try {
      const cfg = await fetchSubsonicConfig(id);
      const pingUrl = buildSubsonicUrl(cfg, 'ping.view');
      const resp = await fetch(pingUrl, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) { setTestResults(r => ({ ...r, [id]: { ok: false, msg: `HTTP ${resp.status}` } })); return; }
      const data = await resp.json() as any;
      const sub = data?.['subsonic-response'];
      if (sub?.status === 'ok') {
        setTestResults(r => ({ ...r, [id]: { ok: true, msg: `Connected · v${sub.version ?? '?'}` } }));
      } else {
        setTestResults(r => ({ ...r, [id]: { ok: false, msg: sub?.error?.message ?? 'Auth failed' } }));
      }
    } catch (e: any) {
      const msg = e?.message?.includes('timeout') ? 'Timeout — server unreachable' : (e?.message ?? 'Connection failed');
      setTestResults(r => ({ ...r, [id]: { ok: false, msg } }));
    }
  };

  const handleSyncServer = async (id: number) => {
    setSyncStates(s => ({ ...s, [id]: { status: 'syncing' } }));
    try {
      const cfg = await fetchSubsonicConfig(id);
      const songMap = new Map<string, any>();

      // Strategy 1: paginated album list → per-album song fetch
      try {
        const PAGE = 500; let offset = 0;
        while (true) {
          const sub = await subsonicApiFetch(buildSubsonicUrl(cfg, 'getAlbumList2', { type: 'alphabeticalByName', size: PAGE, offset }));
          const albums: any[] = sub.albumList2?.album ?? [];
          if (albums.length === 0) break;
          for (const al of albums) {
            try { const s2 = await subsonicApiFetch(buildSubsonicUrl(cfg, 'getAlbum', { id: String(al.id) })); for (const s of s2.album?.song ?? []) songMap.set(String(s.id), s); } catch { }
          }
          if (albums.length < PAGE) break;
          offset += PAGE;
        }
      } catch { }

      // Strategy 2: getSongs (if server supports it)
      if (songMap.size === 0) {
        try {
          const PAGE = 500; let offset = 0;
          while (true) {
            const sub = await subsonicApiFetch(buildSubsonicUrl(cfg, 'getSongs', { size: PAGE, offset }));
            const songs: any[] = sub.songs?.song ?? [];
            if (songs.length === 0) break;
            for (const s of songs) songMap.set(String(s.id), s);
            if (songs.length < PAGE) break;
            offset += PAGE;
          }
        } catch { }
      }

      if (songMap.size === 0) throw new Error('No tracks found — server may not support these endpoints');

      const tracks = Array.from(songMap.values()).map(song => ({
        title: song.title || 'Unknown Title',
        artist: song.artist || 'Unknown Artist',
        album: song.album || 'Unknown Album',
        year: song.year ?? null,
        genre: song.genre ?? null,
        duration: Math.round(song.duration ?? 0),
        trackNumber: song.track ?? null,
        fileName: song.path?.split('/').pop() ?? String(song.id),
        folderPath: song.path?.split('/').slice(0, -1).join('/') ?? '',
        albumArtDataUrl: null as null,
        source: 'subsonic' as const,
        subsonicId: String(song.id),
        subsonicServerId: cfg.id,
      }));

      await customFetch('/api/tracks/bulk', { method: 'POST', body: JSON.stringify({ tracks }) });

      setSyncStates(s => ({ ...s, [id]: { status: 'done', msg: `${tracks.length} tracks synced` } }));
      await queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });
    } catch (e: any) {
      setSyncStates(s => ({ ...s, [id]: { status: 'error', msg: e?.message ?? 'Sync failed' } }));
    }
  };

  // EQ preset helpers
  const handleApplyPreset = (preset: typeof presets[0]) => {
    setActiveEqPreset(preset);
  };

  const handleSavePreset = async () => {
    if (!newPresetName.trim()) return;
    setSavingPreset(true);
    try {
      await createPreset.mutateAsync({
        data: { name: newPresetName.trim(), bands: JSON.stringify(eqBands) },
      });
      await queryClient.invalidateQueries({ queryKey: getListEqPresetsQueryKey() });
      setNewPresetName('');
    } finally {
      setSavingPreset(false);
    }
  };

  const handleDeletePreset = async (id: number) => {
    await deletePreset.mutateAsync({ id });
    await queryClient.invalidateQueries({ queryKey: getListEqPresetsQueryKey() });
  };

  return (
    <Sheet open={isPrefsOpen} onOpenChange={togglePrefs}>
      <SheetContent side="right" className="w-full max-w-[480px] bg-card border-border/50 p-0 flex flex-col overflow-hidden">
        <SheetHeader className="px-6 py-4 border-b border-border/30 shrink-0">
          <SheetTitle className="text-primary tracking-wide">Preferences</SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="sources" className="flex flex-col flex-1 overflow-hidden">
          <TabsList className="shrink-0 mx-6 mt-4 bg-black/30 border border-border/30">
            <TabsTrigger value="sources" className="flex-1 text-xs">Music Sources</TabsTrigger>
            <TabsTrigger value="playback" className="flex-1 text-xs">Playback</TabsTrigger>
            <TabsTrigger value="about" className="flex-1 text-xs">About & Sync</TabsTrigger>
          </TabsList>

          {/* ── MUSIC SOURCES TAB ── */}
          <TabsContent value="sources" className="flex-1 overflow-y-auto px-6 pb-6 space-y-6 mt-4">

            {/* Local Folders */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <HardDrive className="w-3.5 h-3.5 text-primary" />
                    Local Folders
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Pick files or a folder to import. Use "Import Files" in sandboxed previews.
                  </p>
                </div>
                <div className="flex gap-1.5 flex-wrap justify-end">
                  {/* Hidden inputs — buttons click these directly to preserve browser user-gesture */}
                  <input
                    ref={folderInputRef}
                    type="file"
                    // webkitdirectory makes this a folder picker; do NOT set `accept`
                    // alongside webkitdirectory — it conflicts in Chrome/Edge and returns 0 files
                    {...{ webkitdirectory: '' } as any}
                    multiple
                    style={{ display: 'none' }}
                    onChange={onFolderInputChange}
                  />
                  <input
                    ref={filesInputRef}
                    type="file"
                    multiple
                    accept=".mp3,.flac,.m4a,.aac,.wav,.ogg,.opus"
                    style={{ display: 'none' }}
                    onChange={onFilesInputChange}
                  />
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-primary/70 hover:text-primary" onClick={loadSampleTrack} disabled={isScanning} title="Load the bundled demo track">
                    Load Sample
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-border/50" onClick={handleAddFiles} disabled={isScanning} title="Pick individual audio files — works everywhere">
                    <FileMusic className="w-3 h-3" />
                    Import Files
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-border/50" onClick={handleAddFolder} disabled={isScanning} title="Pick a whole folder">
                    <Plus className="w-3 h-3" />
                    Add Folder
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1.5 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                    onClick={handleClearLibrary}
                    disabled={isScanning || clearingLibrary}
                    title="Remove all local tracks from the library"
                  >
                    {clearingLibrary ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    Clear Library
                  </Button>
                </div>
              </div>

              {(isScanning || scanStatus) && (
                <div className={clsx(
                  'flex items-center gap-2 text-xs px-3 py-2 rounded-md mb-2',
                  isScanning
                    ? 'text-primary animate-pulse bg-primary/10'
                    : scanStatus.startsWith('✓')
                      ? 'text-green-400 bg-green-400/10'
                      : 'text-destructive bg-destructive/10'
                )}>
                  {isScanning
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    : scanStatus.startsWith('✓')
                      ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 shrink-0" />
                  }
                  {scanStatus || 'Scanning…'}
                </div>
              )}

              {localFolders.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-5 border border-dashed border-border/30 rounded-md space-y-1 px-3">
                  <p>No folder imported yet.</p>
                  <p className="text-[10px] opacity-70">Use <strong>Add Folder</strong> to import — tracks are saved to the library. Re-import each session to enable local playback.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {localFolders.map(name => (
                    <div key={name} className="flex items-center gap-3 px-3 py-2 bg-black/20 rounded-md group">
                      <FolderOpen className="w-4 h-4 text-primary/70 shrink-0" />
                      <span className="text-sm flex-1 truncate font-mono text-xs">{name}</span>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6"
                          title="Re-import this folder"
                          disabled={isScanning}
                          onClick={() => handleRescanFolder(name)}
                        >
                          {scanningFolderName === name && isScanning
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <RefreshCw className="w-3 h-3" />
                          }
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6 hover:text-destructive"
                          title="Remove folder from library"
                          onClick={() => handleRemoveFolder(name)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <Separator className="border-border/20" />

            {/* Subsonic Servers */}
            <section>
              <div className="mb-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold flex items-center gap-2 shrink-0">
                    <Cloud className="w-3.5 h-3.5 text-primary" />
                    Subsonic Servers
                  </h3>
                  <div className="flex gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1.5 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                      onClick={handleClearSubsonic}
                      disabled={clearingSubsonic}
                      title="Remove all Subsonic-synced tracks from the library"
                    >
                      {clearingSubsonic ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      Clear
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-xs gap-1.5 border-border/50"
                      onClick={() => { setSubsonicForm(EMPTY_SUBSONIC); setEditingServerId(null); setShowSubsonicForm(s => !s); }}
                    >
                      <Plus className="w-3 h-3" />
                      Add Server
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Navidrome, Airsonic, Jellyfin, and any OpenSubsonic-compatible server.
                </p>
              </div>

              {/* Add / Edit form */}
              {showSubsonicForm && (
                <div className="mb-4 p-4 bg-black/30 rounded-md border border-border/30 space-y-3">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {editingServerId ? 'Edit Server' : 'New Server'}
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-[11px]">Display Name</Label>
                      <Input
                        value={subsonicForm.name}
                        onChange={e => setSubsonicForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="My Music Server"
                        className="h-8 text-xs bg-black/20 border-border/50"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-[11px]">Server URL</Label>
                      <Input
                        value={subsonicForm.url}
                        onChange={e => setSubsonicForm(f => ({ ...f, url: e.target.value }))}
                        placeholder="https://music.example.com"
                        className="h-8 text-xs bg-black/20 border-border/50"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Username</Label>
                      <Input
                        value={subsonicForm.username}
                        onChange={e => setSubsonicForm(f => ({ ...f, username: e.target.value }))}
                        placeholder="admin"
                        className="h-8 text-xs bg-black/20 border-border/50"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Password</Label>
                      <Input
                        type="password"
                        value={subsonicForm.password}
                        onChange={e => setSubsonicForm(f => ({ ...f, password: e.target.value }))}
                        placeholder={editingServerId ? "Leave blank to keep saved password" : "••••••••"}
                        className="h-8 text-xs bg-black/20 border-border/50"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setShowSubsonicForm(false); setEditingServerId(null); }}>
                      Cancel
                    </Button>
                    <Button
                      size="sm" className="h-7 text-xs"
                      onClick={handleSubsonicSubmit}
                      disabled={createServer.isPending || updateServer.isPending || !subsonicForm.name || !subsonicForm.url || !subsonicForm.username}
                    >
                      {(createServer.isPending || updateServer.isPending) && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                      {editingServerId ? 'Save Changes' : 'Add Server'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Server list */}
              {servers.length === 0 && !showSubsonicForm ? (
                <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border/30 rounded-md">
                  No servers configured.<br />Add a Navidrome, Airsonic, or compatible server.
                </div>
              ) : (
                <div className="space-y-2">
                  {servers.map(server => {
                    const testResult = testResults[server.id];
                    const syncState = syncStates[server.id];
                    return (
                      <div key={server.id} className="p-3 bg-black/20 rounded-md border border-border/20 group">
                        <div className="flex items-start gap-2.5">
                          <Server className="w-4 h-4 text-primary/70 shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{server.name}</div>
                            <div className="text-[11px] text-muted-foreground font-mono break-all">{server.url}</div>
                            <div className="text-[11px] text-muted-foreground">User: {server.username}</div>
                          </div>
                          <div className="flex gap-0.5 shrink-0 flex-wrap justify-end">
                            <Button
                              variant="ghost" size="icon" className="h-6 w-6"
                              onClick={() => handleSyncServer(server.id)}
                              disabled={syncState?.status === 'syncing'}
                              title="Sync library from this server"
                            >
                              {syncState?.status === 'syncing'
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <RefreshCw className="w-3 h-3" />
                              }
                            </Button>
                            <Button
                              variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                              onClick={() => handleTestServer(server.id)}
                              disabled={testResult === 'loading'}
                              title="Test connection to this server"
                            >
                              {testResult === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Test'}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => handleEditServer(server)}>Edit</Button>
                            <Button
                              variant="ghost" size="icon" className="h-6 w-6 hover:text-destructive"
                              onClick={() => handleDeleteServer(server.id)}
                              disabled={deleteServer.isPending}
                              title="Delete server"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        {syncState && syncState.status !== 'idle' && syncState.status !== 'syncing' && (
                          <div className={clsx(
                            'mt-2 flex items-center gap-1.5 text-[11px] px-2 py-1 rounded',
                            syncState.status === 'done' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                          )}>
                            {syncState.status === 'done'
                              ? <CheckCircle2 className="w-3.5 h-3.5" />
                              : <XCircle className="w-3.5 h-3.5" />
                            }
                            {syncState.msg}
                          </div>
                        )}
                        {testResult && testResult !== 'loading' && (
                          <div className={clsx(
                            'mt-2 flex items-center gap-1.5 text-[11px] px-2 py-1 rounded',
                            testResult.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                          )}>
                            {testResult.ok
                              ? <CheckCircle2 className="w-3.5 h-3.5" />
                              : <XCircle className="w-3.5 h-3.5" />
                            }
                            {testResult.msg}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </TabsContent>

          {/* ── PLAYBACK TAB ── */}
          <TabsContent value="playback" className="flex-1 overflow-y-auto px-6 pb-6 space-y-6 mt-4">
            <section>
              <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                EQ Presets
              </h3>
              <p className="text-[11px] text-muted-foreground mb-3">
                Save the current equalizer settings as a named preset, or apply an existing one.
              </p>

              {/* Save current EQ */}
              <div className="flex gap-2 mb-4">
                <Input
                  value={newPresetName}
                  onChange={e => setNewPresetName(e.target.value)}
                  placeholder="Preset name…"
                  className="h-8 text-xs bg-black/20 border-border/50 flex-1"
                  onKeyDown={e => e.key === 'Enter' && handleSavePreset()}
                />
                <Button
                  size="sm" className="h-8 text-xs gap-1.5"
                  onClick={handleSavePreset}
                  disabled={!newPresetName.trim() || savingPreset}
                >
                  {savingPreset ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Save EQ
                </Button>
              </div>

              <div className="space-y-1.5">
                {presets.map(preset => {
                  const bands: number[] = JSON.parse(preset.bands);
                  const isBuiltin = preset.isBuiltin;
                  return (
                    <div key={preset.id} className="flex items-center gap-3 px-3 py-2 bg-black/20 rounded-md group">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{preset.name}</span>
                          {isBuiltin && <Badge variant="secondary" className="text-[9px] h-4 px-1.5">built-in</Badge>}
                        </div>
                        {/* Mini bar visualizer */}
                        <div className="flex items-end gap-px mt-1 h-4">
                          {bands.map((v, i) => {
                            const pct = Math.abs(v) / 12;
                            const isPos = v >= 0;
                            return (
                              <div
                                key={i}
                                className={clsx('w-2 rounded-sm', isPos ? 'bg-primary/50' : 'bg-red-400/30')}
                                style={{ height: `${Math.max(2, pct * 16)}px` }}
                              />
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost" size="sm" className="h-6 text-[10px] px-2 hover:text-primary"
                          onClick={() => handleApplyPreset(preset)}
                        >
                          Apply
                        </Button>
                        {!isBuiltin && (
                          <Button
                            variant="ghost" size="sm" className="h-6 w-6 p-0 hover:text-destructive opacity-0 group-hover:opacity-100"
                            onClick={() => handleDeletePreset(preset.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── Notifications ── */}
            <section>
              <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                <Bell className="w-4 h-4 text-muted-foreground" />
                Song Change Notifications
              </h3>
              <p className="text-[11px] text-muted-foreground mb-3">
                Show an OS notification when a new track starts playing.
                On Windows this appears as a toast in the bottom-right corner.
                The Windows media controls widget (play · pause · skip) is always
                available when audio is playing — no extra setup needed.
              </p>

              {!('Notification' in window) ? (
                <p className="text-[11px] text-muted-foreground/60">
                  Notifications are not supported in this browser.
                </p>
              ) : notifPermission === 'denied' ? (
                <p className="text-[11px] text-destructive/80">
                  Notifications are blocked. Open your browser settings and allow
                  notifications for this site, then reload.
                </p>
              ) : notifPermission === 'default' ? (
                <Button
                  size="sm" className="h-8 text-xs gap-1.5"
                  onClick={handleRequestNotifPermission}
                >
                  <Bell className="w-3 h-3" />
                  Enable Notifications
                </Button>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleToggleNotif(!notifOn)}
                    className={clsx(
                      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                      'transition-colors duration-200 focus:outline-none',
                      notifOn ? 'bg-primary' : 'bg-border',
                    )}
                    role="switch"
                    aria-checked={notifOn}
                  >
                    <span
                      className={clsx(
                        'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg',
                        'transform transition duration-200',
                        notifOn ? 'translate-x-4' : 'translate-x-0',
                      )}
                    />
                  </button>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {notifOn
                      ? <><Bell className="w-3 h-3 text-primary" /><span className="text-foreground">Notifications on</span></>
                      : <><BellOff className="w-3 h-3" /><span>Notifications off</span></>}
                  </div>
                </div>
              )}
            </section>
          </TabsContent>

          {/* ── ABOUT & SYNC TAB ── */}
          <TabsContent value="about" className="flex-1 overflow-y-auto px-6 pb-6 space-y-5 mt-4">
            <section>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Info className="w-3.5 h-3.5 text-primary" />
                What's stored where
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed mb-4">
                Your library is tied to your account — sign in on any device and your metadata, playlists, and settings are already there. Local files stay on each device since the browser can't reach your hard drive remotely.
              </p>

              <div className="space-y-3">
                <div className="p-3 rounded-md bg-green-500/5 border border-green-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Database className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-xs font-semibold text-green-400">Shared across all devices</span>
                    <Badge variant="outline" className="text-[9px] h-4 border-green-500/30 text-green-400">Server DB</Badge>
                  </div>
                  <ul className="text-[11px] text-muted-foreground space-y-1 pl-5 list-disc">
                    <li>Track metadata — title, artist, album, year, genre, rating, play count</li>
                    <li>Playlists and their track order</li>
                    <li>EQ presets (custom and built-in)</li>
                    <li>Subsonic server connections (password stored securely server-side)</li>
                    <li>Playback queue</li>
                  </ul>
                </div>

                <div className="p-3 rounded-md bg-yellow-500/5 border border-yellow-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Monitor className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-xs font-semibold text-yellow-400">This device only</span>
                    <Badge variant="outline" className="text-[9px] h-4 border-yellow-500/30 text-yellow-400">IndexedDB</Badge>
                  </div>
                  <ul className="text-[11px] text-muted-foreground space-y-1 pl-5 list-disc">
                    <li>Local folder handles (file system access permissions)</li>
                    <li>Embedded album art extracted from your files</li>
                    <li>File paths — a track scanned on one machine won't play on another</li>
                  </ul>
                </div>

                <div className="p-3 rounded-md bg-blue-500/5 border border-blue-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Cloud className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-semibold text-blue-400">Subsonic — works everywhere</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Tracks streamed from a Subsonic server are accessible from any device, since playback uses your server's stream URL — no local files needed.
                  </p>
                </div>
              </div>
            </section>

            <Separator className="border-border/20" />

            <section>
              <h3 className="text-sm font-semibold mb-2">About playd.music</h3>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                A foobar2000-inspired web audio player. Fully installable as a PWA.
                Supports local files (Chrome / Edge via File System Access API),
                Subsonic/OpenSubsonic streaming servers, 10-band EQ, smart playlists,
                OS media keys, and lock screen controls.
              </p>
              <div className="mt-3 flex gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px]">PWA</Badge>
                <Badge variant="outline" className="text-[10px]">Web Audio API</Badge>
                <Badge variant="outline" className="text-[10px]">File System Access</Badge>
                <Badge variant="outline" className="text-[10px]">Media Session</Badge>
                <Badge variant="outline" className="text-[10px]">OpenSubsonic</Badge>
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
