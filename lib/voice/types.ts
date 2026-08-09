/**
 * Shared interface for voice STT providers.
 *
 * Kept separate from the session machine so hooks and transports can swap
 * independently.
 */
export interface VoiceProviderState {
  readonly isListening: boolean;
  readonly isSupported: boolean;
}

export interface VoiceProviderControls {
  start: () => Promise<void> | void;
  stop: () => void;
  toggle: () => Promise<void> | void;
}

export type VoiceProvider = VoiceProviderState & VoiceProviderControls;

export interface VoiceProviderCallbacks {
  onSpeechStart?: () => void;
  onInterim?: (text: string) => void;
  onTurnEnd?: (finalText: string) => void;
  onError?: (err: Error, fatal: boolean) => void;
}
