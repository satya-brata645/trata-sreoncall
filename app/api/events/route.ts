import { NextResponse } from "next/server";

import { parseEvent } from "@/lib/agent/events";
import { appendEvent, readEvents } from "@/lib/store/events";
import { wakeEarly } from "@/lib/agent/heartbeat-runner";
import { score } from "@/lib/agent/salience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the SRE agent posts what it found.
 *
 * Authorized by a shared secret rather than a session, because the caller is a
 * process, not a person. When `SRE_INGEST_SECRET` is unset the route is open —
 * which is right for a laptop and wrong everywhere else, so it says so out
 * loud in the response rather than failing quietly open.
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = parseEvent(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  await appendEvent(parsed);
  const salience = score(parsed);

  // A SEV-1 that waits fifteen minutes for the next tick is a capability nobody
  // can demonstrate and nobody would trust. Anything clearing the bar wakes the
  // loop now; the runner debounces so a burst is still one beat.
  if (salience.matters) wakeEarly();

  return NextResponse.json({
    ok: true,
    id: parsed.id,
    salience,
    unsecured: !process.env.SRE_INGEST_SECRET,
  });
}

/** What has been reported, for the apps and for checking the pipe works. */
export async function GET() {
  const events = await readEvents();
  return NextResponse.json({ events: events.slice(-100).reverse() });
}
