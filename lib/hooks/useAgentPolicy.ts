"use client";

/**
 * The workspace's agent-control ceiling, brought to the client.
 *
 * The server is the authority in the real product: it re-reads the ceiling on
 * every request and fails closed. Nothing here can raise what the agent is
 * allowed to do — this only stops the interface lying about it, so the selector
 * can explain a downgrade instead of silently applying one.
 *
 * The policy is a fixture for now, but the wiring is real: the ceiling is
 * pushed into the mode store and a persister is registered, so the clamp stays
 * exercised rather than bypassed. When the endpoint lands, only `queryFn`
 * changes.
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

const FIXTURE_POLICY: AgentPolicy = { preference: null, ceiling: "auto" };

export function useAgentPolicy() {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  const query = useQuery<AgentPolicy>({
    queryKey: agentPolicyKeys.policy(orgId),
    queryFn: async () => FIXTURE_POLICY,
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
