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

export interface MockUser {
  userId: string;
  fullName: string;
  email: string;
  initials: string;
}

export interface MockOrganization {
  id: string;
  slug: string;
  name: string;
}

export const MOCK_USER: MockUser = {
  userId: "user_trata_demo",
  fullName: "Alex Mercer",
  email: "alex@trata.dev",
  initials: "AM",
};

export const MOCK_ORG: MockOrganization = {
  id: "org_trata",
  slug: "trata",
  name: "Trata",
};

export function useAuth(): { userId: string | null; orgId: string | null; isLoaded: boolean } {
  return { userId: MOCK_USER.userId, orgId: MOCK_ORG.id, isLoaded: true };
}

export function useUser(): { user: MockUser; isLoaded: boolean } {
  return { user: MOCK_USER, isLoaded: true };
}

export function useOrganization(): { organization: MockOrganization; isLoaded: boolean } {
  return { organization: MOCK_ORG, isLoaded: true };
}

/** The scope key every per-user store is namespaced by. */
export function scopeKey(): string {
  return MOCK_ORG.id || MOCK_USER.userId;
}
