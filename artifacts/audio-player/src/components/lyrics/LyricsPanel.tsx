import { useRef, useEffect, useState, useCallback } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { parseLrc } from '@/lib/lrc-parser';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { X, FileText, ClipboardPaste, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';

function EmptyState({
  onPaste,
  onLoadFile,
}: {
  onPaste: () => void;
  onLoadFile: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="w-12 h-12 rounded-full border border-dashed border-border flex items-center justify-center">
        <FileText className="w-5 h-5 text-border" />
      </div>
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground font-medium">No lyrics loaded</p>
        <p className="text-[11px] text-muted-foreground/50">Paste LRC text or load a file</p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-[160px]">
        <Button variant="outline" size="sm" className="gap-2 text-xs h-7" onClick={onPaste}>
          <ClipboardPaste className="w-3.5 h-3.5" />
          Paste LRC
        </Button>
        {/* File picker: hidden on mobile */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-xs h-7 hidden sm:flex"
          onClick={onLoadFile}
        >
          <FileText className="w-3.5 h-3.5" />
          Load .lrc file
        </Button>
      </div>
    </div>
  );
}

function PasteView({
  onConfirm,
  onCancel,
}: {
  onConfirm: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');

  return (
    <div className="flex-1 flex flex-col gap-2 p-3">
      <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Paste LRC or plain lyrics</p>
      <textarea
        className="flex-1 resize-none rounded border border-border bg-black/20 p-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary font-mono leading-relaxed"
        placeholder={"[00:12.00] First line\n[00:17.50] Second line\n…"}
        value={text}
        onChange={e => setText(e.target.value)}
        autoFocus
      />
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1 h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="flex-1 h-7 text-xs"
          disabled={!text.trim()}
          onClick={() => onConfirm(text)}
        >
          Load lyrics
        </Button>
      </div>
    </div>
  );
}

export function LyricsPanel() {
  const { currentTrack, progress, lyrics, setLyrics, clearLyrics, toggleLyrics } = useAudioPlayer();
  const [showPaste, setShowPaste] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // Determine active line index (last line with timeSec <= progress)
  const isSynced = lyrics !== null && lyrics.some(l => l.timeSec > 0);
  const activeIdx = (() => {
    if (!lyrics || !isSynced) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].timeSec <= progress) idx = i;
      else break;
    }
    return idx;
  })();

  // Auto-scroll active line into view
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeIdx]);

  // Hydrate lyrics when track changes
  useEffect(() => {
    if (!currentTrack) return;
    const stored = localStorage.getItem(`playd_lyrics_${currentTrack.id}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLyrics(currentTrack.id, parsed);
          return;
        }
      } catch {}
    }
    // No stored lyrics for this track — reset state
    setLyrics(currentTrack.id, []);
  }, [currentTrack?.id]);

  const handleConfirmPaste = useCallback((text: string) => {
    if (!currentTrack) return;
    const { lines } = parseLrc(text);
    setLyrics(currentTrack.id, lines);
    setShowPaste(false);
  }, [currentTrack, setLyrics]);

  const handleLoadFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentTrack) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      if (!text) return;
      const { lines } = parseLrc(text);
      setLyrics(currentTrack.id, lines);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }, [currentTrack, setLyrics]);

  const handleClear = useCallback(() => {
    if (currentTrack) clearLyrics(currentTrack.id);
  }, [currentTrack, clearLyrics]);

  const hasLyrics = lyrics !== null && lyrics.length > 0;

  return (
    <div className="w-72 flex-shrink-0 flex flex-col bg-card border-l border-border overflow-hidden">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".lrc,.txt"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 h-8 border-b border-border shrink-0 bg-black/20">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <FileText className="w-3 h-3" />
          Lyrics
        </div>
        <div className="flex items-center gap-0.5">
          {hasLyrics && !showPaste && (
            <button
              onClick={handleClear}
              className="h-5 w-5 inline-flex items-center justify-center rounded-sm text-muted-foreground/60 hover:text-destructive transition-colors"
              title="Clear lyrics"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          <Button
            variant="ghost" size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-foreground"
            onClick={toggleLyrics}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Body */}
      {!currentTrack ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground/50 text-xs p-6 text-center">
          Play a track to load lyrics
        </div>
      ) : showPaste ? (
        <PasteView
          onConfirm={handleConfirmPaste}
          onCancel={() => setShowPaste(false)}
        />
      ) : !hasLyrics ? (
        <EmptyState
          onPaste={() => setShowPaste(true)}
          onLoadFile={handleLoadFile}
        />
      ) : (
        <ScrollArea className="flex-1">
          <div className="py-6 px-4 space-y-0.5">
            {!isSynced && (
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 text-center mb-4 font-semibold">
                Plain text — no timestamps
              </p>
            )}
            {lyrics!.map((line, i) => {
              const isActive = i === activeIdx;
              const isPast = isSynced && i < activeIdx;
              return (
                <div
                  key={i}
                  ref={isActive ? activeRef : null}
                  className={clsx(
                    'py-1 px-2 rounded text-sm leading-relaxed transition-all duration-300 text-center',
                    isActive
                      ? 'text-primary font-semibold scale-[1.03]'
                      : isPast
                        ? 'text-muted-foreground/40'
                        : 'text-muted-foreground/70',
                  )}
                >
                  {line.text || <span className="opacity-30">♪</span>}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Quick-action footer when lyrics are loaded */}
      {hasLyrics && !showPaste && (
        <div className="border-t border-border/50 px-3 py-1.5 flex gap-2">
          <button
            onClick={() => setShowPaste(true)}
            className="flex-1 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors text-center"
          >
            Replace
          </button>
          <button
            onClick={handleLoadFile}
            className="flex-1 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors text-center hidden sm:block"
          >
            Load file
          </button>
        </div>
      )}
    </div>
  );
}
