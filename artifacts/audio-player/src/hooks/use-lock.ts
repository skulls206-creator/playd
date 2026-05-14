import { create } from 'zustand';

interface LockState {
  isLocked: boolean;
  lock: () => void;
  unlock: () => void;
}

export const useLock = create<LockState>((set) => ({
  isLocked: false,
  lock: () => set({ isLocked: true }),
  unlock: () => set({ isLocked: false }),
}));
