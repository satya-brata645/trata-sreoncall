"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, PanelLeft, Plus, Send } from "lucide-react";

import { cn, formatCompactRelativeTime, traceTime } from "@/lib/utils";
import { Icon, Row, SectionLabel, StatusDot } from "@/components/ui/primitives";
import { THREADS, type MockMessage, type MockThread } from "@/lib/mock/fixtures";
import { runMockAgent } from "@/lib/mock/agent";
import { useDesktopController } from "@/lib/os/DesktopControllerContext";
import type { OsAppProps } from "@/lib/os/types";

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
      <p
        style={edge ? { borderLeftColor: edge, borderLeftWidth: 2 } : undefined}
        className={cn(
          // A measure as well as a percentage: the window is resizable, and at
          // full width 82% is a 200-character line.
          "max-w-[min(82%,72ch)] rounded-[14px] rounded-bl-[4px] border border-role-border-subtle bg-role-surface-container px-3.5 py-2.5 text-body-md text-role-content-heading",
          edge && "rounded-bl-[4px] pl-3",
        )}
      >
        {message.text}
      </p>
    </div>
  );
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
  const [threads, setThreads] = useState<MockThread[]>(THREADS);
  const [railOpen, setRailOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const activeId = panel === "conversation" ? (params?.chatId ?? "home") : "home";
  const active = threads.find((t) => t.id === activeId) ?? threads[0];

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length]);

  /** Messages across every thread, newest first. An index, not an inbox. */
  const activity = useMemo(
    () =>
      threads
        .flatMap((thread) => thread.messages.map((m) => ({ thread, message: m })))
        .filter(({ message }) => message.role === "agent")
        .sort((a, b) => b.message.at.localeCompare(a.message.at)),
    [threads],
  );

  const unread = activity.filter(({ message }) => !message.read).length;

  function append(threadId: string, message: MockMessage) {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? { ...t, messages: [...t.messages, message], updatedAt: message.at }
          : t,
      ),
    );
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    append(activeId, {
      id: `u-${Date.now()}`,
      role: "user",
      text,
      at: new Date().toISOString(),
    });
    void runMockAgent(text, {
      controller,
      onMessage: (message) => append(activeId, message),
    });
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
        </div>

        <div className="flex-none border-t border-role-border-subtle p-2.5">
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
              placeholder="Ask, or tell it to do something…"
              className="min-w-0 flex-1 bg-transparent text-body-md text-role-content-heading outline-none placeholder:text-role-content-placeholder"
            />
            <button
              type="button"
              onClick={send}
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
        </div>
      </div>
    </div>
  );
}
