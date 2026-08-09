"use client";

import { useState, type ComponentType } from "react";
import { LayoutGrid, MessageSquare, Shapes, type LucideIcon } from "lucide-react";

import { STAGING_RECIPES, STAGING_RULES } from "@/lib/os/stagingDoctrine";
import { Icon, SectionLabel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface BrainSection {
  id: string;
  label: string;
  icon: LucideIcon;
  panel: ComponentType;
}

/**
 * The contract, as the agent actually reads it.
 *
 * Two halves, and the split is the point. The **communication** half is what the
 * agent is allowed to interrupt you about; the **staging** half is how it is
 * allowed to arrange your screen. Neither is settings — settings is where things
 * go to be configured once and forgotten, and this is the thing that decides
 * whether the product is an engineer or a dashboard generator.
 *
 * The staging sections are rendered from `lib/os/stagingDoctrine.ts`, not
 * retyped here. That module is the executable form of the doctrine and the same
 * data the agent is given, so this panel cannot drift into describing a policy
 * that is not in force — which is precisely the failure an inspectable brain
 * exists to prevent.
 *
 * The surrounding shell is MCS's `BrainConfig` layout: a flat 224px section list
 * on the left, the active section in the right pane. Flat rather than nested
 * because a config surface is a list of places rather than a hierarchy, and
 * because neither nav can be route-driven inside a window that has no routes of
 * its own.
 */
const SECTIONS: readonly BrainSection[] = [
  { id: "speak", label: "When I speak", icon: MessageSquare, panel: CommunicationPanel },
  { id: "screen", label: "Your screen", icon: LayoutGrid, panel: StagingPanel },
  { id: "shapes", label: "Shapes that work", icon: Shapes, panel: RecipesPanel },
];

/**
 * The materiality gate.
 *
 * Still prose rather than data, and honestly so: unlike staging, this half has
 * no module behind it yet. The gate is real in the sense that it is the agreed
 * design; it is not yet a thing the code consults, so nothing here should read
 * as a toggle.
 */
const COMMUNICATION: Array<[string, string]> = [
  ["Speak when", "It changes what I believe or what I do next"],
  ["Loud on", "Production exposure, safety risk, prolonged customer impact"],
  ["Quiet on", "Low-signal noise, staging churn, informational drift"],
  ["Cadence", "Fast while uncertain, slower once the risk envelope narrows"],
  ["May act alone", "Reachable production instability with a reversible fix path"],
  ["Always ask", "Anything that changes data, access, or non-trivial spend"],
];

function CommunicationPanel() {
  return (
    <>
      <SectionLabel className="px-0">When I speak</SectionLabel>
      <div className="flex flex-col">
        {COMMUNICATION.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline gap-md border-b border-role-border-subtle py-2.5 last:border-b-0"
          >
            <span className="w-[132px] shrink-0 text-body-sm text-role-content-muted">
              {label}
            </span>
            <span className="text-body-md text-role-content-heading">{value}</span>
          </div>
        ))}
      </div>
      <p className="max-w-[76ch] pt-md text-body-xs text-role-content-muted">
        The gate is materiality, not severity. An engineer does not report that nothing
        happened, but does report that the risk envelope changed. This half is agreed
        design, not yet code: nothing here consults it.
      </p>
    </>
  );
}

function StagingPanel() {
  return (
    <>
      <SectionLabel className="px-0" count={STAGING_RULES.length}>
        How I use your screen
      </SectionLabel>
      <ol className="flex flex-col gap-1">
        {STAGING_RULES.map((rule, index) => (
          <li
            key={rule.id}
            className="flex gap-3 rounded-sm border border-role-border-subtle bg-role-surface-container-subtle px-3 py-2.5"
          >
            <span className="dos-label pt-0.5 tabular-nums">{index + 1}</span>
            <span className="min-w-0">
              <span className="block max-w-[76ch] text-body-md text-role-content-heading">
                {rule.rule}
              </span>
              {rule.because && (
                <span className="mt-0.5 block max-w-[76ch] text-body-xs text-role-content-muted">
                  {rule.because}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

function RecipesPanel() {
  return (
    <>
      <SectionLabel className="px-0" count={STAGING_RECIPES.length}>
        Shapes that work
      </SectionLabel>
      <div className="flex flex-col">
        {STAGING_RECIPES.map((recipe) => (
          <div
            key={recipe.id}
            className="border-b border-role-border-subtle py-2.5 last:border-b-0"
          >
            <span className="dos-label">{recipe.id}</span>
            <p className="max-w-[76ch] text-body-md text-role-content-heading">{recipe.when}</p>
            <p className="max-w-[76ch] text-body-xs text-role-content-muted">{recipe.layout}</p>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Config — the Brain's configuration mode.
 *
 * `header` is the slot MCS uses to pin the Brain's mode switcher above this
 * mode's own section list. Trata's switcher is a horizontal bar that `BrainApp`
 * keeps above all three modes, so nothing passes it today; the prop stays for
 * parity, so moving the switcher into the rail is a one-line change.
 */
export function BrainConfig({ header }: { header?: React.ReactNode }) {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);

  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0];
  const ActivePanel = active.panel;

  return (
    <div className="flex h-full bg-role-surface-page">
      {/* Section list — the in-window replacement for a routed tab nav. */}
      <nav
        aria-label="Brain sections"
        className="flex w-[224px] shrink-0 flex-col overflow-auto border-r border-role-border-subtle p-xs text-body-sm"
      >
        {header && (
          <div className="mb-xs border-b border-role-border-subtle pb-xs">{header}</div>
        )}
        <div className="flex flex-col gap-3xs">
          {SECTIONS.map((section) => {
            const isActive = active.id === section.id;
            return (
              <button
                key={section.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => setActiveId(section.id)}
                className={cn(
                  "flex items-center gap-xs rounded-2xs px-xs py-2xs text-left",
                  "transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-role-border-focus",
                  // Active is marked with a lifted surface, accent text and a
                  // brand rule; hover uses the *same* surface so it never
                  // shouts louder than the current section.
                  "border-l-2",
                  isActive
                    ? "border-role-border-brand bg-[var(--color-role-surface-action-hover-subtle)] text-role-foreground-accent"
                    : "border-transparent text-role-content-body hover:bg-[var(--color-role-surface-action-hover-subtle)]",
                )}
              >
                <Icon icon={section.icon} size={15} />
                <span className="truncate">{section.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Panel */}
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-lg">
        <ActivePanel />
      </div>
    </div>
  );
}
