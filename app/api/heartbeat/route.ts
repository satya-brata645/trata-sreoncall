import { NextResponse } from "next/server";

import { lastBeat, runHeartbeat } from "@/lib/agent/heartbeat-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Beat now.
 *
 * The same handler the in-process interval calls, exposed so a real scheduler
 * can drive it in a deployment and so a demo can force one without waiting.
 * Shares the beat lock, so calling this mid-interval is safe rather than
 * racy — it queues behind whatever is running.
 */
function authorized(request: Request): boolean {
  const expected = process.env.SRE_INGEST_SECRET;
  if (!expected) return true;
  return request.headers.get("x-internal-secret") === expected;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runHeartbeat());
}

/** What the last beat decided, and why. */
export async function GET() {
  return NextResponse.json({ lastBeat: lastBeat() });
}
