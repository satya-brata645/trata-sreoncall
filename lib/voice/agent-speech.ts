"use client";

import { useSyncExternalStore } from "react";

/**
 * What the agent is saying, and whether it is still saying it.
 *
 * Two consumers need this and neither is inside the chat tree:
 *
 * - The command bar shows the agent's narration while it drives.
 * - The voice session needs to know when playback has really drained.
 *
 * Same external-store shape as the other desktop singletons, so every surface
 * reads one copy and cannot disagree about whether the agent is mid-sentence.
 */

export interface AgentSpeech {
  /** The sentence currently being spoken, or "" when silent. */
  line: string;
  /** True while audio is scheduled or playing. */
  speaking: boolean;
  /** Backward-compatible alias for existing local consumers. */
  isSpeaking: boolean;
}

const SILENT: AgentSpeech = { line: "", speaking: false, isSpeaking: false };

let state: AgentSpeech = SILENT;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function set(next: AgentSpeech): void {
  if (
    next.line === state.line &&
    next.speaking === state.speaking &&
    next.isSpeaking === state.isSpeaking
  ) {
    return;
  }
  state = next;
  emit();
}

export function setSpokenLine(text: string): void {
  const line = text.trim();
  if (!line) return;
  set({ line, speaking: true, isSpeaking: true });
}

export function stoppedSpeaking(): void {
  set(SILENT);
}

export function getAgentSpeech(): AgentSpeech {
  return state;
}

export function subscribeAgentSpeech(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAgentSpeech(): AgentSpeech {
  return useSyncExternalStore(subscribeAgentSpeech, getAgentSpeech, () => SILENT);
}
