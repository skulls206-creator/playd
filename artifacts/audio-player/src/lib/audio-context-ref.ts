/**
 * Module-level refs for the shared Web Audio objects.
 * Keeping them in a separate file avoids Vite Fast Refresh complaints
 * about non-component exports in React component modules.
 */
export const sharedAnalyserRef:     { current: AnalyserNode  | null } = { current: null };
export const sharedAudioContextRef: { current: AudioContext  | null } = { current: null };
