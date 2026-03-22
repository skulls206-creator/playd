import { useState, useEffect, useRef } from 'react';
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
  testSubsonicServer,
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
  Cloud, Database, Monitor, Save, FileMusic
} from 'lucide-react';
import { clsx } from 'clsx';
import { get, del, set } from 'idb-keyval';

interface SubsonicFormState {
  name: string;
  url: string;
  username: string;
  password: string;
}

const EMPTY_SUBSONIC: SubsonicFormState = { name: '', url: '', username: '', password: '' };

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

  // Local folders state (from IndexedDB)
  const [localFolders, setLocalFolders] = useState<FileSystemDirectoryHandle[]>([]);
  const [scanningFolderName, setScanningFolderName] = useState<string | null>(null);

  // Subsonic form state
  const [showSubsonicForm, setShowSubsonicForm] = useState(false);
  const [editingServerId, setEditingServerId] = useState<number | null>(null);
  const [subsonicForm, setSubsonicForm] = useState<SubsonicFormState>(EMPTY_SUBSONIC);
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; msg: string } | 'loading'>>({});
  const [syncStates, setSyncStates] = useState<Record<number, { status: 'idle' | 'syncing' | 'done' | 'error'; msg?: string }>>({});

  // EQ save form
  const [newPresetName, setNewPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);

  useEffect(() => {
    if (isPrefsOpen) {
      loadLocalFolders();
    }
  }, [isPrefsOpen]);

  const loadLocalFolders = async () => {
    const handles: FileSystemDirectoryHandle[] = (await get('music-folders')) || [];
    setLocalFolders(handles);
  };

  const handleRescanFolder = async (handle: FileSystemDirectoryHandle) => {
    setScanningFolderName(handle.name);
    try {
      await scanFolder(handle);
    } finally {
      setScanningFolderName(null);
    }
  };

  const handleRemoveFolder = async (handle: FileSystemDirectoryHandle) => {
    const updated = localFolders.filter(h => h.name !== handle.name);
    await set('music-folders', updated);
    setLocalFolders(updated);
  };

  // Always use the rendered hidden <input webkitdirectory> — it reliably
  // enumerates all files (including protected/cloud locations) and is the only
  // approach that consistently works across both iframe and standalone contexts.
  const handleAddFolder = () => folderInputRef.current?.click();

  const handleAddFiles  = () => filesInputRef.current?.click();

  const onFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await scanFileList(files);
      loadLocalFolders();
    }
    // Reset so the same folder can be re-picked
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
      const result = await testSubsonicServer(id);
      setTestResults(r => ({ ...r, [id]: { ok: result.success, msg: result.message ?? '' } }));
    } catch {
      setTestResults(r => ({ ...r, [id]: { ok: false, msg: 'Request failed' } }));
    }
  };

  const handleSyncServer = async (id: number) => {
    setSyncStates(s => ({ ...s, [id]: { status: 'syncing' } }));
    try {
      const resp = await fetch(`/api/subsonic-servers/${id}/sync`, { method: 'POST' });
      const data = await resp.json() as any;
      if (!resp.ok || !data.success) throw new Error(data.error ?? `HTTP ${resp.status}`);
      setSyncStates(s => ({ ...s, [id]: { status: 'done', msg: `${data.upserted} tracks synced` } }));
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
      <SheetContent side="right" className="w-[480px] bg-card border-border/50 p-0 flex flex-col overflow-hidden">
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
                  <p>No persistent folder saved.</p>
                  <p className="text-[10px] opacity-70">Use <strong>Add Folder</strong> to import — your tracks are saved to the library even without a stored folder. Re-import each session for local playback.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {localFolders.map(handle => (
                    <div key={handle.name} className="flex items-center gap-3 px-3 py-2 bg-black/20 rounded-md group">
                      <FolderOpen className="w-4 h-4 text-primary/70 shrink-0" />
                      <span className="text-sm flex-1 truncate font-mono text-xs">{handle.name}</span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6"
                          title="Rescan this folder"
                          disabled={scanningFolderName === handle.name}
                          onClick={() => handleRescanFolder(handle)}
                        >
                          {scanningFolderName === handle.name
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <RefreshCw className="w-3 h-3" />
                          }
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6 hover:text-destructive"
                          title="Remove folder from library"
                          onClick={() => handleRemoveFolder(handle)}
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
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Cloud className="w-3.5 h-3.5 text-primary" />
                    Subsonic / OpenSubsonic Servers
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Stream music from Navidrome, Airsonic, Jellyfin, etc.
                  </p>
                </div>
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs gap-1.5 border-border/50"
                  onClick={() => { setSubsonicForm(EMPTY_SUBSONIC); setEditingServerId(null); setShowSubsonicForm(s => !s); }}
                >
                  <Plus className="w-3 h-3" />
                  Add Server
                </Button>
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
                        <div className="flex items-center gap-3">
                          <Server className="w-4 h-4 text-primary/70 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{server.name}</div>
                            <div className="text-[11px] text-muted-foreground font-mono truncate">{server.url}</div>
                            <div className="text-[11px] text-muted-foreground">User: {server.username}</div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button
                              variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                              onClick={() => handleSyncServer(server.id)}
                              disabled={syncState?.status === 'syncing'}
                              title="Sync library from this server"
                            >
                              {syncState?.status === 'syncing'
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <RefreshCw className="w-3 h-3" />
                              }
                              <span className="ml-1">Sync</span>
                            </Button>
                            <Button
                              variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                              onClick={() => handleTestServer(server.id)}
                              disabled={testResult === 'loading'}
                            >
                              {testResult === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Test'}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => handleEditServer(server)}>Edit</Button>
                            <Button
                              variant="ghost" size="sm" className="h-6 text-[10px] px-2 hover:text-destructive"
                              onClick={() => handleDeleteServer(server.id)}
                              disabled={deleteServer.isPending}
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
          </TabsContent>

          {/* ── ABOUT & SYNC TAB ── */}
          <TabsContent value="about" className="flex-1 overflow-y-auto px-6 pb-6 space-y-5 mt-4">
            <section>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Info className="w-3.5 h-3.5 text-primary" />
                What's stored where
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed mb-4">
                playd.music has no user accounts. Here's exactly what is or isn't shared across your devices.
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
