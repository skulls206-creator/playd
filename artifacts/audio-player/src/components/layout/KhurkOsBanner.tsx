import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useKhurkOs } from '@/hooks/use-khurk-os';

export function KhurkOsBanner() {
  const { isEmbedded, isDismissed, applyTheme, dismiss } = useKhurkOs();

  if (!isEmbedded || isDismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[300] flex items-center gap-3 px-4 py-2.5 bg-zinc-900/95 border-b border-zinc-700/60 backdrop-blur-md shadow-lg text-sm animate-in slide-in-from-top-2 duration-300">
      <span className="flex-1 text-zinc-300 leading-snug">
        <span className="font-semibold text-zinc-100">Looks like you're in KHURK OS.</span>
        {' '}Want to match the theme?
      </span>

      <Button
        size="sm"
        className="h-7 text-xs px-3 shrink-0 rounded"
        onClick={applyTheme}
      >
        Yes, match it
      </Button>

      <button
        onClick={dismiss}
        className="text-zinc-500 hover:text-zinc-200 transition-colors shrink-0 p-0.5 rounded"
        aria-label="Dismiss KHURK OS banner"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
