"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Mic, PanelLeft, Plus, Send } from "lucide-react";

import { cn, formatCompactRelativeTime, traceTime } from "@/lib/utils";
import { Icon, Row, SectionLabel, StatusDot } from "@/components/ui/primitives";
import { THREADS, type MockMessage, type MockThread } from "@/lib/mock/fixtures";
import { useDesktopController } from "@/lib/os/DesktopControllerContext";
import type { OsAppProps } from "@/lib/os/types";
import { subscribeAgentTurn } from "@/lib/os/agentTurn";
import { useStreamingVoice } from "@/lib/hooks/useStreamingVoice";
import { VoiceAgentBar } from "@/components/chat/VoiceAgentBar";
import { handleDesktopToolCall } from "@/lib/agent/desktop-tool-client";
import { handleDataToolCall } from "@/lib/agent/data-tool-client";
import type { LiveAgentMessage, LiveAgentResponse } from "@/lib/agent/live-protocol";
import { streamAgentTurn } from "@/lib/agent/stream-client";
import { restoreHistory } from "@/lib/agent/history";
import { describeDesktopPlan, type DesktopPlanCopy } from "@/lib/agent/desktop-plan-copy";
import { fenceWithNotice } from "@/lib/agent/untrusted-content";
import { DesktopApprovalCard } from "@/components/chat/DesktopApprovalCard";
import { speakBrowserText } from "@/lib/voice/browser-playback";
import { waitForFirstAudio } from "@/lib/voice/playback-control";
import { useAgentSummon } from "@/lib/os/AgentSummonContext";
import { currentEffectiveAgentMode } from "@/lib/os/agentMode";
import { batchNeedsApproval } from "@/lib/os/desktopActions";
import { resolveHandle, type DesktopStep, type OsAgentMode } from "@/lib/os/agentProtocol";
import type { DesktopControllerValue } from "@/lib/os/DesktopControllerContext";

/**
 * Chat — the mouth.
 *
 * A built-in app the way Terminal is built in: power users live here, most
 * people touch it rarely. It is not a chat so much as an agentic interface —
 * the agent answers *and* drives the desktop, and the trace rows below its
 * replies are that work being shown rather than described.
 *
 * The view is `params.panel`, never local state. An app that keeps its current
 * view in `useState` is a room with no door number: the agent can open it but
 * cannot say "the activity panel".
 */

type Panel = "home" | "threads" | "activity" | "conversation";

function panelOf(params?: Record<string, string>): Panel {
  const p = params?.panel;
  return p === "threads" || p === "activity" || p === "conversation" ? p : "home";
}

/** Unread agent messages carry the worst thing behind them as a left edge. */
function severityEdge(message: MockMessage): string | undefined {
  if (message.read || message.role !== "agent") return undefined;
  switch (message.severity) {
    case "critical":
    case "high":
      return "var(--color-role-status-critical-default)";
    case "medium":
      return "var(--color-role-status-medium-default)";
    default:
      return undefined;
  }
}

