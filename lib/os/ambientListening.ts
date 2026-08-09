"use client";

/**
 * Whether the microphone is open, waiting for "hey SOS".
 *
 * **Off by default, and per person.** Turning this on opens a microphone and
 * streams it to Deepgram continuously — not on a button press, not while a
 * dialog is up, but for as long as the desktop is on screen. That is a real
 * promise to make to a security customer, so it is opt-in, it is visible while
 * it runs, and it is revocable in one click.
 *
 * Same external-store shape as `pinnedApps` and `agentMode`, so the menu bar
 * toggle, the indicator and the session hook all read one copy and cannot
 * disagree about whether the mic is live.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/auth/mockUser";

interface AmbientState {
  /** Who this belongs to, or null before Clerk resolves. */
  scope: string | null;
  enabled: boolean;
}

const STORAGE_PREFIX = "sos:ambient-listening";

/** Stable empty snapshot, also the SSR snapshot, so hydration cannot mismatch. */
const EMPTY: AmbientState = { scope: null, enabled: false };

let current: AmbientState = EMPTY;
const listeners = new Set<() => void>();

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}:${scope}`;
}

/** localStorage throws in private mode; never worth taking the app down for. */
function load(scope: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(scope)) === "true";
  } catch {
    return false;
  }
}

function save(scope: string, enabled: boolean): void {
  try {
    window.localStorage.setItem(storageKey(scope), String(enabled));
  } catch {
    // Ignored deliberately — see load().
  }
}

function commit(next: AmbientState): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): AmbientState {
  return current;
}

function getServerSnapshot(): AmbientState {
  return EMPTY;
}

/** Idempotent — safe to call from every consumer's effect. */
function hydrate(scope: string): void {
  if (current.scope === scope) return;
  commit({ scope, enabled: load(scope) });
}

export interface UseAmbientListeningResult {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
}

export function useAmbientListening(): UseAmbientListeningResult {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { userId } = useAuth();

  // Person-scoped rather than org-scoped: whether your microphone is open is
  // about you and the machine you are sitting at, not about your workspace.
  const scope = userId ?? null;

  useEffect(() => {
    if (scope) hydrate(scope);
  }, [scope]);

  const setEnabled = useCallback((enabled: boolean) => {
    const scopeNow = current.scope;
    if (!scopeNow) return;
    save(scopeNow, enabled);
    commit({ ...current, enabled });
  }, []);

  const toggle = useCallback(() => {
    setEnabled(!current.enabled);
  }, [setEnabled]);

  // Before the scope resolves the snapshot is the shared empty one, so a
  // previous user's preference can never leave a microphone open for the next.
  const enabled = state.scope !== null && state.scope === scope && state.enabled;

  return { enabled, setEnabled, toggle };
}
