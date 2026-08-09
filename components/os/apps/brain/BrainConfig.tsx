"use client";

import { STAGING_RECIPES, STAGING_RULES } from "@/lib/os/stagingDoctrine";
import { SectionLabel } from "@/components/ui/primitives";

/**
 * The contract, as the agent actually reads it.
 *
 * Two halves, and the split is the point. The **communication** half is what the
 * agent is allowed to interrupt you about; the **staging** half is how it is
 * allowed to arrange your screen. Neither is settings — settings is where things
 * go to be configured once and forgotten, and this is the thing that decides
 * whether the product is an engineer or a dashboard generator.
 *
 * The staging rules are rendered from `lib/os/stagingDoctrine.ts`, not retyped
 * here. That module is the executable form of the doctrine and the same data the
 * agent is given, so this panel cannot drift into describing a policy that is
 * not in force — which is precisely the failure an inspectable brain exists to
 * prevent.
 */

/**
 * The materiality gate.
 *
 * Still prose rather than data, and honestly so: unlike staging, this half has
 * no module behind it yet. The gate is real in the sense that it is the agreed
 * design; it is not yet a thing the code consults, so nothing here should read
 * as a toggle.
 */
const COMMUNICATION: Array<[string, string]> = [
  ["Speak when", "It would change what I think, or what I do next"],
  ["Loud on", "Production exposure, breach, overdue compliance"],
  ["Quiet on", "Dev asset drift, staging findings, informational advisories"],
  ["Cadence", "Chatty this week, decaying — silence has to be earned"],
  ["May act alone", "A reachable critical on an internet-facing service"],
  ["Always ask", "Anything that changes data, spend or access"],
];

export function BrainConfig() {
  return (
    <div className="pb-lg">
      <SectionLabel className="px-md pt-3">When I speak</SectionLabel>
      <div className="px-2.5">
        {COMMUNICATION.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline gap-md border-b border-role-border-subtle px-2.5 py-2.5 last:border-b-0"
          >
            <span className="w-[132px] shrink-0 text-body-sm text-role-content-muted">
              {label}
            </span>
            <span className="text-body-md text-role-content-heading">{value}</span>
          </div>
        ))}
      </div>
      <p className="max-w-[76ch] px-5 pt-3 text-body-xs text-role-content-muted">
        The gate is materiality, not severity. An engineer does not report that nothing
        happened — but does report that the audit gap closed. This half is agreed design,
        not yet code: nothing below consults it.
      </p>

      <SectionLabel className="px-md pt-lg" count={STAGING_RULES.length}>
        How I use your screen
      </SectionLabel>
      <ol className="flex flex-col gap-1 px-2.5">
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

      <SectionLabel className="px-md pt-lg" count={STAGING_RECIPES.length}>
        Shapes that work
      </SectionLabel>
      <div className="flex flex-col px-2.5">
        {STAGING_RECIPES.map((recipe) => (
          <div
            key={recipe.id}
            className="border-b border-role-border-subtle px-2.5 py-2.5 last:border-b-0"
          >
            <span className="dos-label">{recipe.id}</span>
            <p className="max-w-[76ch] text-body-md text-role-content-heading">{recipe.when}</p>
            <p className="max-w-[76ch] text-body-xs text-role-content-muted">{recipe.layout}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
