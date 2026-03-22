import { useAudioPlayer } from '@/hooks/use-audio-player';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { X, Minus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const FREQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

function formatDb(val: number) {
  if (val === 0) return '0';
  return (val > 0 ? '+' : '') + val.toFixed(val % 1 === 0 ? 0 : 1);
}

export function EqPanel() {
  const { isEqOpen, toggleEq, eqBands, setEqBand } = useAudioPlayer();

  const resetFlat = () => eqBands.forEach((_, i) => setEqBand(i, 0));
  const isFlat = eqBands.every(v => v === 0);

  return (
    <AnimatePresence>
      {isEqOpen && (
        <motion.div
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="absolute bottom-20 right-4 w-[440px] bg-card/97 backdrop-blur-xl border border-border/50 shadow-2xl rounded-xl overflow-hidden z-30"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 h-10 border-b border-white/5 bg-black/20">
            <h3 className="text-xs font-semibold text-primary tracking-widest uppercase">Graphic Equalizer</h3>
            <div className="flex gap-1 items-center">
              <Button
                variant="ghost" size="sm"
                className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground gap-1"
                onClick={resetFlat}
                disabled={isFlat}
                title="Reset all bands to flat (0 dB)"
              >
                <Minus className="w-3 h-3" />
                Flat
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={toggleEq}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* EQ body */}
          <div className="flex p-4 gap-2">
            {/* dB scale on the left */}
            <div className="flex flex-col justify-between text-right pr-2 pb-6 shrink-0" style={{ height: 160 }}>
              <span className="text-[9px] font-mono text-muted-foreground/60">+12</span>
              <span className="text-[9px] font-mono text-muted-foreground/60">+6</span>
              <span className="text-[9px] font-mono text-primary/60">0</span>
              <span className="text-[9px] font-mono text-muted-foreground/60">-6</span>
              <span className="text-[9px] font-mono text-muted-foreground/60">-12</span>
            </div>

            {/* Sliders */}
            <div className="flex-1 relative">
              {/* 0 dB center line */}
              <div
                className="absolute left-0 right-0 border-t border-primary/20 pointer-events-none z-10"
                style={{ top: '50%' }}
              />

              <div className="flex justify-around" style={{ height: 160 }}>
                {eqBands.map((val, idx) => (
                  <div key={idx} className="flex flex-col items-center gap-0" style={{ width: 32 }}>
                    <div className="flex-1 flex items-center justify-center">
                      <Slider
                        orientation="vertical"
                        value={[val]}
                        min={-12}
                        max={12}
                        step={0.5}
                        onValueChange={([newVal]) => setEqBand(idx, newVal)}
                        className="h-36"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Freq labels + current dB values */}
          <div className="flex justify-around px-4 pb-3 pl-14">
            {eqBands.map((val, idx) => (
              <div key={idx} className="flex flex-col items-center gap-0.5" style={{ width: 32 }}>
                <span
                  className="text-[9px] font-mono tabular-nums leading-none"
                  style={{ color: val === 0 ? 'hsl(var(--muted-foreground))' : val > 0 ? 'hsl(var(--primary))' : 'hsl(var(--destructive) / 0.8)' }}
                >
                  {formatDb(val)}
                </span>
                <span className="text-[9px] font-mono text-muted-foreground/50">{FREQ_LABELS[idx]}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
