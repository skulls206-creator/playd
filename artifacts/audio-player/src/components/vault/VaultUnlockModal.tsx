import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, Loader2, AlertCircle } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import {
  useVaultUnlock,
  deriveVaultKey,
  fulfillVaultKey,
  cancelVaultUnlock,
} from '@/hooks/use-vault-crypto';
import { sharedAudioContextRef } from '@/lib/audio-context-ref';

export function VaultUnlockModal() {
  const { isUnlocking } = useVaultUnlock();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleUnlock = async () => {
    if (!password.trim()) { setError('Password is required.'); return; }
    setError(null);
    setIsLoading(true);

    // Resume the AudioContext NOW while we are still inside the button-click
    // user gesture. Browsers expire the activation window after ~5 seconds, so
    // by the time PBKDF2 + network fetch + AES-GCM decrypt completes the window
    // is often gone. Resuming here gives us a guaranteed running AudioContext
    // for the subsequent audio.play() call in AudioEngine.
    sharedAudioContextRef.current?.resume().catch(() => {});

    try {
      const { salt } = await customFetch<{ salt: string }>('/api/vault/key-salt');
      const key = await deriveVaultKey(password, salt);
      await fulfillVaultKey(key);
      setPassword('');
    } catch {
      setError('Failed to derive vault key. Check your password and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setPassword('');
    setError(null);
    cancelVaultUnlock();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) handleUnlock();
    if (e.key === 'Escape') handleCancel();
  };

  return (
    <Dialog
      open={isUnlocking}
      onOpenChange={(open) => { if (!open) handleCancel(); }}
    >
      <DialogContent className="sm:max-w-sm bg-zinc-900 border-zinc-700 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            Unlock Vault
          </DialogTitle>
          <DialogDescription className="text-zinc-400 text-sm">
            Enter your account password to decrypt your vault tracks.
            Your password never leaves this device.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 mt-2">
          <Input
            type="password"
            placeholder="Account password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            disabled={isLoading}
            className="bg-zinc-800 border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-primary"
          />

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 px-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={isLoading}
              className="text-zinc-400 hover:text-zinc-100"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleUnlock}
              disabled={isLoading || !password.trim()}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {isLoading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Deriving key…</>
                : <><Lock className="w-3.5 h-3.5 mr-1.5" />Unlock</>
              }
            </Button>
          </div>

          <p className="text-[10px] text-zinc-500 text-center">
            The key is stored in this browser session only and cleared when the tab closes.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
