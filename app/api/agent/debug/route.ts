import { NextResponse } from "next/server";

import { agentDebugEnabled, readAgentCalls } from "@/lib/agent/debug-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The last few model calls, newest first.
 *
 * Off unless `DOS_AGENT_DEBUG=1`, and 404 rather than 403 when off so the route
 * does not advertise itself. It returns prompts-adjacent metadata, never the
 * conversation, so leaving it on in a dev environment leaks nothing about the
 * user — but it has no business existing in a deployed one.
 */
export async function GET() {
  if (!agentDebugEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ calls: readAgentCalls() });
}
