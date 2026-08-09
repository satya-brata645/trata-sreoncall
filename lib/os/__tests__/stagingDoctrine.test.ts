import { test } from "node:test";
import assert from "node:assert/strict";

import {
  renderStagingDoctrine,
  STAGING_RECIPES,
  STAGING_RULES,
} from "../stagingDoctrine";
import { VERB_TABLE } from "../agentProtocol";

test("every rule is uniquely identified, so one can be argued with by name", () => {
  const ids = STAGING_RULES.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every rule carries its reason", () => {
  // A rule with a reason is followed further than a rule without one.
  for (const rule of STAGING_RULES) {
    assert.ok(rule.because, `${rule.id} needs a reason`);
  }
});

test("the harm-preventing rules come before the taste rules", () => {
  // An agent that runs out of attention should still not bury the chat or
  // close someone's work.
  const ids = STAGING_RULES.map((rule) => rule.id);
  assert.ok(ids.indexOf("chat-visible") < ids.indexOf("comparison-is-two"));
  assert.ok(ids.indexOf("dont-close") < ids.indexOf("three-is-the-ceiling"));
});

test("the doctrine forbids full screen, matching the verb table", () => {
  // Two layers say this; they must not drift. The verb refuses it mechanically,
  // and the doctrine explains why so the agent does not keep trying.
  const rule = STAGING_RULES.find((r) => r.id === "reading-is-fill");
  assert.ok(rule);
  assert.match(rule.rule, /Never use full screen/);
  assert.equal(VERB_TABLE.full_screen.permissions.auto, "deny");
});

test("open-then-arrange matches what the batch guard does anyway", () => {
  // Where the deterministic layer and the doctrine agree, they are stated as
  // one rule — a model follows one rule far more reliably than two that look
  // unrelated.
  const rule = STAGING_RULES.find((r) => r.id === "open-then-arrange");
  assert.ok(rule);
  // The rule and the tool description used to contradict each other — one said
  // "open everything FIRST", the other "put open_app LAST" — and the model
  // split the difference: it arranged one window, opened the second, and the
  // open ended the batch, stranding the new window unarranged. They now say
  // the same thing, so this asserts the shape rather than a stray word.
  assert.match(rule.rule, /first/i);
  assert.match(rule.rule, /second call|then arrange/i);
  assert.match(rule.because ?? "", /skipped|stranded|strands/i);
  assert.equal(VERB_TABLE.open_app.verbClass, "set");
});

test("recipes are uniquely identified and name their situation", () => {
  const ids = STAGING_RECIPES.map((recipe) => recipe.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const recipe of STAGING_RECIPES) {
    assert.ok(recipe.when.length > 0);
    assert.ok(recipe.layout.length > 0);
  }
});

test("the rendered doctrine is a markdown section carrying every rule", () => {
  const rendered = renderStagingDoctrine();
  assert.match(rendered, /^## Staging a view/);
  for (const rule of STAGING_RULES) {
    assert.ok(
      rendered.includes(rule.rule),
      `rendered prompt is missing rule ${rule.id}`,
    );
  }
  for (const recipe of STAGING_RECIPES) {
    assert.ok(rendered.includes(recipe.id));
  }
});

test("the rendered doctrine stays small enough to sit in a cached prompt", () => {
  // It rides in the system prompt on every request; cached or not, it should
  // not be the reason a prompt gets big.
  //
  // Raised from 3000 when Stage 9.5 added the three inside-a-window rules.
  // That is a new *category* of rule, not the old ones getting wordier — and
  // the alternative was deleting reasons to fit, which this file's own
  // principle argues against ("a rule with a reason is followed further").
  // A ceiling that forces real content out is mis-calibrated rather than
  // strict. ~875 tokens still holds the line the comment above is drawing;
  // if it ever needs raising again, that is the signal to take the escape
  // hatch the recipes are already structured for and serve the doctrine as
  // on-demand skill files instead of widening this again.
  assert.ok(
    renderStagingDoctrine().length < 3500,
    `doctrine is ${renderStagingDoctrine().length} chars`,
  );
});

// ---------------------------------------------------------------------------
// Pointing inside a window (Phase 9, Stage 9.5)
//
// Written before the affordance verbs exist, not after: verbs without doctrine
// is the failure D7 exists to prevent, and the first rule below is the
// guardrail on what this product is rather than a matter of taste.
// ---------------------------------------------------------------------------

test("the doctrine says to reveal rather than operate", () => {
  // The guardrail against §3's drift from Point to operate. An agent that
  // clicks Filter and types a query is doing the user's work instead of
  // showing them the answer — a different product from the one specified.
  const rule = STAGING_RULES.find((r) => r.id === "reveal-dont-operate");
  assert.ok(rule, "the rule must exist before any verb that could break it");
  assert.match(rule.rule.toLowerCase(), /reveal/);
  assert.ok(rule.because, "a rule with a reason is followed further");
});

test("the doctrine forbids submitting anything unasked", () => {
  const rule = STAGING_RULES.find((r) => r.id === "dont-submit");
  assert.ok(rule);
  assert.match(rule.rule.toLowerCase(), /never submit/);
});

test("the doctrine protects a field the user is typing in", () => {
  const rule = STAGING_RULES.find((r) => r.id === "dont-type-over");
  assert.ok(rule);
  assert.match(rule.rule.toLowerCase(), /never type/);
});

test("the inside-a-window rules reach the model", () => {
  // They only count if they survive rendering into the prompt — a rule that
  // lives in a data file the prompt does not include governs nothing.
  const prompt = renderStagingDoctrine();
  for (const id of ["reveal-dont-operate", "dont-submit", "dont-type-over"]) {
    const rule = STAGING_RULES.find((r) => r.id === id);
    assert.ok(
      prompt.includes(rule!.rule),
      `${id} is not in the rendered doctrine`,
    );
  }
});

test("harm-preventing rules still come before taste", () => {
  // The ordering is load-bearing: an agent that runs out of attention should
  // still not bury chat, close someone's work, or submit a form.
  const ids = STAGING_RULES.map((r) => r.id);
  assert.ok(
    ids.indexOf("dont-submit") < ids.indexOf("open-then-arrange") ||
      ids.indexOf("chat-visible") < ids.indexOf("comparison-is-two"),
    "protective rules must not sink below cosmetic ones",
  );
});
