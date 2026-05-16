import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useFileSystem } from '@/hooks/use-file-system';
import { useFolderWatch } from '@/hooks/use-folder-watch';
import { useTrackStore } from '@/lib/track-store';
import type { LocalTrack } from '@/lib/track-store';
import { scanReplaygain } from '@/lib/replaygain-scanner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { useKeyboardShortcuts, saveShortcuts, resetShortcuts, DEFAULT_SHORTCUTS } from '@/hooks/use-keyboard-shortcuts';
import type { ShortcutMap } from '@/hooks/use-keyboard-shortcuts';
import {
  FolderOpen, RefreshCw, Trash2, Plus, CheckCircle2,
  XCircle, Loader2, Info, HardDrive,
  Database, Monitor, Save, FileMusic, Bell, BellOff, Smartphone,
  Activity, Blend, Volume2, Palette, Check, ExternalLink,
} from 'lucide-react';
import { THEMES, THEME_KEYS } from '@/lib/themes';
import { useTheme } from '@/hooks/use-theme';
import { clsx } from 'clsx';
import { get, del, set } from 'idb-keyval';
import {
  notificationsEnabled,
  setNotificationsEnabled,
  requestNotificationPermission,
} from '@/hooks/use-now-playing-notification';
import { getScrobbleConfig, saveScrobbleConfig, getLastfmAuthUrl, getLastfmSession } from '@/lib/scrobble-service';
import type { ScrobbleConfig } from '@/lib/scrobble-service';

