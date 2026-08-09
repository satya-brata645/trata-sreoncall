import { promises as fs } from "node:fs";
import path from "node:path";

import { scopeKey } from "@/lib/auth/scope";
import { THREADS, type MockMessage } from "@/lib/mock/fixtures";

/**
 * Where a conversation lives, and why it is a log rather than a document.
 *
 * Two things write to the home conversation and they do not know about each
 * other: the browser, when you say something, and the heartbeat, when the app
 * decides to speak first. MCS hit this and solved it with a spool directory,
 * monotonic ULIDs and a compaction pass — an apparatus that exists entirely
 * because S3 has no compare-and-swap, so a read-modify-write of one
 * `messages.json` silently drops whichever writer lost.
 *
 * A local file gives us the primitive S3 withheld: `O_APPEND` on a small write
 * is atomic, so both writers can simply append and neither can clobber the
 * other. One NDJSON line per message, read back in whole, deduped by id. No
 * spool, no compaction, no ULID clock.
 *
 * Deduping by id is what makes every writer idempotent, which is the property
 * the heartbeat leans on: replaying a beat re-appends a line that already
 * exists, and the reader collapses it. Ordering is by `at`, with id as the
 * tiebreak so two messages minted in the same millisecond do not swap places
 * between reads.
 */

export interface StoredMessage extends MockMessage {
  /** The SRE event this message was written in response to, when one was. */
  eventRef?: string;
}

export interface StoredConversation {
  id: string;
  title: string;
  isHome?: boolean;
  updatedAt: string;
  /** Unread agent messages, carried even when the body is withheld. */
  unread: number;
  messages: StoredMessage[];
}

/** The home conversation — the one the app writes into unprompted. */
export const HOME_CONVERSATION_ID = "home";

function root(): string {
  return path.join(process.cwd(), ".data", scopeKey(), "conversations");
}

function logPath(conversationId: string): string {
  // Conversation ids come from the URL and from tool input, so they are not
  // trusted to be path-shaped. Anything but the safe alphabet is collapsed,
  // which turns a traversal attempt into a harmless sibling file.
  const safe = conversationId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "unnamed";
  return path.join(root(), `${safe}.ndjson`);
}

/**
 * Append one message. Never throws — a conversation that cannot be written is
 * worth degrading over, not worth failing a turn over.
 */
export async function appendMessage(
  conversationId: string,
  message: StoredMessage,
): Promise<void> {
  try {
    await fs.mkdir(root(), { recursive: true });
    await fs.appendFile(logPath(conversationId), `${JSON.stringify(message)}\n`, "utf8");
  } catch (error) {
    console.warn("[conversations] append failed", conversationId, error);
  }
}

export async function appendMessages(
  conversationId: string,
  messages: readonly StoredMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  try {
    await fs.mkdir(root(), { recursive: true });
    const body = messages.map((message) => `${JSON.stringify(message)}\n`).join("");
    await fs.appendFile(logPath(conversationId), body, "utf8");
  } catch (error) {
    console.warn("[conversations] append failed", conversationId, error);
  }
}

/**
 * Put the fixture threads on disk the first time anyone looks.
 *
 * The seed exists so an empty `.data` does not mean an empty product — the
 * fixture threads are the demo's backstory and were previously the only content
 * chat ever had. Once written they are ordinary messages: editable, appendable,
 * and no longer re-derived on every mount the way `useState(THREADS)` was.
 *
 * Guarded by its own marker file, so deleting `.data` is a complete reset and
 * nothing remembers that it used to be seeded.
 *
 * The guard was "does any conversation exist", which was wrong in a way only
 * ordering revealed: the heartbeat can speak before anyone opens the app, and
 * the `home.ndjson` it writes then looked exactly like an already-seeded store.
 * The fixtures never landed and the rail came up almost empty. A marker answers
 * the question actually being asked — *has the seed run* — rather than a proxy
 * for it that something else can satisfy by accident.
 */
let seeding: Promise<void> | null = null;

function seedMarker(): string {
  return path.join(root(), ".seeded");
}

