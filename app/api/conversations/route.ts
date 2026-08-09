import { NextResponse } from "next/server";

import {
  ensureSeeded,
  HOME_CONVERSATION_ID,
  listConversations,
} from "@/lib/store/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The conversation list.
 *
 * `?with=<id>` asks for one thread's messages as well. The home thread is
 * always included because it is the one something other than this browser
 * writes to — everything else ships as a summary until it is opened.
 */
export async function GET(request: Request) {
  await ensureSeeded();
  const params = new URL(request.url).searchParams;
  const wanted = params.get("with");
  // The activity panel reads across every thread, so it is the one caller that
  // genuinely needs all of them. Asking for that explicitly keeps it out of the
  // 15s poll that runs whether or not anyone is looking at it.
  const all = params.get("all") === "1";
  const conversations = await listConversations(
    (id) => all || id === HOME_CONVERSATION_ID || id === wanted,
  );
  return NextResponse.json({ conversations });
}