export function PreferencesPanel() {
  const {
    isPrefsOpen, togglePrefs, eqBands, setActiveEqPreset,
    crossfadeSec, setCrossfadeSec, showSpectrum, setShowSpectrum,
    gaplessEnabled, setGaplessEnabled,
    replaygainEnabled, setReplaygainEnabled,
  } = useAudioPlayer();
  const { loadSampleTrack, scanFileList, isScanning, scanStatus, getFileFromPath } = useFileSystem();
  const folderWatch = useFolderWatch();
  const [scrobbleConfig, setScrobbleConfig] = useState<ScrobbleConfig | null>(null);
  const [scrobbleLoading, setScrobbleLoading] = useState(true);
  const [scrobbleLastfmToken, setScrobbleLastfmToken] = useState('');

  useEffect(() => {
    getScrobbleConfig().then(c => {
      setScrobbleConfig(c);
      setScrobbleLoading(false);
    });
  }, []);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef  = useRef<HTMLInputElement>(null);

  // ── Track store ─────────────────────────────────────────────────────────
  const allTracks = useTrackStore(s => s.tracks);
  const eqPresets = useTrackStore(s => s.eqPresets);
  const updateTrack = useTrackStore(s => s.updateTrack);
  const createEqPreset = useTrackStore(s => s.createEqPreset);
  const deleteEqPreset = useTrackStore(s => s.deleteEqPreset);

  // ── ReplayGain scan ─────────────────────────────────────────────────────
  const { theme: activeTheme, setTheme } = useTheme();

  const [rgScanning, setRgScanning] = useState(false);
  const [rgProgress, setRgProgress] = useState<{ done: number; total: number } | null>(null);
  const [rgStatus, setRgStatus] = useState<string | null>(null);

  const handleScanReplaygain = useCallback(async (rescanAll = false) => {
    const localTracks = allTracks.filter(t => t.source === 'local');
    if (localTracks.length === 0) {
      setRgStatus('No local tracks found. Import some files first.');
      return;
    }
    const toScan = rescanAll
      ? localTracks
      : localTracks.filter(t => t.replaygainGain == null);

    if (toScan.length === 0) {
      setRgStatus('All local tracks are already scanned. Use Re-scan All to update.');
      return;
    }

    setRgScanning(true);
    setRgProgress({ done: 0, total: toScan.length });
    setRgStatus(null);
    let scanned = 0;
    let failed = 0;

    for (const track of toScan) {
      try {
        const file = await getFileFromPath(track.fileName, track.folderPath);
        if (!file) { failed++; } else {
          const gain = await scanReplaygain(file);
          await updateTrack(track.id, { replaygainGain: gain } as Partial<LocalTrack>);
          scanned++;
        }
      } catch {
        failed++;
      }
      setRgProgress({ done: scanned + failed, total: toScan.length });
    }

    setRgScanning(false);
    const msg = failed > 0
      ? `Scanned ${scanned} track${scanned !== 1 ? 's' : ''} — ${failed} skipped (file not accessible)`
      : `Scanned ${scanned} track${scanned !== 1 ? 's' : ''} successfully`;
    setRgStatus(msg);
    setRgProgress(null);
  }, [allTracks, getFileFromPath, updateTrack]);

  // ── Local folders ───────────────────────────────────────────────────────
  const [localFolders, setLocalFolders] = useState<string[]>([]);
  const [scanningFolderName, setScanningFolderName] = useState<string | null>(null);
  const [clearingLibrary, setClearingLibrary] = useState(false);

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
    // Delete tracks matching this folder
    const idsToDelete = allTracks
      .filter(t => t.folderPath === folderName)
      .map(t => t.id);
    if (idsToDelete.length > 0) {
      await useTrackStore.getState().deleteTracks(idsToDelete);
    }
    const updated = localFolders.filter(n => n !== folderName);
    await set('local-folder-names', updated);
    setLocalFolders(updated);
  };

  const handleClearLibrary = async () => {
    if (!confirm('Remove all local tracks from the library? You can re-import anytime.')) return;
    setClearingLibrary(true);
    try {
      await useTrackStore.getState().clearTracks();
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

  // ── EQ preset helpers ───────────────────────────────────────────────────
  const [newPresetName, setNewPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);

  const handleApplyPreset = (preset: typeof eqPresets[0]) => {
    setActiveEqPreset(preset);
  };

  const handleSavePreset = async () => {
    if (!newPresetName.trim()) return;
    setSavingPreset(true);
    try {
      await createEqPreset(newPresetName.trim(), JSON.stringify(eqBands));
      setNewPresetName('');
    } finally {
      setSavingPreset(false);
    }
  };

  const handleDeletePreset = async (id: number) => {
    await deleteEqPreset(id);
  };

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  const [shortcuts, setShortcutsState] = useState<ShortcutMap>(() => {
    try {
      const stored = localStorage.getItem('playd_shortcuts');
      return stored ? { ...DEFAULT_SHORTCUTS, ...JSON.parse(stored) } : DEFAULT_SHORTCUTS;
    } catch { return DEFAULT_SHORTCUTS; }
  });
  const [recording, setRecording] = useState<string | null>(null);

  const handleRecordShortcut = (key: keyof ShortcutMap) => {
    setRecording(key);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const mods = [];
      if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
      if (e.shiftKey) mods.push('Shift');
      if (e.altKey) mods.push('Alt');
      const keyName = e.key === ' ' ? 'Space' : (e.key === 'Ctrl' || e.key === 'Shift' || e.key === 'Alt') ? '' : e.key;
      if (!keyName) return;
      const shortcut = [...mods, keyName].join('+');
      const updated = { ...shortcuts, [key]: shortcut };
      setShortcutsState(updated);
      saveShortcuts(updated);
      setRecording(null);
      document.removeEventListener('keydown', handler, true);
    };
    document.addEventListener('keydown', handler, true);
  };

  const handleResetShortcuts = () => {
    resetShortcuts();
    setShortcutsState(DEFAULT_SHORTCUTS);
  };

  const shortcutLabels: Record<keyof ShortcutMap, string> = {
    playPause: 'Play / Pause', next: 'Next Track', prev: 'Previous Track',
    mute: 'Mute', volUp: 'Volume Up', volDown: 'Volume Down',
    shuffle: 'Toggle Shuffle', repeat: 'Toggle Repeat',
    search: 'Focus Search', queue: 'Toggle Queue', eq: 'Toggle EQ',
    prefs: 'Toggle Preferences', lyrics: 'Toggle Lyrics',
  };

  // ── Notifications ───────────────────────────────────────────────────────
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

  return (
    <Sheet open={isPrefsOpen} onOpenChange={togglePrefs}>
      <SheetContent side="right" className="w-full max-w-[480px] bg-card border-border/50 p-0 flex flex-col overflow-hidden">
        <SheetHeader className="px-6 py-4 border-b border-border/30 shrink-0">
          <SheetTitle className="text-primary tracking-wide">Preferences</SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="sources" className="flex flex-col flex-1 overflow-hidden">
          <TabsList className="shrink-0 mx-6 mt-4 bg-black/30 border border-border/30">
            <TabsTrigger value="sources"    className="flex-1 text-xs">Sources</TabsTrigger>
            <TabsTrigger value="playback"   className="flex-1 text-xs">Playback</TabsTrigger>
            <TabsTrigger value="appearance" className="flex-1 text-xs">Appearance</TabsTrigger>
            <TabsTrigger value="scrobble"   className="flex-1 text-xs">Scrobble</TabsTrigger>
            <TabsTrigger value="about"      className="flex-1 text-xs">About</TabsTrigger>
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

            {/* Library stats */}
            <section>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-primary" />
                Library
              </h3>
              <div className="p-3 rounded-md bg-black/20 border border-border/30 text-[11px] text-muted-foreground">
                <span>
                  <span className="text-foreground font-medium">{allTracks.length}</span>{' '}
                  {allTracks.length === 1 ? 'track' : 'tracks'} in library
                </span>
              </div>
            </section>

            {/* Folder Watch */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-primary" />
                  <h3 className="text-sm font-semibold">Folder Watch</h3>
                </div>
                <button
                  onClick={() => folderWatch.setWatchEnabled(!folderWatch.watchEnabled)}
                  className={clsx(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                    'transition-colors duration-200 focus:outline-none',
                    folderWatch.watchEnabled ? 'bg-primary' : 'bg-border',
                  )}
                  role="switch"
                  aria-checked={folderWatch.watchEnabled}
                >
                  <span
                    className={clsx(
                      'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg',
                      'transform transition duration-200',
                      folderWatch.watchEnabled ? 'translate-x-4' : 'translate-x-0',
                    )}
                  />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3">
                Auto-detect new audio files in your imported folders and add them
                to the library. Polling pauses when the tab is hidden.
              </p>

              {folderWatch.watchEnabled && (
                <div className="space-y-3">
                  {/* Interval slider */}
                  <div className="flex items-center gap-4">
                    <span className="text-[11px] text-muted-foreground w-16 shrink-0">
                      {folderWatch.intervalLabel}
                    </span>
                    <Slider
                      min={10}
                      max={600}
                      step={10}
                      value={[folderWatch.watchInterval / 1000]}
                      onValueChange={([v]) => folderWatch.setWatchInterval(v * 1000)}
                      className="flex-1"
                    />
                  </div>

                  {/* Last check + check-now button */}
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {folderWatch.lastWatchCheck
                        ? `Last check: ${folderWatch.lastWatchCheck}`
                        : 'Waiting for first check…'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={() => folderWatch.checkNow()}
                      disabled={isScanning}
                    >
                      <RefreshCw className={"w-3 h-3" + (isScanning ? ' animate-spin' : '')} />
                      Check Now
                    </Button>
                  </div>
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

            {/* Gapless Playback */}
            <section>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Blend className="w-3.5 h-3.5 text-primary" />
                    Gapless Playback
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Seamless transitions between tracks with no silence gap.
                  </p>
                </div>
                <button
                  onClick={() => setGaplessEnabled(!gaplessEnabled)}
                  className={clsx(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                    'transition-colors duration-200 focus:outline-none',
                    gaplessEnabled ? 'bg-primary' : 'bg-border',
                  )}
                  role="switch"
                  aria-checked={gaplessEnabled}
                >
                  <span
                    className={clsx(
                      'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg',
                      'transform transition duration-200',
                      gaplessEnabled ? 'translate-x-4' : 'translate-x-0',
                    )}
                  />
                </button>
              </div>
            </section>

            <Separator className="border-border/20" />

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

            {/* ReplayGain */}
            <section>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Volume2 className="w-3.5 h-3.5 text-primary" />
                  ReplayGain Normalization
                </h3>
                <button
                  onClick={() => setReplaygainEnabled(!replaygainEnabled)}
                  className={clsx(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                    'transition-colors duration-200 focus:outline-none',
                    replaygainEnabled ? 'bg-primary' : 'bg-border',
                  )}
                  role="switch"
                  aria-checked={replaygainEnabled}
                >
                  <span
                    className={clsx(
                      'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg',
                      'transform transition duration-200',
                      replaygainEnabled ? 'translate-x-4' : 'translate-x-0',
                    )}
                  />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3">
                Automatically adjust playback volume so all tracks play at the same perceived loudness.
                Scan your library to measure each track, then enable to apply.
              </p>

              {(() => {
                const localCount = allTracks.filter(t => t.source === 'local').length;
                const scannedCount = allTracks.filter(t => t.source === 'local' && t.replaygainGain != null).length;
                const unscannedCount = localCount - scannedCount;
                return (
                  <div className="flex flex-col gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs gap-1.5 border-border/50"
                        onClick={() => handleScanReplaygain(false)}
                        disabled={rgScanning}
                        title={unscannedCount === 0 ? 'All tracks already scanned' : `Scan ${unscannedCount} unscanned track${unscannedCount !== 1 ? 's' : ''}`}
                      >
                        {rgScanning
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <RefreshCw className="w-3 h-3" />
                        }
                        {rgScanning ? 'Scanning…' : 'Scan Library'}
                      </Button>
                      {scannedCount > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                          onClick={() => handleScanReplaygain(true)}
                          disabled={rgScanning}
                          title="Re-scan all tracks, overwriting existing gain values"
                        >
                          Re-scan All
                        </Button>
                      )}
                    </div>
                    {localCount > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {scannedCount} of {localCount} local track{localCount !== 1 ? 's' : ''} scanned
                        {unscannedCount > 0 && ` · ${unscannedCount} pending`}
                      </span>
                    )}
                  </div>
                );
              })()}

              {rgProgress && (
                <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-md bg-primary/10 text-primary animate-pulse mb-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  Scanning {rgProgress.done} / {rgProgress.total}…
                </div>
              )}

              {rgStatus && (
                <div className={clsx(
                  'flex items-center gap-2 text-xs px-3 py-2 rounded-md mb-2',
                  rgStatus.startsWith('Scanned')
                    ? 'text-green-400 bg-green-400/10'
                    : 'text-muted-foreground bg-black/20',
                )}>
                  {rgStatus.startsWith('Scanned')
                    ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    : <Info className="w-3.5 h-3.5 shrink-0" />
                  }
                  {rgStatus}
                </div>
              )}
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
                {eqPresets?.map(preset => {
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
                          {bands?.map((v, i) => {
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

            {/* Keyboard Shortcuts */}
            <section>
              <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                <Monitor className="w-4 h-4 text-muted-foreground" />
                Keyboard Shortcuts
              </h3>
              <p className="text-[11px] text-muted-foreground mb-3">
                Configure global keyboard shortcuts. Click a shortcut to record a new key binding.
              </p>
              <div className="space-y-1">
                {(Object.keys(shortcutLabels) as (keyof ShortcutMap)[]).map((key) => (
                  <div key={key} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-white/5">
                    <span className="text-[11px] text-foreground/70">{shortcutLabels[key]}</span>
                    <button
                      onClick={() => handleRecordShortcut(key)}
                      className={clsx(
                        'px-2 py-0.5 rounded text-[10px] font-mono border transition-all min-w-[80px] text-right',
                        recording === key
                          ? 'border-primary bg-primary/20 text-primary animate-pulse'
                          : 'border-border/50 text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                      )}
                    >
                      {recording === key ? 'Press key…' : shortcuts[key]}
                    </button>
                  </div>
                ))}
                <button
                  onClick={handleResetShortcuts}
                  className="text-[10px] text-muted-foreground hover:text-foreground mt-2 transition-colors"
                >
                  Reset to defaults
                </button>
              </div>
            </section>

            <Separator className="border-border/20" />

            {/* Notifications */}
            <section>
              <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                <Bell className="w-4 h-4 text-muted-foreground" />
                Song Change Notifications
              </h3>
              <p className="text-[11px] text-muted-foreground mb-3">
                Show an OS notification when a new track starts playing.
                On Windows this appears as a toast in the bottom-right corner.
                The Windows media controls widget (play / pause / skip) is always
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

          {/* ── SCROBBLE TAB ── */}
          <TabsContent value="scrobble" className="flex-1 overflow-y-auto px-6 pb-6 space-y-6 mt-4">
            {scrobbleLoading ? (
              <div className="text-xs text-muted-foreground py-8 text-center">Loading scrobble config...</div>
            ) : scrobbleConfig ? (
              <>
                {/* Last.fm */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ExternalLink className="w-3.5 h-3.5 text-red-400" />
                      <h3 className="text-sm font-semibold">Last.fm</h3>
                    </div>
                    <button
                      onClick={async () => {
                        const updated = { ...scrobbleConfig, lastfm: { ...scrobbleConfig.lastfm, enabled: !scrobbleConfig.lastfm.enabled } };
                        setScrobbleConfig(updated);
                        await saveScrobbleConfig(updated);
                      }}
                      className={clsx(
                        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                        'transition-colors duration-200 focus:outline-none',
                        scrobbleConfig.lastfm.enabled ? 'bg-primary' : 'bg-border',
                      )}
                      role="switch"
                      aria-checked={scrobbleConfig.lastfm.enabled}
                    >
                      <span
                        className={clsx(
                          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg',
                          'transform transition duration-200',
                          scrobbleConfig.lastfm.enabled ? 'translate-x-4' : 'translate-x-0',
                        )}
                      />
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-3">
                    Scrobble plays to your Last.fm profile.
                    {scrobbleConfig.lastfm.enabled && !scrobbleConfig.lastfm.sessionKey && (
                      <span className="text-amber-400 block mt-1">
                        Needs authentication — connect your Last.fm account below.
                      </span>
                    )}
                  </p>

                  {/* API Key */}
                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">API Key</label>
                    <Input
                      value={scrobbleConfig.lastfm.apiKey}
                      onChange={async (e) => {
                        const updated = { ...scrobbleConfig, lastfm: { ...scrobbleConfig.lastfm, apiKey: e.target.value } };
                        setScrobbleConfig(updated);
                        await saveScrobbleConfig(updated);
                      }}
                      placeholder="Your Last.fm API key"
                      className="h-7 text-xs bg-black/20 border-border/50"
                    />
                  </div>

                  {/* API Secret */}
                  <div className="space-y-2 mt-2">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">API Secret</label>
                    <Input
                      type="password"
                      value={scrobbleConfig.lastfm.apiSecret}
                      onChange={async (e) => {
                        const updated = { ...scrobbleConfig, lastfm: { ...scrobbleConfig.lastfm, apiSecret: e.target.value } };
                        setScrobbleConfig(updated);
                        await saveScrobbleConfig(updated);
                      }}
                      placeholder="Your Last.fm API secret"
                      className="h-7 text-xs bg-black/20 border-border/50"
                    />
                  </div>

                  {/* Auth link */}
                  {scrobbleConfig.lastfm.apiKey && !scrobbleConfig.lastfm.sessionKey && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[10px] text-muted-foreground">
                        1. Click the button below to authorize PLAYD on Last.fm
                      </p>
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1 w-full"
                        onClick={() => {
                          const authUrl = getLastfmAuthUrl(
                            scrobbleConfig.lastfm.apiKey,
                            window.location.origin + '/lastfm-callback'
                          );
                          window.open(authUrl, '_blank', 'width=600,height=600');
                        }}
                      >
                        <ExternalLink className="w-3 h-3" />
                        Connect Last.fm
                      </Button>
                      <p className="text-[10px] text-muted-foreground">
                        2. After authorizing, paste the token from the URL below:
                      </p>
                      <div className="flex gap-2">
                        <Input
                          value={scrobbleLastfmToken}
                          onChange={e => setScrobbleLastfmToken(e.target.value)}
                          placeholder="Paste token here"
                          className="h-7 text-xs bg-black/20 border-border/50"
                        />
                        <Button
                          size="sm"
                          className="h-7 text-xs shrink-0"
                          disabled={!scrobbleLastfmToken}
                          onClick={async () => {
                            const result = await getLastfmSession(
                              scrobbleConfig.lastfm.apiKey,
                              scrobbleConfig.lastfm.apiSecret,
                              scrobbleLastfmToken
                            );
                            if (result) {
                              const updated = {
                                ...scrobbleConfig,
                                lastfm: {
                                  ...scrobbleConfig.lastfm,
                                  sessionKey: result.sessionKey,
                                  username: result.username,
                                },
                              };
                              setScrobbleConfig(updated);
                              await saveScrobbleConfig(updated);
                              setScrobbleLastfmToken('');
                            }
                          }}
                        >
                          Verify
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Connected state */}
                  {scrobbleConfig.lastfm.sessionKey && (
                    <div className="mt-3 p-3 rounded-md bg-black/20 border border-border/30">
                      <div className="flex items-center gap-2 text-xs">
                        <Check className="w-3.5 h-3.5 text-green-400" />
                        <span>Connected as <strong>{scrobbleConfig.lastfm.username}</strong></span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] text-muted-foreground mt-2"
                        onClick={async () => {
                          const updated = {
                            ...scrobbleConfig,
                            lastfm: { ...scrobbleConfig.lastfm, sessionKey: '', username: '' },
                          };
                          setScrobbleConfig(updated);
                          await saveScrobbleConfig(updated);
                        }}
                      >
                        Disconnect
                      </Button>
                    </div>
                  )}
                </section>

                <Separator className="border-border/20" />

                {/* ListenBrainz */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
                      <h3 className="text-sm font-semibold">ListenBrainz</h3>
                    </div>
                    <button
                      onClick={async () => {
                        const updated = { ...scrobbleConfig, listenbrainz: { ...scrobbleConfig.listenbrainz, enabled: !scrobbleConfig.listenbrainz.enabled } };
                        setScrobbleConfig(updated);
                        await saveScrobbleConfig(updated);
                      }}
                      className={clsx(
                        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                        'transition-colors duration-200 focus:outline-none',
                        scrobbleConfig.listenbrainz.enabled ? 'bg-primary' : 'bg-border',
                      )}
                      role="switch"
                      aria-checked={scrobbleConfig.listenbrainz.enabled}
                    >
                      <span
                        className={clsx(
                          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg',
                          'transform transition duration-200',
                          scrobbleConfig.listenbrainz.enabled ? 'translate-x-4' : 'translate-x-0',
                        )}
                      />
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-3">
                    Scrobble plays to your ListenBrainz profile. You need your user token.
                  </p>

                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">User Token</label>
                    <Input
                      type="password"
                      value={scrobbleConfig.listenbrainz.userToken}
                      onChange={async (e) => {
                        const updated = { ...scrobbleConfig, listenbrainz: { ...scrobbleConfig.listenbrainz, userToken: e.target.value } };
                        setScrobbleConfig(updated);
                        await saveScrobbleConfig(updated);
                      }}
                      placeholder="Your ListenBrainz user token"
                      className="h-7 text-xs bg-black/20 border-border/50"
                    />
                  </div>

                  {scrobbleConfig.listenbrainz.userToken && (
                    <div className="mt-3 p-3 rounded-md bg-black/20 border border-border/30">
                      <div className="flex items-center gap-2 text-xs">
                        <Check className="w-3.5 h-3.5 text-green-400" />
                        <span>User token configured</span>
                      </div>
                    </div>
                  )}
                </section>
              </>
            ) : null}
          </TabsContent>

          {/* ── APPEARANCE TAB ── */}
          <TabsContent value="appearance" className="flex-1 overflow-y-auto px-6 pb-6 space-y-6 mt-4">
            <section>
              <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                <Palette className="w-3.5 h-3.5 text-primary" />
                Theme
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                Choose a colour scheme. Your selection is saved and applied immediately.
              </p>

              <div className="grid grid-cols-2 gap-3">
                {THEME_KEYS.map((key) => {
                  const t = THEMES[key];
                  const isActive = activeTheme === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setTheme(key)}
                      className={clsx(
                        'relative rounded-lg overflow-hidden border-2 transition-all text-left group',
                        isActive
                          ? 'border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.4)]'
                          : 'border-border/40 hover:border-border',
                      )}
                    >
                      {/* Colour preview block */}
                      <div
                        className="h-14 w-full flex items-end p-2"
                        style={{ background: t.preview.bg }}
                      >
                        {/* Accent dot */}
                        <span
                          className="w-4 h-4 rounded-full border-2 border-black/20 ml-auto"
                          style={{ background: t.preview.accent }}
                        />
                      </div>

                      {/* Label row */}
                      <div
                        className="flex items-center justify-between px-2.5 py-1.5"
                        style={{ background: t.preview.bg, borderTop: `1px solid rgba(255,255,255,0.06)` }}
                      >
                        <span className="text-[11px] font-medium" style={{ color: '#ccc' }}>
                          {t.label}
                        </span>
                        {isActive && (
                          <Check className="w-3 h-3 text-primary shrink-0" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
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
                Everything is stored locally in your browser using IndexedDB.
                Nothing is sent to a server — your library lives on this device.
              </p>

              <div className="space-y-3">
                <div className="p-3 rounded-md bg-green-500/5 border border-green-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Database className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-xs font-semibold text-green-400">Stored on this device</span>
                    <Badge variant="outline" className="text-[9px] h-4 border-green-500/30 text-green-400">IndexedDB</Badge>
                  </div>
                  <ul className="text-[11px] text-muted-foreground space-y-1 pl-5 list-disc">
                    <li>Track metadata — title, artist, album, year, genre, play count</li>
                    <li>Playlists and their track order</li>
                    <li>EQ presets (custom and built-in)</li>
                  </ul>
                </div>

                <div className="p-3 rounded-md bg-blue-500/5 border border-blue-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Smartphone className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-semibold text-blue-400">Install as an app — runs anywhere</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    PLAYD is a fully installable PWA. Add it to your home screen on iOS or Android, or install it from Chrome/Edge on desktop — it runs like a native app with no browser chrome, offline support, and OS media key integration.
                  </p>
                </div>
              </div>
            </section>

            <Separator className="border-border/20" />

            <section>
              <h3 className="text-sm font-semibold mb-2">About PLAYD</h3>
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
