import { NextResponse } from "next/server";

import { memoryView } from "@/lib/agent/memory";
import { readEvents } from "@/lib/store/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Derived memory has its own route: raw events and ranked memory have distinct consumers. */
export async function GET() {
  const memory = await memoryView(new Date(), await readEvents());
  return NextResponse.json({ memory, hasLiveData: memory.working.length + memory.episodes.length + memory.longTerm.length > 0 });
}
