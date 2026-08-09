import { NextResponse } from "next/server";

import {
  DEFAULT_AGENT_MODE,
  OS_AGENT_MODES,
  type OsAgentMode,
} from "@/lib/os/agentProtocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the workspace permits, and what this user last chose.
 *
 * The ceiling is the same value `/api/agent` re-reads per request — this
 * endpoint exists so the mode selector can *explain* a downgrade instead of
 * silently applying one. Nothing the client does with this answer can raise
 * what the agent is allowed to do.
 *
 * `preference` is null because there is no per-user store yet; the browser's
 * own localStorage remains the source of the user's choice until one lands.
 * The seam is `useAgentPolicy`'s `queryFn` and it now points here.
 */
function agentModeCeiling(): OsAgentMode {
  const raw = process.env.DOS_AGENT_MODE_CEILING;
  return OS_AGENT_MODES.includes(raw as OsAgentMode) ? (raw as OsAgentMode) : DEFAULT_AGENT_MODE;
}

export async function GET() {
  return NextResponse.json({ preference: null, ceiling: agentModeCeiling() });
}
