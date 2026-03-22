import { Sidebar } from '@/components/layout/Sidebar';
import { TrackListPanel } from '@/components/library/TrackListPanel';
import { QueuePanel } from '@/components/queue/QueuePanel';
import { TransportBar } from '@/components/layout/TransportBar';
import { AudioEngine } from '@/components/player/AudioEngine';
import { EqPanel } from '@/components/player/EqPanel';
import { PreferencesPanel } from '@/components/layout/PreferencesPanel';
import { useEffect, useState } from 'react';
import { useFileSystem } from '@/hooks/use-file-system';
import { useAudioPlayer } from '@/hooks/use-audio-player';

export default function MainPlayer() {
  const { getStoredHandles } = useFileSystem();
  const { isQueueOpen } = useAudioPlayer();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    getStoredHandles().then(() => {});
  }, []);

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden selection:bg-primary/30">
      <AudioEngine />

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

        <TrackListPanel onMenuOpen={() => setMobileSidebarOpen(true)} />
        {isQueueOpen && <QueuePanel />}

        {/* Floating Overlays */}
        <EqPanel />
      </div>

      <PreferencesPanel />

      {/* Footer Transport */}
      <TransportBar />
    </div>
  );
}
