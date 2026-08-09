"use client";

import { useCallback } from "react";
import { useOrganization } from "@/lib/auth/mockUser";
import { fetchBackend } from "@/lib/api/client";

/**
 * Authenticated access to the backend seam.
 *
 * Keeps the `{ token, orgSlug }` shape every resource module expects, so when a
 * real identity provider lands only this hook's body changes. The token is a
 * placeholder today — `fetchBackend` ignores it while running on fixtures.
 */
export function useAuthFetch() {
  const { organization } = useOrganization();
  const orgSlug = organization?.slug ?? undefined;

  const authFetch = useCallback(
    async <T = unknown>(path: string, options?: { method?: string; body?: unknown }) =>
      fetchBackend<T>(path, { token: "fixture", orgSlug, ...options }),
    [orgSlug],
  );

  const getAuthParams = useCallback(
    async () => ({ token: "fixture", orgSlug }),
    [orgSlug],
  );

  return { authFetch, getAuthParams, orgSlug };
}
