import { Sidebar } from '@/components/layout/Sidebar';
import { QueuePanel } from '@/components/queue/QueuePanel';
import { TransportBar } from '@/components/layout/TransportBar';
import { AudioEngine } from '@/components/player/AudioEngine';
import { EqPanel } from '@/components/player/EqPanel';
import { useEffect } from 'react';
import { useFileSystem } from '@/hooks/use-file-system';
import { Button } from '@/components/ui/button';
import { Music } from 'lucide-react';

export default function MainPlayer() {
  const { getStoredHandles, addFolder } = useFileSystem();

  // On mount, check if we have stored handles that need permission
  useEffect(() => {
    getStoredHandles().then(handles => {
      if (handles.length > 0) {
        // We have folders, but we wait for user interaction to request permission
        // A subtle banner could go here
      }
    });
  }, []);

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden selection:bg-primary/30">
      <AudioEngine />
      
      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar />
        <QueuePanel />
        
        {/* Floating Overlays */}
        <EqPanel />
      </div>

      {/* Footer Transport */}
      <TransportBar />
    </div>
  );
}
