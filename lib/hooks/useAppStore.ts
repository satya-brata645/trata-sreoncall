"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchBackend } from "@/lib/api/client";
import { useOrganization } from "@/lib/auth/mockUser";
import { useAuthFetch } from "./useAuthFetch";
import type { Project } from "@/lib/api/types";

export interface AppStoreCatalog {
  branch: string;
  /** Every app in the library; `enabled` tells owned from available. */
  apps: Project[];
}

export const appStoreKeys = {
  all: (orgId?: string) => ["app-store", orgId ?? "personal"] as const,
  catalog: (orgId?: string) => [...appStoreKeys.all(orgId), "catalog"] as const,
} as const;

/**
 * The whole library, annotated with what the workspace already has.
 *
 * Deliberately a different query to `useProjects`: that one is the *owned*
 * list read by the Launchpad and the dock. Two queries over the same library is
 * the honest shape — they answer different questions, and the store must not
 * widen what the rest of the app thinks the user can open.
 */
export function useAppStoreCatalog(options?: { enabled?: boolean }) {
  const { organization } = useOrganization();
  const { getAuthParams } = useAuthFetch();

  return useQuery({
    queryKey: appStoreKeys.catalog(organization?.id),
    queryFn: async () =>
      fetchBackend<AppStoreCatalog>("/app-store/catalog", await getAuthParams()),
    enabled: options?.enabled ?? true,
    // The library moves when someone publishes, not while the window is open.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