export function ensureSeeded(): Promise<void> {
  seeding ??= (async () => {
    try {
      await fs.mkdir(root(), { recursive: true });
      try {
        await fs.access(seedMarker());
        return;
      } catch {
        // Not seeded yet.
      }
      for (const thread of THREADS) {
        await appendMessages(thread.id, thread.messages as StoredMessage[]);
      }
      // Written last: a crash mid-seed leaves no marker, so the next start
      // seeds again, and the append is idempotent by message id anyway.
      await fs.writeFile(seedMarker(), new Date().toISOString(), "utf8");
    } catch (error) {
      console.warn("[conversations] seed failed", error);
    }
  })();
  return seeding;
}

/**
 * Read a conversation back.
 *
 * A malformed line is skipped rather than fatal: a half-written line from a
 * process killed mid-append should cost one message, not the whole history.
 */
export async function readMessages(conversationId: string): Promise<StoredMessage[]> {
  let raw: string;
  try {
    raw = await fs.readFile(logPath(conversationId), "utf8");
  } catch {
    return [];
  }

  const byId = new Map<string, StoredMessage>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      // First occurrence wins, as in the event log: a replayed beat is the same
      // message arriving again, not a revision of it.
      //
      // `read` is the single exception, and it is one-way. It is the only
      // mutable thing about a message, and marking it is appended rather than
      // rewritten so the log stays append-only — a later line can set it true,
      // never back to false.
      const parsed = JSON.parse(line) as StoredMessage;
      if (!parsed || typeof parsed.id !== "string") continue;
      const seen = byId.get(parsed.id);
      if (!seen) byId.set(parsed.id, parsed);
      else if (parsed.read && !seen.read) byId.set(parsed.id, { ...seen, read: true });
    } catch {
      // A torn line. Skip it.
    }
  }

  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/**
 * Mark a thread's agent messages as read.
 *
 * Read state is the one thing here that is genuinely mutable, and the log is
 * append-only — so it is appended too, as a tombstone the reader folds in. That
 * keeps the single writing rule intact: nothing ever rewrites a line, and two
 * writers still cannot lose each other's work.
 */
export async function markThreadRead(conversationId: string): Promise<void> {
  const messages = await readMessages(conversationId);
  const unread = messages.filter((message) => message.role === "agent" && !message.read);
  if (unread.length === 0) return;
  await appendMessages(
    conversationId,
    unread.map((message) => ({ ...message, read: true })),
  );
}

/**
 * Which conversations exist, newest activity first.
 *
 * `bodiesFor` decides which of them ship their messages. The poll runs every
 * 15s forever, and only one conversation is written to by anything other than
 * this browser tab — sending every message of every thread each time made the
 * payload grow without bound to keep one of them fresh.
 */
export async function listConversations(
  bodiesFor: (id: string) => boolean = () => true,
): Promise<StoredConversation[]> {
  let names: string[];
  try {
    names = await fs.readdir(root());
  } catch {
    return [];
  }

  const conversations = await Promise.all(
    names
      .filter((name) => name.endsWith(".ndjson"))
      .map(async (name) => {
        const id = name.replace(/\.ndjson$/, "");
        const messages = await readMessages(id);
        return {
          id,
          title: titleFor(id, messages),
          isHome: id === HOME_CONVERSATION_ID,
          updatedAt: messages.at(-1)?.at ?? new Date(0).toISOString(),
          // A summary still carries the unread count, because that is what the
          // rail and the activity badge are actually asking for — the messages
          // themselves are only needed once a thread is opened.
          unread: messages.filter((m) => m.role === "agent" && !m.read).length,
          messages: bodiesFor(id) ? messages : [],
        };
      }),
  );

  return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * A thread's name, derived rather than stored.
 *
 * Storing it would mean a second writer on a file whose whole design is
 * append-only. The first thing said in a thread is what it is about, which is
 * the same rule a person would use.
 */
function titleFor(id: string, messages: readonly StoredMessage[]): string {
  if (id === HOME_CONVERSATION_ID) return "Home";
  const first = messages.find((message) => message.role === "user");
  if (!first) return "New thread";
  const text = first.text.trim();
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}
