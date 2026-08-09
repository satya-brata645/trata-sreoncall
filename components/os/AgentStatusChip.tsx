"use client";

import { cn } from "@/lib/utils";

/**
 * Three bars in an equaliser.
 *
 * Motion rather than a spinner: the agent working is a *rhythm*, not a
 * percentage, and a spinner implies a job with an end the agent cannot promise.
 * Static under `prefers-reduced-motion`, which the keyframes already handle —
 * the bars stay visible, so the state is never carried by animation alone.
 */
function WorkingBars() {
  return (
    <span aria-hidden className="inline-flex h-2.5 items-center gap-[2px]">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-2.5 w-[2px] origin-center rounded-full bg-current"
          style={{
            animation: "dos-eq 900ms ease-in-out infinite",
            animationDelay: `${index * 140}ms`,
          }}
        />
      ))}
    </span>
  );
}

export type AgentStatus = "ready" | "working";

/**
 * The agent's state, in the menu bar.
 *
 * Violet means *live* — the session is up and the agent is reachable — so it is
 * the resting dot, pulsing slowly. Working is not a second colour but a second
 * kind of motion: the equaliser, which says a rhythm rather than a percentage.
 * Either way the word beside it carries the state for anyone who cannot see the
 * colour. Nothing else in the chrome may borrow the hue, or it stops meaning
 * anything.
 */
export function AgentStatusChip({
  status,
  className,
}: {
  status: AgentStatus;
  className?: string;
}) {
  const working = status === "working";

  return (
    <span
      role="status"
      // Polite, not assertive: this changes on every turn and must never
      // interrupt what a screen reader is already saying.
      aria-live="polite"
      className={cn(
        "inline-flex h-[30px] items-center gap-[7px] rounded-xs px-3",
        "border border-role-border-default bg-role-surface-component",
        "text-label-lg font-medium text-role-content-body",
        working && "text-role-foreground-accent",
        className,
      )}
    >
      {working ? (
        <WorkingBars />
      ) : (
        <span
          aria-hidden
          className="size-1.5 shrink-0 animate-dos-pulse rounded-full bg-[var(--dos-violet)]"
        />
      )}
      {working ? "WORKING" : "READY"}
    </span>
  );
}
