import { useState, useEffect, useRef, useCallback } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';
import {
  useListEqPresets,
  useCreateEqPreset,
  useDeleteEqPreset,
  getListEqPresetsQueryKey,
  getListTracksQueryKey,
  customFetch,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import {
  FolderOpen, RefreshCw, Trash2, Plus, CheckCircle2,
  XCircle, Loader2, Info, HardDrive,
  Database, Monitor, Save, FileMusic, Bell, BellOff, Smartphone,
  Activity, Blend,
} from 'lucide-react';
import { clsx } from 'clsx';
import { get, del, set } from 'idb-keyval';
import {
  notificationsEnabled,
  setNotificationsEnabled,
  requestNotificationPermission,
} from '@/hooks/use-now-playing-notification';

export function PreferencesPanel() {
  const {
    isPrefsOpen, togglePrefs, eqBands, setActiveEqPreset,
    crossfadeSec, setCrossfadeSec, showSpectrum, setShowSpectrum,
  } = useAudioPlayer();
  const { loadSampleTrack, scanFileList, isScanning, scanStatus } = useFileSystem();

  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef  = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // EQ Presets
  const { data: presets = [] } = useListEqPresets();
  const createPreset = useCreateEqPreset();
  const deletePreset = useDeleteEqPreset();

  // Local folders
  const [localFolders, setLocalFolders] = useState<string[]>([]);
  const [scanningFolderName, setScanningFolderName] = useState<string | null>(null);
  const [clearingLibrary, setClearingLibrary] = useState(false);

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
    if (isPrefsOpen) loadLocalFolders();
  }, [isPrefsOpen]);

  const loadLocalFolders = async () => {
    const names: string[] = (await get('local-folder-names')) || [];
    setLocalFolders(names);
  };

  const handleRescanFolder = (folderName: string) => {
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
    if (!confirm('Remove all local tracks from the library? You can re-import anytime.')) return;
    setClearingLibrary(true);
    try {
      await customFetch('/api/tracks/local', { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });
    } finally {
      setClearingLibrary(false);
    }
  };

  const handleAddFolder = () => folderInputRef.current?.click();
  const handleAddFiles  = () => filesInputRef.current?.click();

  const onFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const rootName =
        (files[0] as any).webkitRelativePath?.split('/')?.[0] || files[0].name;
      await scanFileList(files);
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
            <TabsTrigger value="about" className="flex-1 text-xs">About</TabsTrigger>
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
                  <input
                    ref={folderInputRef}
                    type="file"
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
          </TabsContent>

          {/* ── PLAYBACK TAB ── */}
          <TabsContent value="playback" className="flex-1 overflow-y-auto px-6 pb-6 space-y-6 mt-4">

            {/* Crossfade */}
            <section>
              <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                <Blend className="w-3.5 h-3.5 text-primary" />
                Crossfade
              </h3>
              <p className="text-[11px] text-muted-foreground mb-3">
                Blend the end of one track into the beginning of the next.
                Set to 0 to disable.
              </p>
              <div className="flex items-center gap-4">
                <Slider
                  min={0}
                  max={12}
                  step={1}
                  value={[crossfadeSec]}
                  onValueChange={([v]) => setCrossfadeSec(v)}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-12 text-right shrink-0">
                  {crossfadeSec === 0 ? 'Off' : `${crossfadeSec}s`}
                </span>
              </div>
            </section>

            {/* Spectrum Visualizer */}
            <section>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-primary" />
                    Spectrum Visualizer
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Show a real-time frequency bar graph above the transport.
                  </p>
                </div>
                <button
                  onClick={() => setShowSpectrum(!showSpectrum)}
                  className={clsx(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                    'transition-colors duration-200 focus:outline-none',
                    showSpectrum ? 'bg-primary' : 'bg-border',
                  )}
                  role="switch"
                  aria-checked={showSpectrum}
                >
                  <span
                    className={clsx(
                      'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg',
                      'transform transition duration-200',
                      showSpectrum ? 'translate-x-4' : 'translate-x-0',
                    )}
                  />
                </button>
              </div>
            </section>

            <Separator className="border-border/20" />

            <section>
              <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                EQ Presets
              </h3>
              <p className="text-[11px] text-muted-foreground mb-3">
                Save the current equalizer settings as a named preset, or apply an existing one.
              </p>

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

            {/* Notifications */}
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

          {/* ── ABOUT TAB ── */}
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
                    <Smartphone className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-semibold text-blue-400">Install as an app — runs anywhere</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    playd.music is a fully installable PWA. Add it to your home screen on iOS or Android, or install it from Chrome/Edge on desktop — it runs like a native app with no browser chrome, offline support, and OS media key integration.
                  </p>
                </div>
              </div>
            </section>

            <Separator className="border-border/20" />

            <section>
              <h3 className="text-sm font-semibold mb-2">About playd.music</h3>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                A foobar2000-inspired web audio player. Fully installable as a PWA.
                Supports local files via the File System Access API (Chrome / Edge),
                10-band EQ, smart playlists, OS media keys, and lock screen controls.
              </p>
              <div className="mt-3 flex gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px]">PWA</Badge>
                <Badge variant="outline" className="text-[10px]">Web Audio API</Badge>
                <Badge variant="outline" className="text-[10px]">File System Access</Badge>
                <Badge variant="outline" className="text-[10px]">Media Session</Badge>
                <Badge variant="outline" className="text-[10px]">10-Band EQ</Badge>
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
