/**
 * Who the stores are keyed by, on both sides of the wire.
 *
 * Split out of `mockUser.ts` because that module is `"use client"` and the
 * conversation store, the heartbeat and the ingest route all need the same
 * scope key from the server. The values live here, once; `mockUser` re-exports
 * them so the React-facing surface is unchanged.
 *
 * The key shape is `orgId || userId`, which is MCS's — a changed key silently
 * orphans everything a user had pinned, so it is worth keeping even while both
 * halves are fixtures.
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

/** The scope key every per-user store is namespaced by. */
export function scopeKey(): string {
  return MOCK_ORG.id || MOCK_USER.userId;
}
