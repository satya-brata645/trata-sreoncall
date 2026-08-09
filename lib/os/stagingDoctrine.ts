/**
 * How to compose a view — the judgment half of desktop control.
 *
 * The verbs decide nothing. They move windows, verifiably and identically every
 * time. *This* decides what goes where, what must stay visible, and when to
 * stop adding windows.
 *
 * Kept apart on purpose. Layout opinions change monthly; `snap_window` should
 * not. Everything here is data, rendered into the chat system prompt, so the
 * rules can be argued with and edited without touching a line of executor code
 * — and so they can be tested as data rather than as a paragraph in a string.
 *
 * See `docs/os-agent-control.md` §6.1. That document is the specification; this
 * is its executable form.
 */

export interface DoctrineRule {
  /** Short handle, for arguing about a specific rule. */
  id: string;
  /** The rule, as the agent reads it. Imperative, one sentence where possible. */
  rule: string;
  /** Why — kept in the prompt, because a rule with a reason is followed further. */
  because?: string;
}

/**
 * The rules, in the order they matter.
 *
 * Ordered so the ones that prevent harm come before the ones that improve
 * taste: an agent that runs out of attention should still not bury the chat or
 * close someone's work.
 */
export const STAGING_RULES: readonly DoctrineRule[] = [
  {
    id: "chat-visible",
    rule: "Never bury Chat. If you are speaking, or will need an answer, Chat stays visible — do not minimize it and do not fully cover it.",
    because: "It is where your voice and the user's reply live; hiding it hides the conversation.",
  },
  {
    id: "dont-close",
    rule: "Do not close a window you did not open during this run. Minimize instead.",
    because: "Closing tears down the app inside it and destroys work in flight.",
  },
  {
    id: "dont-steal-focus",
    rule: "If the user has typed in the last few seconds, stage around them — do not take focus.",
    because: "Stealing a live caret loses whatever they were mid-sentence on.",
  },
  {
    id: "prefer-opening",
    rule: "Prefer opening to rearranging. Add what is missing before you move what is already there.",
    because: "Opening is additive and ignorable; rearranging touches what the user set up themselves.",
  },
  {
    id: "comparison-is-two",
    rule: "For a comparison, use exactly two windows on left-half and right-half, with the one that answers the question on the left.",
    because: "Reading starts on the left, so the answer should be where the eye lands first.",
  },
  {
    id: "three-is-the-ceiling",
    rule: "Never leave more than three windows visible. If a fourth is needed, minimize the least relevant one rather than tiling smaller.",
    because: "Past three, nothing on screen is readable and the staging has become noise.",
  },
  {
    id: "reading-is-fill",
    rule: "To show one thing on its own, snap it to 'fill'. Never use full screen.",
    because:
      "Full screen hides the dock and the menu bar, which is where the user's mode control lives — it takes away their off-switch.",
  },
  {
    id: "open-then-arrange",
    rule: "Open everything you need first, in one call. Then arrange everything in a second call. Never mix an open into the middle of an arrangement.",
    because:
      "Opening ends the batch, so anything after it is skipped — mixing them strands the window you just opened, unarranged.",
  },

  // — inside a window —
  //
  // The eight rules above all govern *windows*. These govern acting *within*
  // one, which `focus_panel` already does and which affordances will widen.
  // Written before those verbs rather than after, because verbs without
  // doctrine is the exact failure `D7` exists to prevent — and because the
  // first of them is the guardrail on what this product is.
  {
    id: "reveal-dont-operate",
    rule: "Prefer revealing to operating. If bringing a view up answers the question, do that rather than working a control for them.",
    because:
      "Show people their product; do not use it for them. Working the filters does the task — putting the answer on screen teaches it.",
  },
  {
    id: "dont-submit",
    rule: "Never submit, send, confirm or apply anything unasked. Set the view up and stop.",
    because: "One action short of done is recoverable; one past it is not.",
  },
  {
    id: "dont-type-over",
    rule: "Never type into a field the user touched in the last few seconds.",
    because: "Overwriting a half-typed thought loses work nothing saved.",
  },
] as const;

/**
 * Named shapes for the situations that come up.
 *
 * Recipes rather than free composition because the same intent should produce
 * the same layout twice — an agent that stages "compare these" differently each
 * time is one the user cannot build a habit around.
 *
 * Structured so that, if this grows past a page, it can be served as on-demand
 * skill files without the rules themselves being rewritten. Four does not
 * justify a loader.
 */
export interface StagingRecipe {
  id: string;
  when: string;
  layout: string;
}

export const STAGING_RECIPES: readonly StagingRecipe[] = [
  {
    id: "comparison",
    when: "The user is comparing two things, or asked a question two surfaces answer together.",
    layout:
      "Open both, then snap the answering one to left-half and the supporting one to right-half.",
  },
  {
    id: "reading",
    when: "The user wants to read one report, dashboard or document.",
    layout:
      "Open it and snap it to 'fill'. Leave Chat reachable — do not cover it if you are still talking.",
  },
  {
    id: "triage",
    when: "Something needs attention now and the user has to act on it.",
    layout:
      "The thing that needs acting on at left-half, Chat at right-half so your narration and their reply stay together.",
  },
  {
    id: "walkthrough",
    when: "The user asked to be shown around, or is new.",
    layout:
      "One surface at a time, snapped to 'fill', moving on only after you have said what it is for. Never more than one new window per step.",
  },
] as const;

/**
 * Render the doctrine into the chat system prompt.
 *
 * A markdown section, matching how the rest of that prompt is written — it is a
 * ~270-line template literal already divided by `##` headings and already
 * prompt-cached, so this costs effectively nothing after the first call.
 */
export function renderStagingDoctrine(): string {
  const rules = STAGING_RULES.map(
    (rule, index) =>
      `${index + 1}. **${rule.rule}**${rule.because ? ` ${rule.because}` : ""}`,
  ).join("\n");

  const recipes = STAGING_RECIPES.map(
    (recipe) => `- **${recipe.id}** — ${recipe.when} ${recipe.layout}`,
  ).join("\n");

  return `## Staging a view

When you drive the desktop, you are composing something for someone to look at, not
just moving windows. These rules are not suggestions.

${rules}

### Shapes that work

${recipes}

If none of these fit, say what you are about to do and why before you do it.`;
}
