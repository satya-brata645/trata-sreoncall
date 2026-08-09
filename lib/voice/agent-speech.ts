"use client";

import { useSyncExternalStore } from "react";

/**
 * The line the agent is currently saying.
 *
 * A store rather than component state because two surfaces show it — the
 * command bar's narration and the voice dots — and they must never disagree
 * about whether the agent is mid-sentence.
 *
 * The mock agent (`lib/mock/agent.ts`) writes here as it narrates, so narration
 * and UI focus move together even without a speech pipeline: §5 of the concept
 * note asks for those to stay in sync, and text-only narration is still
 * narration.
 */

export interface AgentSpeech {
  /** What is being said right now. Empty when nothing is. */
  line: string;
  isSpeaking: boolean;
}

let state: AgentSpeech = { line: "", isSpeaking: false };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setSpokenLine(text: string): void {
  state = { line: text, isSpeaking: text.length > 0 };
  emit();
}

export function stoppedSpeaking(): void {
  state = { line: "", isSpeaking: false };
  emit();
}

export function getAgentSpeech(): AgentSpeech {
  return state;
}

export function subscribeAgentSpeech(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_SPEECH: AgentSpeech = { line: "", isSpeaking: false };

export function useAgentSpeech(): AgentSpeech {
  return useSyncExternalStore(subscribeAgentSpeech, getAgentSpeech, () => SERVER_SPEECH);
}
