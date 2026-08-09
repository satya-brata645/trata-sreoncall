"use client";

/**
 * The moment a person decides whether the agent may touch their screen.
 *
 * Two rules govern everything here. The plan is stated in words, never
 * arguments — `describeDesktopPlan` does that work, and the wording is the
 * safety feature. And denial is a real answer, not a dismissal: the model is
 * told it was refused, so the turn continues honestly instead of hanging on a
 * tool result that never arrives.
 *
 * `assertive` on the live region is right exactly once — this is the one thing
 * on the desktop that is waiting on the user rather than informing them.
 */

import { Check, X } from "lucide-react";

import type { DesktopPlanCopy } from "@/lib/agent/desktop-plan-copy";
import { Icon } from "@/components/ui/primitives";

export function DesktopApprovalCard({
  plan,
  onApprove,
  onDeny,
  busy = false,
}: {
  plan: DesktopPlanCopy;
  onApprove: () => void;
  onDeny: () => void;
  busy?: boolean;
}) {
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="The agent is asking to change your desktop"
      className="rounded-[12px] border border-role-border-default bg-role-surface-container-subtle p-3.5"
    >
      <p className="dos-label text-role-content-subtle">Asking first</p>

      {plan.intent ? (
        <p className="mt-2 text-body-md text-role-content-heading">{plan.intent}</p>
      ) : null}

      {plan.steps.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {plan.steps.map((step, index) => (
            <li
              key={`${index}-${step}`}
              className="flex gap-2 text-body-sm text-role-content-body"
            >
              <span className="mt-[7px] size-[4px] flex-none rounded-full bg-role-icon-muted" />
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-body-sm text-role-content-muted">
          It did not say what it wants to change. Denying is the safe answer.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-[9px] bg-role-surface-action px-3 py-1.5 text-body-sm font-medium text-role-foreground-on-inverse transition-opacity disabled:opacity-50"
        >
          <Icon icon={Check} size={13} />
          Allow
        </button>
        <button
          type="button"
          onClick={onDeny}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-[9px] border border-role-border-subtle px-3 py-1.5 text-body-sm text-role-content-body transition-colors hover:bg-role-surface-component-subtle disabled:opacity-50"
        >
          <Icon icon={X} size={13} />
          Not now
        </button>
      </div>
    </div>
  );
}
