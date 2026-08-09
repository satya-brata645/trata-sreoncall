"use client";

/**
 * The signed-in user, without an identity provider.
 *
 * MCS scopes every per-user store (pinned apps, agent mode, notes) by
 * `orgId || userId`, so those keys survive a workspace switch without leaking
 * across one. Trata keeps that contract and serves it from a fixture: when a
 * real provider lands, only this module changes and the key shape stays put —
 * which matters, because a changed key silently orphans everything a user had
 * pinned.
 */

import { MOCK_ORG, MOCK_USER, type MockOrganization, type MockUser } from "./scope";

export { MOCK_ORG, MOCK_USER, scopeKey } from "./scope";
export type { MockOrganization, MockUser } from "./scope";

export function useAuth(): { userId: string | null; orgId: string | null; isLoaded: boolean } {
  return { userId: MOCK_USER.userId, orgId: MOCK_ORG.id, isLoaded: true };
}

export function useUser(): { user: MockUser; isLoaded: boolean } {
  return { user: MOCK_USER, isLoaded: true };
}

export function useOrganization(): { organization: MockOrganization; isLoaded: boolean } {
  return { organization: MOCK_ORG, isLoaded: true };
}
