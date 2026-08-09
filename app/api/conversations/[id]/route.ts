import { NextResponse } from "next/server";

import {
  appendMessages,
  ensureSeeded,
  markThreadRead,
  readMessages,
  type StoredMessage,
} from "@/lib/store/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One conversation.
 *
 * `GET` is what the chat polls: it is the only way a message written by
 * something other than this browser tab — the heartbeat — becomes visible.
 * `POST` appends; it is deliberately a batch, because a turn produces a user
 * line, several trace rows and a reply, and sending them as one write keeps the
 * ordering the browser already decided.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await ensureSeeded();
  const messages = await readMessages(id);
  return NextResponse.json({ id, messages });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as { messages?: unknown; markRead?: unknown };

  // Opening a thread is not a message, but it is a write — the badge has to be
  // clearable or it only ever counts up.
  if (body.markRead === true) {
    await markThreadRead(id);
    return NextResponse.json({ ok: true, written: 0 });
  }

  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: "messages must be an array" }, { status: 400 });
  }

  const messages = (body.messages as StoredMessage[]).filter(
    (message) =>
      message &&
      typeof message.id === "string" &&
      typeof message.at === "string" &&
      typeof message.text === "string",
  );
  await appendMessages(id, messages);
  return NextResponse.json({ ok: true, written: messages.length });
}
