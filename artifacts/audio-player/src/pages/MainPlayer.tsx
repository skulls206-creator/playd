import { Sidebar } from '@/components/layout/Sidebar';
import { TrackListPanel } from '@/components/library/TrackListPanel';
import { QueuePanel } from '@/components/queue/QueuePanel';
import { TransportBar } from '@/components/layout/TransportBar';
import { AudioEngine } from '@/components/player/AudioEngine';
import { EqPanel } from '@/components/player/EqPanel';
import { PreferencesPanel } from '@/components/layout/PreferencesPanel';
import { useEffect } from 'react';
import { useFileSystem } from '@/hooks/use-file-system';
import { useAudioPlayer } from '@/hooks/use-audio-player';

export default function MainPlayer() {
  const { getStoredHandles } = useFileSystem();
  const { isQueueOpen } = useAudioPlayer();

  useEffect(() => {
    getStoredHandles().then(() => {});
  }, []);

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden selection:bg-primary/30">
      <AudioEngine />
      
      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar />
        <TrackListPanel />
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
