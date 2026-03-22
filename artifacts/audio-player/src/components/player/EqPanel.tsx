import { useAudioPlayer } from '@/hooks/use-audio-player';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { X, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const FREQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

export function EqPanel() {
  const { isEqOpen, toggleEq, eqBands, setEqBand } = useAudioPlayer();

  return (
    <AnimatePresence>
      {isEqOpen && (
        <motion.div
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="absolute bottom-20 right-4 w-96 bg-card/95 backdrop-blur-xl border border-border/50 shadow-2xl rounded-xl overflow-hidden z-30"
        >
          <div className="flex items-center justify-between p-3 border-b border-white/5 bg-black/20">
            <h3 className="text-sm font-semibold text-primary tracking-wide">Graphic Equalizer</h3>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Save className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={toggleEq}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          
          <div className="p-6">
            <div className="flex justify-between h-40">
              {eqBands.map((val, idx) => (
                <div key={idx} className="flex flex-col items-center gap-3">
                  <div className="flex-1 py-2">
                    <Slider
                      orientation="vertical"
                      value={[val]}
                      min={-12}
                      max={12}
                      step={0.5}
                      onValueChange={([newVal]) => setEqBand(idx, newVal)}
                      className="h-full"
                    />
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground w-8 text-center">{FREQ_LABELS[idx]}</span>
                </div>
              ))}
            </div>
            
            <div className="flex justify-between px-2 mt-2 border-t border-border/30 pt-2 text-[10px] font-mono text-muted-foreground/50">
              <span>-12dB</span>
              <span>0dB</span>
              <span>+12dB</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
