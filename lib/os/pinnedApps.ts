"use client";

/**
 * Apps the user has kept in the dock.
 *
 * The dock has three groups, mirroring macOS: the OS's own apps, then apps the
 * user pinned, then apps that are merely open. Only the middle group is user
 * state, and it has to survive a reload — a pin that vanished on refresh would
 * be worse than no pin at all.
 *
 * Stored client-side. There is no backend for dock layout, and inventing one
 * for a list of ids would be a lot of machinery for a preference that is
 * per-person and cheap to lose. Kept in an external store consumed via
 * `useSyncExternalStore`, the same shape as `notification-read-store`, so the
 * dock and any future surface (a Launchpad pin affordance) read one copy
 * instead of drifting.
 */

import { useCallback, useEffect } from "react";
import { useSyncExternalStore } from "react";
import { useAuth, useOrganization } from "@/lib/auth/mockUser";

/** A security app kept in the dock. */
export interface PinnedApp {
  /** Project id — the same value the window carries as its `appId` param. */
  id: string;
  /** Display name, for the tooltip and for resolving the app's symbol. */
  name: string;
}

interface PinnedState {
  /**
   * Who this list belongs to, or null before Clerk resolves. Scoping by
   * organization matters: app ids differ per org, so a shared key would surface
   * another org's apps in the dock after a switch.
   */
  scope: string | null;
  apps: PinnedApp[];
}

const STORAGE_PREFIX = "sos:dock:pinned";

/** Stable empty snapshot, also the SSR snapshot, so hydration cannot mismatch. */
const EMPTY: PinnedState = { scope: null, apps: [] };

let current: PinnedState = EMPTY;
const listeners = new Set<() => void>();

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}:${scope}`;
}

/** localStorage throws in private mode and when storage is full; a dock
 *  preference is never worth taking the app down for. */
function load(scope: string): PinnedApp[] {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Written by an older/other version, or hand-edited — keep only entries
    // that still have the two fields the dock needs to render a tile.
    return parsed.filter(
      (a): a is PinnedApp =>
        !!a &&
        typeof a === "object" &&
        typeof (a as PinnedApp).id === "string" &&
        typeof (a as PinnedApp).name === "string",
    );
  } catch {
    return [];
  }
}

function save(scope: string, apps: PinnedApp[]): void {
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(apps));
  } catch {
    // Ignored deliberately — see load().
  }
}

function commit(next: PinnedState): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): PinnedState {
  return current;
}

function getServerSnapshot(): PinnedState {
  return EMPTY;
}

/**
 * Load the stored list for a resolved scope. Idempotent — a no-op unless the
 * scope actually changed — so it is safe to call from every consumer's effect.
 */
function hydrate(scope: string): void {
  if (current.scope === scope) return;
  commit({ scope, apps: load(scope) });
}

function setApps(next: PinnedApp[]): void {
  const scope = current.scope;
  if (!scope) return;
  save(scope, next);
  commit({ scope, apps: next });
}

/** What the dock needs from this module. */
export interface UsePinnedAppsResult {
  pinned: PinnedApp[];
  isPinned: (id: string) => boolean;
  /** Pin if absent, unpin if present. New pins land at the end, so the dock
   *  order is the order the user pinned things — stable and predictable. */
  togglePin: (app: PinnedApp) => void;
}

export function usePinnedApps(): UsePinnedAppsResult {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { userId } = useAuth();
  const { organization } = useOrganization();

  // Personal workspace has no org, so fall back to the user — matching the
  // `orgId || clerkUserId` convention used across the app's server actions.
  const scope = organization?.id ?? userId ?? null;

  useEffect(() => {
    if (scope) hydrate(scope);
  }, [scope]);

  const isPinned = useCallback(
    (id: string) => state.apps.some((a) => a.id === id),
    [state.apps],
  );

  const togglePin = useCallback(
    (app: PinnedApp) => {
      const exists = current.apps.some((a) => a.id === app.id);
      setApps(
        exists
          ? current.apps.filter((a) => a.id !== app.id)
          : [...current.apps, app],
      );
    },
    [],
  );

  // Only expose the list once it belongs to the resolved scope. Before that the
  // snapshot is the shared empty one, so nothing from a previous scope leaks
  // into the dock during the gap while Clerk loads.
  const pinned = state.scope && state.scope === scope ? state.apps : [];

  return { pinned, isPinned, togglePin };
}
