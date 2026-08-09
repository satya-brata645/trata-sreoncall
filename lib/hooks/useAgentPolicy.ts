"use client";

/**
 * The workspace's agent-control ceiling, brought to the client.
 *
 * The server is the authority in the real product: it re-reads the ceiling on
 * every request and fails closed. Nothing here can raise what the agent is
 * allowed to do — this only stops the interface lying about it, so the selector
 * can explain a downgrade instead of silently applying one.
 *
 * The ceiling now comes from `/api/agent/policy`, which reads the same env value
 * `/api/agent` re-reads on every turn — so the selector and the enforcement
 * cannot drift. A request that fails falls back to the safest mode rather than
 * the most permissive one: an unreachable policy must never widen the agent.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useOrganization } from "@/lib/auth/mockUser";
import {
  applyStoredAgentMode,
  registerAgentModePersister,
  setAgentModeCeiling,
} from "@/lib/os/agentMode";
import type { OsAgentMode } from "@/lib/os/agentProtocol";

export interface AgentPolicy {
  /** What this user last chose. Null means never chosen. */
  preference: OsAgentMode | null;
  /** The highest mode the workspace permits. */
  ceiling: OsAgentMode;
}

export const agentPolicyKeys = {
  policy: (orgId?: string) => ["agent-control", orgId ?? "personal", "policy"] as const,
};

const SAFEST_POLICY: AgentPolicy = { preference: null, ceiling: "collab" };

function isMode(value: unknown): value is OsAgentMode {
  return value === "self" || value === "collab";
}

export function useAgentPolicy() {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  const query = useQuery<AgentPolicy>({
    queryKey: agentPolicyKeys.policy(orgId),
    queryFn: async () => {
      try {
        const response = await fetch("/api/agent/policy");
        if (!response.ok) return SAFEST_POLICY;
        const body = (await response.json()) as Partial<AgentPolicy>;
        return {
          preference: isMode(body.preference) ? body.preference : null,
          ceiling: isMode(body.ceiling) ? body.ceiling : SAFEST_POLICY.ceiling,
        };
      } catch {
        return SAFEST_POLICY;
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  /**
   * Write a chosen mode through. Fire-and-forget on purpose: the local store
   * has already moved, so the control has responded to the click, and the value
   * that actually governs anything is re-read server-side per request.
   */
  useEffect(
    () =>
      registerAgentModePersister(() => {
        /* no server to persist to yet */
      }),
    [],
  );

  const preference = query.data?.preference ?? null;
  useEffect(() => {
    applyStoredAgentMode(preference);
  }, [preference]);

  const ceiling = query.data?.ceiling;
  useEffect(() => {
    // Deliberately does nothing until the policy answers: assuming a ceiling
    // before it is known means either falsely locking a control or falsely
    // unlocking one, and both are worse than a moment of nothing.
    if (ceiling) setAgentModeCeiling(ceiling);
  }, [ceiling]);

  return query;
}
