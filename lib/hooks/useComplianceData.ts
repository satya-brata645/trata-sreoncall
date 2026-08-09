"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchBackend } from "@/lib/api/client";
import { useOrganization } from "@/lib/auth/mockUser";
import { useAuthFetch } from "./useAuthFetch";
import type { Project, ProjectFile, SessionWithSummary } from "@/lib/api/types";

export interface SessionFilter {
  scope?: "user" | "org";
  userEmail?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Org-aware query keys. Every per-workspace list is namespaced by org id so a
 * workspace switch cannot serve the previous one's data from cache.
 */
export const queryKeys = {
  all: (orgId?: string) => ["compliance", orgId ?? "personal"] as const,
  projects: (orgId?: string) => [...queryKeys.all(orgId), "projects"] as const,
  projectsByBranch: (branch: string, orgId?: string) =>
    [...queryKeys.projects(orgId), branch] as const,
  sessionFiles: (orgId?: string) => [...queryKeys.all(orgId), "sessionFiles"] as const,
  sessionFilesBySessionId: (sessionId: string, orgId?: string) =>
    [...queryKeys.sessionFiles(orgId), sessionId] as const,
  sessionSummariesInfinite: (orgId?: string, filter?: SessionFilter) =>
    [
      ...queryKeys.all(orgId),
      "sessionSummariesInfinite",
      filter?.scope ?? "user",
      filter?.userEmail ?? "",
      filter?.startDate ?? "",
      filter?.endDate ?? "",
    ] as const,
} as const;

/** The apps this workspace owns — what the Launchpad and the dock read. */
export function useProjects(all?: boolean, options?: { enabled?: boolean }) {
  const { organization } = useOrganization();
  const orgId = organization?.id;
  const { getAuthParams } = useAuthFetch();

  return useQuery({
    queryKey: [...queryKeys.projects(orgId), all ? "all" : "owned"],
    queryFn: async () =>
      fetchBackend<{ projects: Project[]; success: boolean }>(
        `/projects${all ? "?all=true" : ""}`,
        await getAuthParams(),
      ),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
}

/** The files one wake-up produced. */
export function useSessionFiles(sessionId: string | null) {
  const { organization } = useOrganization();
  const orgId = organization?.id;
  const { getAuthParams } = useAuthFetch();

  return useQuery({
    queryKey: queryKeys.sessionFilesBySessionId(sessionId ?? "", orgId),
    queryFn: async () => {
      if (!sessionId) return { files: [] as ProjectFile[], success: false };
      return fetchBackend<{ files: ProjectFile[]; success: boolean }>(
        `/project/files/${encodeURIComponent(sessionId)}`,
        await getAuthParams(),
      );
    },
    enabled: !!sessionId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Every wake-up in the window, paged.
 *
 * The fixture backend returns the whole workspace in one page, so `hasMore` is
 * false immediately and the callers' "keep paging until my app appears" effects
 * terminate on the first response. The paging surface is kept because those
 * callers are ported verbatim and the real endpoint does page.
 */
export function useInfiniteSessionSummariesWithRunning(
  sessionFilter?: SessionFilter,
  options?: { enabled?: boolean },
) {
  const { organization } = useOrganization();
  const orgId = organization?.id;
  const { getAuthParams } = useAuthFetch();
  const [pages, setPages] = useState(1);

  const result = useQuery({
    queryKey: [...queryKeys.sessionSummariesInfinite(orgId, sessionFilter), pages],
    queryFn: async () =>
      fetchBackend<{ sessions: SessionWithSummary[]; total: number; success: boolean }>(
        "/project/sessions",
        await getAuthParams(),
      ),
    enabled: options?.enabled ?? true,
    staleTime: 60 * 1000,
  });

  const sessions = useMemo(() => result.data?.sessions ?? [], [result.data]);
  const total = result.data?.total ?? 0;
  const hasMore = sessions.length < total;
  const loadMore = useCallback(() => setPages((n) => n + 1), []);

  return {
    isLoading: result.isLoading,
    isPending: result.isPending,
    isFetching: result.isFetching,
    error: result.error,
    data: { sessions, total, success: result.data?.success ?? false, error: undefined },
    loadMore,
    hasMore,
    isLoadingMore: result.isFetching && !result.isLoading,
    hasFullDefaultWindow: !hasMore,
    runningSessions: [] as never[],
  };
}