function MessageBubble({ message }: { message: MockMessage }) {
  if (message.role === "trace") {
    return (
      <div className="flex gap-2.5 pl-0.5">
        <div className="flex flex-none flex-col items-center pt-1">
          <span className="size-[5px] rounded-full bg-role-icon-muted" />
          <span className="min-h-2 w-px flex-1 bg-role-border-subtle" />
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="dos-label text-role-content-subtle">{message.kind}</span>
            <span className="text-label text-role-content-placeholder">
              {traceTime(message.at)}
            </span>
          </div>
          <p className="text-body-xs text-role-content-subtle">{message.text}</p>
        </div>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[min(78%,64ch)] rounded-[14px] rounded-br-[4px] bg-role-surface-action px-3.5 py-2.5 text-body-md font-medium text-role-foreground-on-inverse">
          {message.text}
        </p>
      </div>
    );
  }

  const edge = severityEdge(message);
  return (
    <div className="flex">
      <div
        style={edge ? { borderLeftColor: edge, borderLeftWidth: 2 } : undefined}
        className={cn(
          // A measure as well as a percentage: the window is resizable, and at
          // full width 82% is a 200-character line.
          "max-w-[min(82%,72ch)] rounded-[14px] rounded-bl-[4px] border border-role-border-subtle bg-role-surface-container px-3.5 py-2.5 text-body-md text-role-content-heading",
          edge && "rounded-bl-[4px] pl-3",
        )}
      >
        <p>{message.text}</p>

        {/* The receipt, on the message that made the claim. A proactive line is
            the app interrupting you on its own judgement, so what it was
            reacting to belongs with it rather than a question away. */}
        {message.source === "heartbeat" && message.eventRef ? (
          <p className="mt-1.5 font-mono text-label text-role-content-placeholder">
            {message.eventRef}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * How often the home conversation is re-read.
 *
 * The trunk is the one conversation something other than this browser tab
 * writes to — the heartbeat writes there when the app decides to speak first —
 * so it is the only one that needs polling. MCS chose 15s over a websocket and
 * that trade still holds: one small GET, no connection to keep alive, and
 * nothing to reconnect after a laptop lid closes.
 */
const CONVERSATION_POLL_MS = 15_000;

interface StoredConversationDto {
  id: string;
  title: string;
  isHome?: boolean;
  updatedAt: string;
  /** Carried even when `messages` is withheld, so the badge stays honest. */
  unread?: number;
  messages: MockMessage[];
}

/**
 * Fold what the server has into what this tab already shows.
 *
 * Local wins on any id they share, because a message that is still being
 * written here has not reached the store yet and must not be replaced by its
 * own older self. Everything else is a union — which is what makes the
 * heartbeat's message simply *appear* without any special case for it.
 */
function mergeThreads(
  local: readonly MockThread[],
  remote: readonly StoredConversationDto[],
): MockThread[] {
  const byId = new Map(local.map((thread) => [thread.id, thread]));

  for (const conversation of remote) {
    const existing = byId.get(conversation.id);
    const merged = new Map<string, MockMessage>();
    for (const message of conversation.messages) merged.set(message.id, message);
    for (const message of existing?.messages ?? []) merged.set(message.id, message);

    const messages = [...merged.values()].sort(
      (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
    );
    byId.set(conversation.id, {
      id: conversation.id,
      title: existing?.title ?? conversation.title,
      isHome: existing?.isHome ?? conversation.isHome,
      updatedAt: messages.at(-1)?.at ?? conversation.updatedAt,
      messages,
    });
  }

  // Home first, then most recently touched. Home is not the newest thread, it
  // is the standing one — sorting it by activity would make it wander.
  return [...byId.values()].sort((a, b) => {
    if (a.isHome !== b.isHome) return a.isHome ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

/** Tell the store a thread has been looked at. Fire-and-forget, like persist. */
function markRead(conversationId: string): void {
  void fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markRead: true }),
  }).catch(() => {});
}

/** Write through to the store. Fire-and-forget: the UI has already moved. */
function persist(conversationId: string, messages: readonly MockMessage[]): void {
  void fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  }).catch(() => {
    // A conversation that failed to persist is still on screen. Losing it on
    // reload is worth less than interrupting the turn to say so.
  });
}

/**
 * The verbs a raw plan proposes, for the permission test only.
 *
 * `batchNeedsApproval` reads nothing but `verb`. Validating the rest here would
 * duplicate the executor, which is the one place a malformed step must fail the
 * whole batch — so this deliberately looks at one field and no more.
 */
function proposedVerbs(input: unknown): DesktopStep[] {
  const payload = (input ?? {}) as { steps?: unknown };
  if (!Array.isArray(payload.steps)) return [];
  return (payload.steps as Array<{ verb?: unknown }>)
    .filter((step) => typeof step?.verb === "string")
    .map((step) => ({ verb: step.verb }) as DesktopStep);
}

/**
 * Name the windows a plan touches before showing it to anyone.
 *
 * `describeDesktopPlan` says "window 2" when a step carries only a handle,
 * which is the exact thing the approval card exists to avoid — a handle means
 * nothing outside the model's head. The snapshot is free and local, so resolve
 * to titles first and let the copy module do the phrasing.
 */
function describePlanForUser(
  input: unknown,
  controller: DesktopControllerValue | null,
): DesktopPlanCopy {
  const payload = (input ?? {}) as { steps?: unknown };
  if (!controller || !Array.isArray(payload.steps)) return describeDesktopPlan(input);

  const snapshot = controller.readDesktop();
  const steps = (payload.steps as Array<Record<string, unknown>>).map((step) => {
    if (typeof step?.title === "string" || typeof step?.handle !== "number") return step;
    const found = resolveHandle(snapshot, step.handle);
    return "kind" in found ? step : { ...step, title: found.title };
  });
  return describeDesktopPlan({ ...payload, steps });
}

/** The trunk plus its side threads, in a rail that collapses to nothing. */
function ThreadRail({
  threads,
  activeId,
  onSelect,
  onNew,
  open,
  onToggle,
}: {
  threads: MockThread[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{ width: open ? 190 : 46 }}
      className="flex flex-none flex-col overflow-hidden border-r border-role-border-subtle transition-[width] duration-200"
    >
      {open && (
        <>
          <button
            type="button"
            onClick={onNew}
            className="mx-2.5 mt-2.5 mb-1 flex items-center gap-2.5 rounded-xs px-2 py-1.5 text-body-sm font-medium text-role-content-body hover:bg-role-surface-component-hover"
          >
            <span className="flex size-[22px] items-center justify-center rounded-[7px] border border-dashed border-role-border-active text-role-icon">
              <Icon icon={Plus} size={12} />
            </span>
            New chat
          </button>
          <SectionLabel className="px-3.5 pt-2.5">Recents</SectionLabel>
          <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2.5 pb-2.5">
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => onSelect(thread.id)}
                className={cn(
                  "flex flex-col items-start rounded-xs px-2 py-1.5 text-left hover:bg-role-surface-component-hover",
                  thread.id === activeId && "bg-role-surface-component-selected",
                )}
              >
                <span className="w-full truncate text-body-sm text-role-content-heading">
                  {thread.title}
                </span>
                <span className="text-label text-role-content-placeholder">
                  {formatCompactRelativeTime(thread.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {!open && <div className="flex-1" />}
      <div className="flex-none border-t border-role-border-subtle p-2.5">
        <button
          type="button"
          onClick={onToggle}
          title="Toggle recents"
          aria-label="Toggle recents"
          className="flex size-7 items-center justify-center rounded-[8px] text-role-icon-muted hover:bg-role-surface-component-hover hover:text-role-content-heading"
        >
          <Icon icon={PanelLeft} />
        </button>
      </div>
    </div>
  );
}

const STARTERS = [
  "What did you do while I was away?",
  "Is anything internet-facing exposed right now?",
  "Show me the reachability report next to the CVE matrix.",
];

export function ChatApp({ params, setParams }: OsAppProps) {
  const panel = panelOf(params);
  const controller = useDesktopController();
  const summon = useAgentSummon();
  const [threads, setThreads] = useState<MockThread[]>(THREADS);
  const [railOpen, setRailOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const [voiceMode, setVoiceMode] = useState<"off" | "agent">("off");
  const [voiceInterim, setVoiceInterim] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const voiceModeRef = useRef(voiceMode);
  const submitVoiceTurnRef = useRef<((text: string, voice: boolean) => void) | null>(null);
  const historyRef = useRef(new Map<string, LiveAgentMessage[]>());
  /** Threads with a turn running, so hydration does not rebuild under one. */
  const inFlightRef = useRef(new Set<string>());
  /** The latest threads, reachable from the poll without re-subscribing it. */
  const threadsRef = useRef<MockThread[]>(THREADS);
  /** Which thread is open, and whether the activity panel needs every body. */
  const activeIdRef = useRef("home");
  const wantsAllBodiesRef = useRef(false);
  /**
   * Unread counts as the server sees them.
   *
   * The badge cannot be derived from messages any more: a thread whose body was
   * withheld carries none, and counting what arrived would quietly say zero.
   * The list is still built from messages — it is complete whenever the panel
   * asking for it is open — so the badge says how many there are and the panel
   * shows them.
   */
  const [serverUnread, setServerUnread] = useState<Record<string, number>>({});

  /**
   * The plan waiting on a person, and the promise the tool loop is parked on.
   *
   * Kept out of the message list on purpose: this is not something the agent
   * said, it is the run holding still. It renders under the log because the
   * thing being asked about is always the most recent thing.
   */
  const [pendingApproval, setPendingApproval] = useState<{
    plan: DesktopPlanCopy;
    decide: (approved: boolean) => void;
  } | null>(null);

  /**
   * The reply currently being written.
   *
   * Kept out of the thread until it is finished. A partial message in the list
   * would be persisted, polled back, and merged as a permanent truncated
   * message — the store is append-only and has no way to take one back.
   */
  const [streaming, setStreaming] = useState<{
    threadId: string;
    id: string;
    text: string;
  } | null>(null);

  /**
   * The mode the *server* clamped this turn to, not the local preference.
   *
   * The browser runs the verbs, so it has to be told what it may do. Trusting
   * `currentEffectiveAgentMode()` alone would let a client that believes it is
   * in Auto skip the card the server thinks it is enforcing.
   */
  const effectiveModeRef = useRef<OsAgentMode>(currentEffectiveAgentMode());

  /** Held in a ref as well so unmount can settle it without re-running. */
  const pendingDecideRef = useRef<((approved: boolean) => void) | null>(null);
  /** Aborts an in-flight turn when the window goes away mid-answer. */
  const turnAbortRef = useRef<AbortController | null>(null);

  voiceModeRef.current = voiceMode;

  /** A run parked on an unmounting window would wait forever. Deny instead. */
  useEffect(
    () => () => {
      pendingDecideRef.current?.(false);
      turnAbortRef.current?.abort();
    },
    [],
  );

  function requestApproval(plan: DesktopPlanCopy): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const decide = (approved: boolean) => {
        if (settled) return;
        settled = true;
        pendingDecideRef.current = null;
        setPendingApproval(null);
        resolve(approved);
      };
      pendingDecideRef.current = decide;
      setPendingApproval({ plan, decide });
    });
  }

  threadsRef.current = threads;

  const activeId = panel === "conversation" ? (params?.chatId ?? "home") : "home";
  activeIdRef.current = activeId;
  wantsAllBodiesRef.current = panel === "activity";
  const active = threads.find((t) => t.id === activeId) ?? threads[0];

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
    // The approval card counts: it appears below the log and is the one thing
    // here that is waiting on the user, so it must never arrive off-screen.
    // So does the streaming reply, which grows downward as it is written.
  }, [active?.messages.length, pendingApproval, streaming?.text]);

  /** Messages across every thread, newest first. An index, not an inbox. */
  const activity = useMemo(
    () =>
      threads
        .flatMap((thread) => thread.messages.map((m) => ({ thread, message: m })))
        .filter(({ message }) => message.role === "agent")
        .sort((a, b) => b.message.at.localeCompare(a.message.at)),
    [threads],
  );

  /**
   * Trust whichever source can see more.
   *
   * Local is ahead right after you open a thread — it has already marked it read
   * and the write has not landed. The server is ahead for a thread whose body
   * was withheld. Taking the max of the two would keep a badge alive after it
   * was cleared, so read state wins where we have the messages to judge it.
   */
  const unread = threads.reduce((total, thread) => {
    const hasBody = thread.messages.length > 0;
    return (
      total +
      (hasBody
        ? thread.messages.filter((m) => m.role === "agent" && !m.read).length
        : (serverUnread[thread.id] ?? 0))
    );
  }, 0);

  /**
   * Looking at a thread is what marks it read.
   *
   * Local first so the badge clears on the same frame, then written through —
   * otherwise the next 15s poll folds the old state back in and the number
   * reappears a moment after it went away.
   */
  useEffect(() => {
    const viewing = threadsRef.current.find((thread) => thread.id === activeId);
    if (!viewing?.messages.some((m) => m.role === "agent" && !m.read)) return;

    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === activeId
          ? {
              ...thread,
              messages: thread.messages.map((m) =>
                m.role === "agent" ? { ...m, read: true } : m,
              ),
            }
          : thread,
      ),
    );
    markRead(activeId);
  }, [activeId, threads]);

  function append(threadId: string, message: MockMessage) {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? { ...t, messages: [...t.messages, message], updatedAt: message.at }
          : t,
      ),
    );
    persist(threadId, [message]);
  }

  /**
   * Hydrate, then keep listening.
   *
   * The fixture threads are the first paint and the store is the truth; the
   * first load replaces one with the other. The interval afterwards is how a
   * message written by the heartbeat — by a process, while this tab sat idle —
   * arrives without anything here knowing that is what happened.
   */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Home always comes back with its messages; the open thread is asked
        // for by name; everything else arrives as a summary until it is opened.
        const query = wantsAllBodiesRef.current
          ? "?all=1"
          : `?with=${encodeURIComponent(activeIdRef.current)}`;
        const response = await fetch(`/api/conversations${query}`);
        if (!response.ok) return;
        const body = (await response.json()) as { conversations?: StoredConversationDto[] };
        if (cancelled || !Array.isArray(body.conversations)) return;
        const merged = mergeThreads(threadsRef.current, body.conversations);
        setThreads(merged);
        setServerUnread(
          Object.fromEntries(body.conversations.map((c) => [c.id, c.unread ?? 0])),
        );

        // Give the model back what it said. Only for threads with no live turn
        // in flight — rebuilding under a running turn would drop the tool
        // results that turn is midway through collecting.
        for (const thread of merged) {
          if (inFlightRef.current.has(thread.id)) continue;
          historyRef.current.set(thread.id, restoreHistory(thread.messages));
        }
      } catch {
        // Offline, or the server restarted mid-poll. The next tick retries.
      }
    }

    void load();
    const timer = window.setInterval(load, CONVERSATION_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // Re-runs when the open thread changes, which is what fetches that
    // thread's body — waiting up to a poll interval to see a conversation you
    // just clicked would read as the app having lost it.
  }, [activeId, panel]);

  async function runLiveAgent(threadId: string, voice: boolean): Promise<void> {
    const history = historyRef.current.get(threadId) ?? [];
    historyRef.current.set(threadId, history);
    inFlightRef.current.add(threadId);
    try {
      await runTurn(threadId, voice, history);
    } finally {
      inFlightRef.current.delete(threadId);
    }
  }

  async function runTurn(
    threadId: string,
    voice: boolean,
    history: LiveAgentMessage[],
  ): Promise<void> {

    for (let turn = 0; turn < 12; turn += 1) {
      let response: LiveAgentResponse;
      // The bubble the reply is being written into. Held here rather than in
      // the message list so a delta is one setState on one message, not a
      // rebuild of the thread on every token.
      const liveId = `a-${Date.now()}`;
      try {
        turnAbortRef.current?.abort();
        const abort = new AbortController();
        turnAbortRef.current = abort;
        response = await streamAgentTurn(
          { messages: history, voice, agentMode: currentEffectiveAgentMode() },
          {
            onDelta: (text) => setStreaming({ threadId, id: liveId, text }),
            onDiscard: () => setStreaming({ threadId, id: liveId, text: "" }),
          },
          abort.signal,
        );
        // The server re-read the ceiling for this turn. Whatever it clamped to
        // is what the executor here is allowed to do.
        if (response.mode) effectiveModeRef.current = response.mode;
      } catch (error) {
        setStreaming(null);
        // An abort is the window closing, not a failure. Writing "the agent
        // could not be reached" into a conversation the user just left would
        // make a deliberate cancellation look like an outage on their return.
        if (error instanceof DOMException && error.name === "AbortError") return;
        append(threadId, {
          id: liveId,
          role: "agent",
          text: error instanceof Error ? error.message : "The live agent could not be reached.",
          at: new Date().toISOString(),
          read: true,
        });
        return;
      }

      setStreaming(null);
      history.push({ role: "assistant", content: response.content });
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n\n")
        .trim();
      if (text) {
        append(threadId, {
          id: liveId,
          role: "agent",
          text,
          at: new Date().toISOString(),
          read: true,
        });
        if (voice) speakBrowserText(text);
      }

      const calls = response.content.filter((block) => block.type === "tool_use");
      if (calls.length === 0) return;

      for (const call of calls) {
        // Collab draws the consent line where the agent reaches *inside* an app
        // — `focus_panel` and `set_affordance` — not at moving windows around.
        const needsApproval =
          call.name === "desktop_act" &&
          batchNeedsApproval(proposedVerbs(call.input), effectiveModeRef.current);
        const approved = needsApproval
          ? await requestApproval(describePlanForUser(call.input, controller))
          : false;

        if (needsApproval && !approved) {
          // Denial is an answer, not a dismissal. Without a tool result the
          // model waits on a reply that is never coming and the turn hangs.
          const declined =
            "The user did not approve this plan, so none of it ran. Do not retry it. " +
            "Say what you were going to do and ask what they would prefer.";
          history.push({ role: "tool", toolUseId: call.id, content: declined });
          append(threadId, {
            id: `t-${Date.now()}-${call.name}`,
            role: "trace",
            kind: "DENIED",
            text: `${call.name}: the user declined this plan.`,
            at: new Date().toISOString(),
          });
          continue;
        }

        // Reading the SRE agent's reports is not a desktop verb: no controller,
        // no epoch, no approval. It returns already fenced, since the fencing
        // depends on where the text came from and only that module knows.
        const data = await handleDataToolCall(call.name, call.input);
        if (data !== null) {
          history.push({ role: "tool", toolUseId: call.id, content: data });
          append(threadId, {
            id: `t-${Date.now()}-${call.name}`,
            role: "trace",
            kind: "READ",
            text: `${call.name}: read the SRE agent's reports.`,
            at: new Date().toISOString(),
          });
          continue;
        }

        const result = await handleDesktopToolCall(
          call.name,
          call.input,
          controller,
          summon ? (reason) => summon.summon("agent", reason) : undefined,
          {
            // The agent's narration is queued before its local desktop call,
            // matching MCS's narration-before-action ordering for voice.
            waitForNarration: voice && text ? () => waitForFirstAudio(3_000) : undefined,
            toolCallId: call.id,
            approved,
            // The desktop's own history. Fire-and-forget, and keyed on the tool
            // call rather than the message: one reply can carry several plans,
            // so "why did my windows move" resolves to a call, not a paragraph.
            recordRun: (run) => {
              void fetch("/api/agent/runs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...run,
                  mode: effectiveModeRef.current,
                  requested_mode: currentEffectiveAgentMode(),
                  origin: voice ? "voice" : "typed",
                  conversation_id: threadId,
                  tool_call_id: run.toolCallId,
                  approved,
                }),
              }).catch(() => {
                // The action already happened. Losing the record is not worth
                // interrupting the turn over.
              });
            },
          },
        );
        const toolText = result ?? `Unsupported client tool: ${call.name}.`;
        // Window titles are app data — the snapshot carries text nobody here
        // authored, which is the whole reason the fence exists. It flags
        // anything addressed to an agent instead of letting it read as intent.
        history.push({
          role: "tool",
          toolUseId: call.id,
          content: fenceWithNotice(toolText, "app output"),
        });
        append(threadId, {
          id: `t-${Date.now()}-${call.name}`,
          role: "trace",
          kind: "TOOL",
          text: `${call.name}: ${toolText.split("\n")[0]}`,
          at: new Date().toISOString(),
        });
      }
    }

    append(threadId, {
      id: `a-${Date.now()}`,
      role: "agent",
      text: "I stopped after twelve tool rounds. The last desktop state is on screen; tell me what to continue with.",
      at: new Date().toISOString(),
      read: true,
    });
  }

  function send(textInput = draft, voice = false) {
    const text = textInput.trim();
    if (!text) return;
    if (!voice) setDraft("");
    setVoiceInterim("");
    append(activeId, {
      id: `u-${Date.now()}`,
      role: "user",
      text,
      at: new Date().toISOString(),
    });
    const history = historyRef.current.get(activeId) ?? [];
    history.push({ role: "user", content: text });
    historyRef.current.set(activeId, history);
    void runLiveAgent(activeId, voice);
  }

  submitVoiceTurnRef.current = send;

  const streamingVoice = useStreamingVoice({
    onSpeechStart: () => setVoiceInterim(""),
    onInterim: (text) => {
      if (voiceModeRef.current === "agent") setVoiceInterim(text);
    },
    onTurnEnd: (text) => {
      if (voiceModeRef.current !== "agent" || !text.trim()) return;
      submitVoiceTurnRef.current?.(text, true);
    },
    onError: (error) => {
      console.warn("[voice]", error);
      setVoiceMode("off");
    },
  });

  useEffect(
    () =>
      subscribeAgentTurn((text, options) => {
        send(text, options.voice === true);
      }),
    // `send` intentionally uses the current render's thread and controller.
    // The desktop bridge is subscribed once its chat window mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, controller],
  );

  function toggleVoice() {
    if (voiceMode === "agent") {
      streamingVoice.stop();
      setVoiceMode("off");
      setVoiceInterim("");
      return;
    }
    setVoiceMode("agent");
    void streamingVoice.start();
  }

  if (panel === "threads" || panel === "activity") {
    const isActivity = panel === "activity";
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-none items-center gap-1 border-b border-role-border-subtle px-sm py-2">
          {(["threads", "activity"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setParams({ panel: id })}
              className={cn(
                "rounded-xs px-2.5 py-1 text-body-sm capitalize",
                panel === id
                  ? "bg-role-surface-component-selected text-role-content-heading"
                  : "text-role-content-subtle hover:bg-role-surface-component-hover",
              )}
            >
              {id === "threads" ? "All threads" : "Activity"}
              {id === "activity" && unread > 0 && (
                <span className="ml-2 rounded-[5px] bg-role-surface-action px-[5px] text-label-lg font-medium tracking-normal text-role-foreground-on-inverse">
                  {unread}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          {isActivity
            ? activity.map(({ thread, message }) => (
                <Row
                  key={message.id}
                  onClick={() => setParams({ panel: "conversation", chatId: thread.id })}
                  className="items-start"
                >
                  <StatusDot
                    tone={message.read ? "idle" : (message.severity ?? "low")}
                    className="mt-1.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-body-sm font-medium text-role-content-heading">
                        {thread.title}
                      </span>
                      <span className="text-label text-role-content-placeholder">
                        {formatCompactRelativeTime(message.at)}
                      </span>
                    </div>
                    <p className="truncate text-body-xs text-role-content-subtle">
                      {message.text}
                    </p>
                  </div>
                </Row>
              ))
            : threads.map((thread) => (
                <Row
                  key={thread.id}
                  onClick={() => setParams({ panel: "conversation", chatId: thread.id })}
                >
                  <Icon icon={MessageSquare} size={13} className="text-role-icon-subtle" />
                  <span className="flex-1 truncate text-body-sm text-role-content-heading">
                    {thread.title}
                  </span>
                  <span className="text-label text-role-content-placeholder">
                    {formatCompactRelativeTime(thread.updatedAt)}
                  </span>
                </Row>
              ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <ThreadRail
        threads={threads}
        activeId={activeId}
        open={railOpen}
        onToggle={() => setRailOpen((v) => !v)}
        onNew={() => setParams({ panel: "home" })}
        onSelect={(id) =>
          setParams(id === "home" ? { panel: "home" } : { panel: "conversation", chatId: id })
        }
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={logRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-md pb-2">
          {active.messages.length === 0 ? (
            <div className="flex max-w-[420px] flex-col gap-3 pt-1.5">
              <p className="text-heading-md font-medium text-role-content-heading">
                What should DOS take off your plate?
              </p>
              <p className="text-body-sm text-role-content-muted">
                I own everything around shipping — security, privacy, reliability,
                compliance. I open the apps, correlate across them, and show my reasoning
                as I go.
              </p>
              <div className="mt-1 flex flex-col gap-1.5">
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => setDraft(starter)}
                    className="rounded-sm border border-role-border-subtle bg-role-surface-container-subtle px-3 py-2 text-left text-body-sm text-role-content-body hover:bg-role-surface-component-hover hover:text-role-content-heading"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            active.messages.map((message) => (
              <div key={message.id} className="animate-dos-fadeup">
                <MessageBubble message={message} />
              </div>
            ))
          )}

          {streaming && streaming.threadId === activeId && streaming.text ? (
            <MessageBubble
              message={{
                id: streaming.id,
                role: "agent",
                text: streaming.text,
                at: new Date().toISOString(),
                read: true,
              }}
            />
          ) : null}

          {pendingApproval ? (
            <div className="animate-dos-fadeup">
              <DesktopApprovalCard
                plan={pendingApproval.plan}
                onApprove={() => pendingApproval.decide(true)}
                onDeny={() => pendingApproval.decide(false)}
              />
            </div>
          ) : null}
        </div>

        <div className="flex-none border-t border-role-border-subtle p-2.5">
          {voiceMode === "agent" ? (
            <VoiceAgentBar
              isListening={streamingVoice.isListening}
              interim={voiceInterim}
              onClose={toggleVoice}
            />
          ) : (
            <div className="flex items-center gap-2 rounded-xs border border-role-border-subtle bg-role-surface-container-subtle px-3 py-2 focus-within:border-role-border-focus">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Ask, or tell it to do something..."
                className="min-w-0 flex-1 bg-transparent text-body-md text-role-content-heading outline-none placeholder:text-role-content-placeholder"
              />
              <button
                type="button"
                onClick={toggleVoice}
                disabled={!streamingVoice.isSupported}
                aria-label="Start voice conversation"
                title={
                  streamingVoice.isSupported
                    ? "Start voice conversation"
                    : "Voice recognition is not available in this browser"
                }
                className="flex size-7 items-center justify-center rounded-[7px] text-role-icon-muted transition-colors hover:bg-role-surface-component-hover hover:text-role-content-heading disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Icon icon={Mic} size={13} />
              </button>
              <button
                type="button"
                onClick={() => send()}
                disabled={!draft.trim()}
                aria-label="Send"
                className={cn(
                  "flex size-7 items-center justify-center rounded-[7px] transition-colors",
                  draft.trim()
                    ? "bg-role-surface-action text-role-foreground-on-inverse"
                    : "text-role-foreground-disabled",
                )}
              >
                <Icon icon={Send} size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
