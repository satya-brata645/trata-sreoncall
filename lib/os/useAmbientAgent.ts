"use client";

/**
 * The desktop's view of the agent's voice, wired to React.
 *
 * In the full product this hook owns a live session: a transcriber feeding a
 * state machine, a wake word, barge-in arbitration. None of that is in this
 * build (see `lib/voice/mic-session.ts`), so the mode is derived from the two
 * things that *are* real — whether the agent is mid-narration
 * (`agent-speech`), and whether ambient listening has been switched on.
 *
 * The shape is unchanged on purpose. The menu bar, the aurora and the command
 * bar all read `mode`, and when a real session lands it takes over this hook
 * without touching any of them.
 */

import { useAgentSpeech } from "@/lib/voice/agent-speech";
import { isMicSupported } from "@/lib/voice/mic-session";
import type { VoiceMode } from "@/lib/voice/session";
import { useAmbientListening } from "./ambientListening";
import { useAgentSummon } from "./AgentSummonContext";

export interface AmbientAgentState {
  /** True whenever the microphone is open. Drives the indicator. */
  isListening: boolean;
  /** True while the session is taking an instruction. */
  isAwake: boolean;
  /** The session's mode — what narration and the indicator derive from. */
  mode: VoiceMode;
  /** Whether this browser can do it at all. */
  isSupported: boolean;
  /** Live partial transcript while awake, for the command bar to echo. */
  heard: string;
}

export function useAmbientAgent(): AmbientAgentState {
  const { enabled } = useAmbientListening();
  const summon = useAgentSummon();
  const speech = useAgentSpeech();

  const mode: VoiceMode = speech.isSpeaking
    ? "speaking"
    : summon?.isPresent
      ? "awake"
      : enabled
        ? "ambient"
        : "idle";

  return {
    // Nothing captures audio in this build, so the honest answer is never.
    isListening: false,
    isAwake: mode === "awake",
    mode,
    isSupported: isMicSupported(),
    heard: "",
  };
}
