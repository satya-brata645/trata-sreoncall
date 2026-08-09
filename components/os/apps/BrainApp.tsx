"use client";

import { cn, formatCompactRelativeTime } from "@/lib/utils";
import { Icon, Row, SectionLabel, StatusDot } from "@/components/ui/primitives";
import { BELIEFS, TASK_LEDGER } from "@/lib/mock/fixtures";
import { appGlyph } from "@/lib/os/appGlyphs";
import type { OsAppProps } from "@/lib/os/types";

/**
 * Brain — what's true, what's running, what's next.
 *
 * Not settings. Settings is where things go to be configured once and
 * forgotten; the brain is the differentiator, so it sits at root. Its two
 * obligations are that it be **inspectable** — where did that belief come from,
 * and when — and **correctable**, because a belief you cannot fix is a belief
 * you have to work around.
 *
 * The ledger answers on pull, not push. A boss remembers what they delegated;
 * users delegate and forget, so the record exists on demand without a daily
 * report nobody asked for.
 */
type Panel = "config" | "memory" | "cortex";

const PANELS: Array<{ id: Panel; label: string }> = [
  { id: "config", label: "Config" },
  { id: "memory", label: "Memory" },
  { id: "cortex", label: "Cortex" },
];

const CONFIDENCE_COPY: Record<string, string> = {
  asserted: "You told me",
  observed: "I saw it",
  inferred: "I worked it out",
};

export function BrainApp({ params, setParams }: OsAppProps) {
  const panel: Panel =
    params?.panel === "memory" || params?.panel === "cortex"
      ? (params.panel as Panel)
      : "config";

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-1 border-b border-role-border-subtle px-sm py-2">
        {PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setParams({ panel: p.id })}
            className={cn(
              "rounded-xs px-2.5 py-1 text-body-sm",
              panel === p.id
                ? "bg-role-surface-component-selected text-role-content-heading"
                : "text-role-content-subtle hover:bg-role-surface-component-hover",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-md">
        {panel === "memory" && <Memory />}
        {panel === "cortex" && <Cortex />}
        {panel === "config" && <Config />}
      </div>
    </div>
  );
}

function Memory() {
  return (
    <>
      <SectionLabel count={BELIEFS.length}>What I believe</SectionLabel>
      <div className="flex flex-col gap-1 px-2.5">
        {BELIEFS.map((belief) => (
          <div
            key={belief.id}
            className="group rounded-sm border border-role-border-subtle bg-role-surface-container-subtle px-3 py-2.5"
          >
            <p className="text-body-md text-role-content-heading">{belief.claim}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="dos-label">{CONFIDENCE_COPY[belief.confidence]}</span>
              <span className="text-role-content-placeholder">·</span>
              <span className="text-body-xs text-role-content-muted">{belief.source}</span>
              <span className="text-role-content-placeholder">·</span>
              <span className="text-body-xs text-role-content-muted">
                {formatCompactRelativeTime(belief.learnedAt)}
              </span>
              <button
                type="button"
                className="ml-auto rounded-[7px] px-2 py-0.5 text-body-xs text-role-content-subtle opacity-0 transition-opacity hover:bg-role-surface-component-hover hover:text-role-content-heading group-hover:opacity-100"
              >
                This is wrong
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Cortex() {
  return (
    <>
      <SectionLabel count={TASK_LEDGER.length}>Task ledger</SectionLabel>
      <div className="flex flex-col gap-px px-2.5">
        {TASK_LEDGER.map((entry) => {
          const glyph = entry.app ? appGlyph(entry.app) : null;
          return (
            <Row key={entry.id} className="items-start">
              <StatusDot
                tone={
                  entry.state === "running"
                    ? "live"
                    : entry.state === "waiting"
                      ? "medium"
                      : "idle"
                }
                className="mt-1.5"
              />
              <div className="min-w-0 flex-1">
                <p className="text-body-md text-role-content-heading">{entry.what}</p>
                <div className="flex items-center gap-2">
                  <span className="dos-label">{entry.state}</span>
                  <span className="text-role-content-placeholder">·</span>
                  <span className="text-body-xs text-role-content-muted">
                    {entry.state === "planned"
                      ? "scheduled"
                      : formatCompactRelativeTime(entry.at)}
                  </span>
                </div>
              </div>
              {glyph && (
                <span style={{ color: glyph.tint }} className="pt-1">
                  <Icon icon={glyph.icon} size={13} />
                </span>
              )}
            </Row>
          );
        })}
      </div>
    </>
  );
}

const CONFIG_ROWS: Array<[string, string]> = [
  ["Speak when", "It would change what I think or what I do next"],
  ["Loud on", "Production exposure, breach, overdue compliance"],
  ["Quiet on", "Dev asset drift, staging findings, informational advisories"],
  ["Cadence", "Chatty this week, decaying — silence has to be earned"],
  ["May act alone", "Reachable critical on an internet-facing service"],
  ["Always ask", "Anything that changes data, spend or access"],
];

function Config() {
  return (
    <>
      <SectionLabel>The contract</SectionLabel>
      <div className="flex flex-col px-2.5">
        {CONFIG_ROWS.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline gap-md border-b border-role-border-subtle px-2.5 py-2.5 last:border-b-0"
          >
            <span className="w-[120px] shrink-0 text-body-sm text-role-content-muted">
              {label}
            </span>
            <span className="text-body-md text-role-content-heading">{value}</span>
          </div>
        ))}
      </div>
      <p className="px-5 pt-md text-body-xs text-role-content-muted">
        The gate is materiality, not severity. An engineer does not report that nothing
        happened — but does report that the audit gap closed.
      </p>
    </>
  );
}
