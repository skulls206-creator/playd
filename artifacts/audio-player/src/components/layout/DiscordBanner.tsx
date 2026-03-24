import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';

export function DiscordBanner() {
  const { showDiscordSuggestion, setTheme, dismissDiscordSuggestion } = useTheme();

  if (!showDiscordSuggestion) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[300] flex items-center gap-3 px-4 py-2.5 border-b backdrop-blur-md shadow-lg text-sm animate-in slide-in-from-top-2 duration-300"
      style={{
        background: 'rgba(43,45,49,0.97)',
        borderColor: 'rgba(88,101,242,0.35)',
      }}
    >
      <span className="text-[13px]" style={{ color: '#DBDEE1' }}>
        <span className="font-semibold" style={{ color: '#fff' }}>Detected Discord.</span>
        {' '}Switch to a matching theme?
      </span>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          className="h-7 text-xs px-3 rounded"
          style={{ background: '#5865F2', color: '#fff', border: 'none' }}
          onClick={() => setTheme('discordDark')}
        >
          Discord Dark
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs px-3 rounded"
          style={{ background: 'transparent', borderColor: '#5865F2', color: '#DBDEE1' }}
          onClick={() => setTheme('discord')}
        >
          Discord Gray
        </Button>
      </div>
      <button
        onClick={dismissDiscordSuggestion}
        className="shrink-0 p-0.5 rounded transition-colors"
        style={{ color: '#80848E' }}
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
