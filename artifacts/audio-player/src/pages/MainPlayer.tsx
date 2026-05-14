import { Sidebar } from '@/components/layout/Sidebar';
import { TrackListPanel } from '@/components/library/TrackListPanel';
import { QueuePanel } from '@/components/queue/QueuePanel';
import { LyricsPanel } from '@/components/lyrics/LyricsPanel';
import { TransportBar } from '@/components/layout/TransportBar';
import { AudioEngine } from '@/components/player/AudioEngine';
import { MiniPlayerRoot } from '@/components/player/MiniPlayerRoot';
import { EqPanel } from '@/components/player/EqPanel';
import { LockOverlay } from '@/components/layout/LockOverlay';
import { PreferencesPanel } from '@/components/layout/PreferencesPanel';
import { ClipStudioModal } from '@/components/editor/ClipStudioModal';
import { useEffect, useState, useCallback } from 'react';
import { useFileSystem } from '@/hooks/use-file-system';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useLibraryAutoRestore } from '@/hooks/use-library-auto-restore';
import type { LocalTrack } from '@/lib/track-store';

export default function MainPlayer() {
  const { rescanAll } = useFileSystem();
  const { isQueueOpen, isLyricsOpen, pause } = useAudioPlayer();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [clipStudioTrack, setClipStudioTrack] = useState<LocalTrack | null>(null);
  useKeyboardShortcuts();

  const { needsRestore, restore, dismiss } = useLibraryAutoRestore(rescanAll);

  const handleOpenClipStudio = useCallback((track: LocalTrack) => {
    pause();
    setClipStudioTrack(track);
  }, [pause]);

  const handleCloseClipStudio = useCallback(() => {
    setClipStudioTrack(null);
  }, []);

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden selection:bg-primary/30">
      <AudioEngine />
      <LockOverlay />

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 sm:hidden">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 w-72 z-50 shadow-2xl">
            <Sidebar onClose={() => setMobileSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar: always visible on desktop, hidden on mobile */}
        <div className="hidden sm:block">
          <Sidebar />
        </div>

        <TrackListPanel
          onMenuOpen={() => setMobileSidebarOpen(true)}
          onEditInClipStudio={handleOpenClipStudio}
          needsRestore={needsRestore}
          onRestore={restore}
          onDismissRestore={dismiss}
        />
        {isQueueOpen && <QueuePanel />}
        {isLyricsOpen && <LyricsPanel />}

        {/* Floating Overlays */}
        <EqPanel />
      </div>

      <PreferencesPanel />

      {/* Spectrum visualizer — sits just above the transport bar */}
      <SpectrumBar />

      {/* Footer Transport */}
      <TransportBar />

      {/* Mini Player — PiP or draggable overlay */}
      <MiniPlayerRoot />

      {/* Clip Studio — full-screen overlay */}
      {clipStudioTrack && (
        <ClipStudioModal
          track={clipStudioTrack}
          onClose={handleCloseClipStudio}
        />
      )}
    </div>
  );
}
