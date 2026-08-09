"use client";

/**
 * What the agent may do without asking.
 *
 * Two values, and the distinction is the whole point:
 *
 *  - **The preference** is what this user picked. It lives here, per (user,
 *    org), and is a *preference* — nothing more.
 *  - **The ceiling** is what the organization permits. It comes from the
 *    server and cannot be raised from the client.
 *
 * The effective mode is the preference clamped to the ceiling, and **the
 * server clamps it again on every request**. This store exists so the UI can
 * show the right thing immediately; it is never the authority. A tampered
 * client changing the value here gets a clamped answer from the route tier and
 * nothing else (`SEC-5`).
 *
 * Shaped like `pinnedApps.ts` — an external store consumed through
 * `useSyncExternalStore` — so every surface reads one copy and the menu bar,
 * the controller and the chat request cannot disagree about the mode.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAuth, useOrganization } from "@/lib/auth/mockUser";

import {
  clampMode,
  DEFAULT_AGENT_MODE,
  OS_AGENT_MODES,
  type OsAgentMode,
} from "./agentProtocol";

interface ModeState {
  /** Who this belongs to, or null before Clerk resolves. */
  scope: string | null;
  preference: OsAgentMode;
  /** The org's maximum. `auto` until the server says otherwise. */
  ceiling: OsAgentMode;
}

const STORAGE_PREFIX = "sos:agent:mode";

/** Stable empty snapshot, also the SSR snapshot, so hydration cannot mismatch. */
const EMPTY: ModeState = {
  scope: null,
  preference: DEFAULT_AGENT_MODE,
  // The most permissive mode there is, which is what an unset ceiling means —
  // "nothing has been restricted", not "everything has been allowed". With two
  // modes those coincide; the clamp is still what decides.
  ceiling: "collab",
};

let current: ModeState = EMPTY;
const listeners = new Set<() => void>();

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}:${scope}`;
}

function isMode(value: unknown): value is OsAgentMode {
  return typeof value === "string" && (OS_AGENT_MODES as readonly string[]).includes(value);
}

/** localStorage throws in private mode; a mode preference is never worth taking the app down for. */
function load(scope: string): OsAgentMode {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    return isMode(raw) ? raw : DEFAULT_AGENT_MODE;
  } catch {
    return DEFAULT_AGENT_MODE;
  }
}

function save(scope: string, mode: OsAgentMode): void {
  try {
    window.localStorage.setItem(storageKey(scope), mode);
  } catch {
    // Ignored deliberately — see load().
  }
}

function commit(next: ModeState): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): ModeState {
  return current;
}

function getServerSnapshot(): ModeState {
  return EMPTY;
}

/** Idempotent — safe to call from every consumer's effect. */
function hydrate(scope: string): void {
  if (current.scope === scope) return;
  commit({ ...current, scope, preference: load(scope) });
}

/**
 * Record the organization's ceiling.
 *
 * Called once the server has told us. Lowering it never silently changes what
 * the user picked — the preference is kept, and the *effective* mode is what
 * gets clamped, so raising the ceiling again restores their choice rather than
 * making them re-pick it.
 */
export function setAgentModeCeiling(ceiling: OsAgentMode): void {
  if (current.ceiling === ceiling) return;
  commit({ ...current, ceiling });
}

/**
 * Where a chosen mode gets written so it survives this browser.
 *
 * Registered by `useAgentPolicy`, which owns the request. Injected rather than
 * imported so this module stays free of Clerk and React Query — it is read
 * from a transport callback and from render paths, and dragging a query client
 * in here would make that impossible.
 *
 * Absent means "nothing to persist to": `localStorage` alone, which is the
 * pre-server behaviour and the correct fallback rather than an error.
 */
let persistPreference: ((mode: OsAgentMode) => void) | null = null;

export function registerAgentModePersister(
  fn: (mode: OsAgentMode) => void,
): () => void {
  persistPreference = fn;
  return () => {
    if (persistPreference === fn) persistPreference = null;
  };
}

/**
 * The server told us what this member chose. Adopt it.
 *
 * **`null` means never chosen, and must not be treated as a choice.** Writing
 * the default on first read would freeze every member at whatever the default
 * was the day they first opened the desktop, so the workspace default could
 * never move for anyone again.
 *
 * The local cache is updated too, so the next cold start on this device paints
 * the right mode before the request comes back rather than flashing the
 * default and correcting itself.
 */
export function applyStoredAgentMode(preference: OsAgentMode | null): void {
  if (!preference) return;
  const scope = current.scope;
  if (!scope) return;
  if (current.preference === preference) return;
  save(scope, preference);
  commit({ ...current, preference });
}

/**
 * Read the effective mode outside React.
 *
 * For the chat transport, which builds a request body in a callback rather than
 * during render.
 */
export function currentEffectiveAgentMode(): OsAgentMode {
  return clampMode(current.preference, current.ceiling);
}

export interface UseAgentModeResult {
  /** What the agent may actually do: the preference, clamped. */
  mode: OsAgentMode;
  /** What this user picked, even if the org currently forbids it. */
  preference: OsAgentMode;
  /** The organization's maximum. */
  ceiling: OsAgentMode;
  setPreference: (mode: OsAgentMode) => void;
  /** True when the user's choice is currently being held down by the ceiling. */
  isClamped: boolean;
  /** Whether a given mode can be selected at all right now. */
  isAvailable: (mode: OsAgentMode) => boolean;
}

export function useAgentMode(): UseAgentModeResult {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { userId } = useAuth();
  const { organization } = useOrganization();

  // Personal workspace has no org, so fall back to the user — the `orgId ||
  // clerkUserId` convention used across the app's server actions.
  const scope = organization?.id ?? userId ?? null;

  useEffect(() => {
    if (scope) hydrate(scope);
  }, [scope]);

  const setPreference = useCallback((mode: OsAgentMode) => {
    const scopeNow = current.scope;
    if (!scopeNow) return;
    // Local first, so the control responds to the click rather than to the
    // round-trip; then to the server, which is what makes the choice follow
    // the user to their next device (`BE-7`).
    save(scopeNow, mode);
    commit({ ...current, preference: mode });
    persistPreference?.(mode);
  }, []);

  // Before the scope resolves the snapshot is the shared empty one, so nothing
  // from a previous scope leaks into the menu bar during the gap.
  const resolved = state.scope && state.scope === scope;
  const preference = resolved ? state.preference : DEFAULT_AGENT_MODE;
  const ceiling = state.ceiling;

  const isAvailable = useCallback(
    (mode: OsAgentMode) => clampMode(mode, ceiling) === mode,
    [ceiling],
  );

  return {
    mode: clampMode(preference, ceiling),
    preference,
    ceiling,
    setPreference,
    isClamped: clampMode(preference, ceiling) !== preference,
    isAvailable,
  };
}
