"use client";

import { useOrganization } from "@/lib/auth/mockUser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getBuilds,
  promoteBuild,
  setCurrentBuild,
  type Build,
  type BuildsResponse,
  type PromoteBuildBody,
} from "@/lib/api/builds";
import { useAuthFetch } from "@/lib/hooks/useAuthFetch";

export const buildKeys = {
  all: (orgId?: string) => ["builds", orgId ?? "personal"] as const,
  forApp: (appId: string, orgId?: string) =>
    [...buildKeys.all(orgId), appId] as const,
} as const;

/** Every build for one app, newest first, plus latest and current. */
export function useBuilds(appId: string | null) {
  const { organization, isLoaded: isOrgLoaded } = useOrganization();
  const orgId = organization?.id;
  const { getAuthParams } = useAuthFetch();

  return useQuery({
    queryKey: buildKeys.forApp(appId ?? "", orgId),
    queryFn: async () => getBuilds(await getAuthParams(), appId as string),
    enabled: !!appId && isOrgLoaded,
    // Override the provider's 5-minute default. Builds are *mutable* — a
    // promotion from a build chat, or a colleague's rollback, changes what this
    // window should be showing. With the inherited staleTime, a promotion made
    // outside this component served a stale list for five minutes with no
    // network call at all, including across remounts. (`useTrunk` can use
    // `staleTime: Infinity` precisely because a trunk id never changes.)
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/**
 * Promote the current state to a new build.
 *
 * Builds belong to the workspace, so this changes what colleagues open — worth
 * a confirm at the call site.
 */
export function usePromoteBuild(appId: string | null) {
  const { organization } = useOrganization();
  const orgId = organization?.id;
  const { getAuthParams } = useAuthFetch();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: PromoteBuildBody = {}) =>
      promoteBuild(await getAuthParams(), appId as string, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: buildKeys.forApp(appId ?? "", orgId),
      });
    },
  });
}

/**
 * Make an existing build current — "Rollback".
 *
 * Optimistic, because the answer is known: only the pointer moves. The build
 * list itself is untouched, which is the immutability rule the backend enforces.
 */
export function useSetCurrentBuild(appId: string | null) {
  const { organization } = useOrganization();
  const orgId = organization?.id;
  const { getAuthParams } = useAuthFetch();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (number: number) =>
      setCurrentBuild(await getAuthParams(), appId as string, number),
    onMutate: async (number: number) => {
      const key = buildKeys.forApp(appId ?? "", orgId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<BuildsResponse>(key);
      if (previous) {
        queryClient.setQueryData<BuildsResponse>(key, {
          ...previous,
          current_build: number,
        });
      }
      return { previous, key };
    },
    onError: (_err, _number, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: buildKeys.forApp(appId ?? "", orgId),
      });
    },
  });
}

/**
 * Which build was current when a wake-up ran.
 *
 * Derived from `promoted_at` rather than stored on the session, so session
 * creation needs no change. A wake-up predating every build belongs to none —
 * the app was running its default state, not build 1.
 */
export function buildForSession(
  builds: Build[],
  sessionCreatedAt: string | null | undefined,
): number | null {
  if (!sessionCreatedAt) return null;
  const ordered = [...builds]
    .filter((b) => b.promoted_at)
    .sort((a, b) => a.promoted_at.localeCompare(b.promoted_at));

  let owner: number | null = null;
  for (const build of ordered) {
    if (build.promoted_at <= sessionCreatedAt) owner = build.number;
    else break;
  }
  return owner;
}
