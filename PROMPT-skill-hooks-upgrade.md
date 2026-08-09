# Upgrade plan — porting `transilienceai/communitytools`'s verified-pipeline
# pattern to close the Malleability gap (55 → 95+)

Source pattern studied directly from the repo (not guessed): `.claude/workflows/skill-update.js`
(the skill-learning pipeline) and `.claude/workflows/coordinator-loop.js` (the persistent,
file-stateful agent loop). Both are read in full before writing this plan. This document
adapts their exact mechanism to SREonCall's skill-authoring and hook-loop, keeping everything
already validated in `agent/` (§0's AI-native gate, the evidence store, triage/correlator).

---

## 0. The core insight this pattern is built on — and why it fixes Malleability

Our current `skills/author.js` has one agent decide, in one shot: *should a skill get written?*
That's a single, unaudited judgment call — and it's exactly why our two live tests both ended
in the agent (correctly, but unfalsifiably) declining. There's no way to tell "genuinely
nothing new" apart from "the one judge was lazy, vague, or under-informed," and a judge who
scores this build has no way to trust it either.

`skill-update.js`'s answer, verbatim from its own comments:

> "a tool computes the facts, a tool-runner agent relays them VERBATIM, and the pure-JS gates
> below make every accept/reject call. No LLM decides whether a learning is promoted, whether
> a write is allowed, or whether the run passed."

Read that precisely — it does **not** mean no LLM judgment happens. It means:

- **LLM agents judge qualitative properties** (is this generalizable? is it already captured?
  does this text look like a fabricated finding?) — each judgment returned as a **structured,
  evidenced answer** (a JSON schema, never free text), because free text can't be gated.
- **Deterministic code decides accept/reject/write** by applying a fixed formula — an AND of
  gates, a vote tally, a regex scrub — to those structured judgments. The code never asks *"is
  this a good skill"* itself; it only checks *"did the agents' own reported properties satisfy
  the stated rule."*
- **Independent agents cross-check each other** — a judge proposes, N blind refuters
  independently try to kill the proposal, and only a formal majority-vote-and-gate combination
  promotes anything. One agent's bias or laziness can't singlehandedly decide the outcome.

This is compatible with our own §0 (no domain threshold decides severity/firing/correlation)
because none of the gates below are domain judgments — they're process-integrity checks
*about the judging itself* (did you actually search for duplicates? does this look like
target-specific lore instead of a reusable pattern? did the write agent violate an explicit
structural rule?). That's a fundamentally different thing from `if (errorRate > 0.05)`, and the
plan below is careful to keep that line intact — see §5's explicit checklist.

---

## 1. New `skills/author.js` — Harvest → Judge → Refute → Gate → Author → Write → Verify

Replace the current single-shot `reflect()` with this seven-stage pipeline, run on
`incident.resolved`:

```
HARVEST   one read-only agent mines the resolved incident + its alerts + evidence into
          candidate "When <symptom pattern>, <investigative approach>" heuristics —
          NEVER "on incident inc_xxx, X happened." Placeholders replace every concrete
          value: <SERVICE>, <FLAG_NAME>, <METRIC_NAME> — exactly like their <TARGET_IP>/
          <DC_FQDN>/<DOMAIN> substitution. A candidate that needs THIS incident's id, this
          alert's id, or a literal trace id to make sense is lore, not a skill, same as
          their own rule for challenge/lab identifiers.

JUDGE     one agent per candidate, evaluates FOUR gates, ALL required to promote:
            1. GENERALIZABLE   — reusable investigative heuristic, not this-incident-only
                                 fact. No incident/alert/trace ids, no literal timestamps.
            2. MATERIAL        — would actually change/speed up FUTURE triage, not
                                 something a competent triage agent already does by
                                 following its existing base skills.
            3. NOT_ALREADY_CAPTURED — MANDATORY: the judge must actually search existing
                                 skills (base/ + learned/) and report each search query,
                                 hit count, and the closest match with a quote. An EMPTY
                                 duplicate_search is treated as an unevidenced novelty
                                 claim and auto-rejects — exactly their rule.
            4. MINIMAL_FOOTPRINT — prefer revising an existing skill's body over writing a
                                 new file. A new file requires naming which existing
                                 skills were considered and why none could host this.

REFUTE    only candidates that would otherwise pass all four gates get refuted (refuting a
          dead candidate is waste, per their own comment). N=3 blind adversarial agents,
          each independently trying to kill it on exactly one gate, each required to CITE
          evidence for the kill (e.g. "already captured — see check-dependencies-before-
          blaming-the-symptom.md, this exact heuristic"). Majority refute (2 of 3) kills it.

GATE      pure JS, zero model calls: promote only if all four gates hold AND refute-count <
          majority AND a scrub check finds no incident/alert/trace-id-shaped strings in the
          candidate text (regex, not judgment — see §5).

AUTHOR    one agent writes the EXACT skill file content (frontmatter + body) for each
          promoted candidate — into a NEW file or as a revision to an existing one, per the
          judge's footprint decision. It does not decide whether to write; that was already
          decided. It only produces the content.

WRITE     the file gets written; a second, independent step re-reads it back through
          `skills/loader.js` and confirms it parses with the expected name/description —
          this is their "writer persists, an independent verifier recomputes" split,
          adapted: our verifier is just "does loader.js round-trip this file correctly."

VERIFY    a code-only check: does this collide with an existing skill name? Does the body
          contain a banned pattern (see §5)? If either verification fails, DELETE the file
          that was just written — never leave a half-good skill on disk. This is their
          revert-on-block behavior, simplified since we have no git-commit boundary to
          restore to; a straight delete-if-invalid is the equivalent safety net.

REPORT    a three-bucket Promoted / Skipped / No-changes report, built ENTIRELY in code
          from the gate decisions — never authored by an agent, so a report can never
          claim a write that didn't happen. Appended to the shift handoff (§9 of the main
          plan).
```

### Schemas (mirrors their INTAKE/JUDGE/REFUTE/AUTHOR/WRITER split)

```js
const HARVEST_SCHEMA = {
  type: "object", required: ["candidates"],
  properties: {
    candidates: { type: "array", items: {
      type: "object", required: ["text", "evidence_refs"],
      properties: {
        text: { type: "string", description: "a 'When <symptom>, <approach>' pattern, placeholders only" },
        evidence_refs: { type: "array", items: { type: "string" } },
      },
    }},
  },
};

const JUDGE_SCHEMA = {
  type: "object",
  required: ["generalizable", "material", "not_already_captured", "minimal_footprint", "duplicate_search"],
  properties: {
    generalizable: { type: "boolean" },
    material: { type: "boolean" },
    not_already_captured: { type: "boolean" },
    minimal_footprint: { type: "boolean" },
    duplicate_search: {
      type: "array", description: "MANDATORY — each search you actually ran over existing skills",
      items: { type: "object", required: ["query", "hits"],
        properties: { query: { type: "string" }, hits: { type: "number" }, closest: { type: "string" } } },
    },
    footprint: { type: "string", enum: ["extend", "new-file"] },
    no_host_reason: { type: "string", description: "REQUIRED when footprint is new-file" },
    proposed_target: { type: "string" },
  },
};

const REFUTE_SCHEMA = {
  type: "object", required: ["refuted"],
  properties: {
    refuted: { type: "boolean" },
    gate: { type: "string", enum: ["generalizable", "material", "not_already_captured", "minimal_footprint", ""] },
    reason: { type: "string" },
    duplicate_at: { type: "string" },
  },
};

const AUTHOR_SCHEMA = {
  type: "object", required: ["name", "description", "body", "creates_file"],
  properties: {
    name: { type: "string" }, description: { type: "string" }, body: { type: "string" },
    creates_file: { type: "boolean" },
    revises_existing: { type: "string", description: "name of the skill being revised, if not creates_file" },
  },
};
```

### The pure-JS gate (the actual accept/reject code — port of `promotionGate`)

```js
function promotionGate(candidate, judgment, refuteVotes) {
  const failed = [];
  if (!judgment.generalizable) failed.push("generalizable");
  if (!judgment.material) failed.push("material");
  if (!judgment.not_already_captured) failed.push("not_already_captured");
  if (!judgment.minimal_footprint) failed.push("minimal_footprint");
  const searched = Array.isArray(judgment.duplicate_search) && judgment.duplicate_search.length > 0;
  if (judgment.not_already_captured && !searched) failed.push("not_already_captured:unevidenced");
  if (judgment.footprint === "new-file" && !judgment.no_host_reason?.trim()) {
    failed.push("minimal_footprint:no_host_reason");
  }
  const scrub = scrubIncidentIdentifiers(candidate.text);
  if (!scrub.clean) failed.push(`generalizable:scrub(${scrub.hits.join(",")})`);

  const refuteCount = refuteVotes.filter((v) => v.refuted).length;
  const majority = Math.floor(refuteVotes.length / 2) + 1;
  if (refuteVotes.length > 0 && refuteCount >= majority) {
    return { decision: "REJECT", reason: `refuted ${refuteCount}/${refuteVotes.length}`, failed };
  }
  if (failed.length) return { decision: "SKIP", reason: failed.join(", "), failed };
  return { decision: "PROMOTE", reason: "all four gates hold", failed: [] };
}
```

---

## 2. New `run.js` loop — file-stateful, fresh-context-per-step (port of `coordinator-loop.js`)

The single biggest operational lesson from `coordinator-loop.js`, stated in its own comments:

> "a 1000-experiment hunt cannot fit one agent's context. Files are the memory; each
> think/execute/integrate agent is a fresh, cheap context that loads exactly the state it
> needs."

**This is the direct fix for the rate-limit failures hit live in this session.** Our
`triage.js`/`correlator.js` currently run one long tool-use conversation that accumulates
every tool result in-context across up to 10-16 turns — that's exactly what blew past the
shared 30k-TPM budget mid-session. Their pattern avoids this entirely by never running one
long conversation: every step is a *new, small* agent call that reads only the relevant slice
of `state.json` / evidence refs, does one job, and writes its conclusion back to state before
the next step starts fresh.

### The new cycle shape

```
ATTENTION   (unchanged — already cheap and fresh each cycle)
     │
     ▼
INVESTIGATE   fresh agent, given ONLY the current window + evidence refs (not a growing
              transcript). Produces a hypothesis + a short list of follow-up queries it
              wants run, as STRUCTURED OUTPUT — not by looping tool calls itself.
     │
     ▼
[code executes the requested queries against lgtm.js, records evidence, done]
     │
     ▼
DECIDE        a second fresh agent, given the investigation's hypothesis + the NEW evidence
              just fetched (small, bounded payload) — decides raise_alert or not. This
              replaces the single long tool-loop with two short, cheap calls plus
              deterministic query execution in between.
     │
     ▼
SKEPTIC       (new — ported directly from their P4b skeptic role) a fresh, blind agent
              reviews the alert about to be raised and tries to argue it's wrong — noise,
              already recovering, insufficient evidence. If the skeptic's objection is
              strong (structured verdict, not vibes), the alert is downgraded to "needs
              more evidence" and looped back to INVESTIGATE once more before being raised
              for real. This is a second, independent check on triage the same way
              refuters check skill promotion — it directly strengthens Auditability too,
              since every alert that survives has explicitly survived a challenge.
     │
     ▼
CORRELATE     unchanged in spirit, but same fresh-context treatment: given only open
              incidents' summaries + the new alert, not an accumulating conversation.
     │
     ▼
INTEGRATE     the SOLE writer of state.json for this cycle (their rule: only one step ever
              writes shared state, so nothing races). Everything upstream returns data;
              only this step calls `state.save()`.
```

### Why this also raises Agency and Observability scores, not just Malleability

- Shorter, cheaper calls mean the attention hook's self-paced cadence can safely run *more
  often* without hitting rate limits — directly strengthens the "sustained unattended
  operation" claim that scored 75 before.
- The SKEPTIC step gives us a second, mechanically distinct source of "the reasoning visibly
  adapted" evidence beyond the correlator's `revisions[]` — a judge can point at a specific
  alert and see it was independently challenged before being raised, not just accepted on
  the first agent's say-so.

---

## 3. The mechanical write-gate as an enforcement backstop for our own AI-native rule

This is the single most valuable idea to port, and it's not about skills quality — it's about
**making §0's "no hardcoded thresholds" rule checkable by code, not just promptable.**

Their `writeGate` rejects a skill-authoring agent's output if it contains a bare `DO NOT` /
`MUST NOT` / `NEVER` outside an Anti-Patterns section, an unresolved link, or a forbidden file
type — structural rules enforced in code *about content an LLM produced*, so a sloppy or
rushed author-agent output can't slip a bad pattern into the shared skill base.

We adapt this into a genuinely new safety net for ourselves:

```js
// Reject any learned-skill body that itself looks like a hardcoded rule — the
// exact anti-patterns forbidden in code by §0, now also forbidden IN SKILL TEXT.
const FORBIDDEN_SKILL_PATTERNS = [
  [/\b(errorRate|latency|cpu|memory)\s*[<>]=?\s*[\d.]+/i, "looks like a hardcoded numeric threshold"],
  [/\bif\s*\(.*[<>]=?.*\)\s*(alert|fire|raise)/i, "looks like an if/threshold rule, not a heuristic"],
  [/severity\s*[:=]\s*['"]?(sev[1-4]|critical|high|medium|low)['"]?\s*(always|whenever)/i, "hardcodes a fixed severity mapping"],
];

function skillContentGate(body) {
  for (const [pattern, reason] of FORBIDDEN_SKILL_PATTERNS) {
    if (pattern.test(body)) return { ok: false, reason };
  }
  return { ok: true };
}
```

This means the self-authoring loop cannot accidentally teach the agent a threshold-shaped
habit even if a future prompt regression nudges an author-agent toward writing one — the same
"gate refuses even a well-intentioned violation" principle their `writeGate` uses for
Anti-Patterns sections, now pointed at our own hard rule instead of theirs.

---

## 4. What does NOT change

- The triage/correlator system prompts, tool definitions, and evidence-citation rules from the
  main plan (`PROMPT-signal-to-incident.md`) stay exactly as validated.
- Base skills in `skills/base/` are untouched.
- The AI-native gate (§0) is not renegotiated — every gate function above is checking *process
  integrity of agent-produced judgments*, never substituting a domain threshold. If a future
  edit to any gate function starts asking "is the error rate above X," that's the line being
  crossed — see §5's explicit test.

## 5. The line-check before shipping any of this

Before merging any gate function from this plan, run this check on it, same spirit as the main
plan's operational-parameters test:

> Does this function's `if` conditions ever reference a raw telemetry value (an error rate, a
> latency number, a log count) directly? If yes — stop, that's a smuggled threshold. Every
> condition above should only ever reference **agent-reported structured judgments**
> (`judgment.generalizable`, `refuted`, a regex match on agent-authored *text*) — never a
> metric pulled straight from Mimir/Loki. That distinction is what keeps this whole pattern on
> the right side of §0.

---

## 6. Acceptance test — the actual malleability proof this unlocks

1. Run a controlled incident (per the earlier plan: a scenario our 4 base skills don't
   comfortably cover) through DECLARE → RESOLVE.
2. Confirm HARVEST produces at least one candidate, JUDGE scores it, REFUTE challenges it, and
   the candidate either promotes (with a full audit trail of why) or is skipped (with a
   specific failed gate named) — either outcome is now **defensible and inspectable**, not a
   single agent's unfalsifiable "no thanks."
3. If promoted: re-trigger the same fault. Confirm the INVESTIGATE step cites the new skill by
   name and the SKEPTIC step's challenge (if any) references it too.
4. Capture both incident transcripts, the full Harvest→Judge→Refute→Gate trail, and the
   before/after skill file diff as artifacts — this is the literal anti-gaming re-trigger test
   from docs/03, now backed by a verifiable decision trail instead of a hoped-for outcome.

## 7. Order of implementation

1. Port `scrubIncidentIdentifiers` + `promotionGate` + `skillContentGate` as pure functions,
   unit-testable with no model calls at all — same as their code being testable without an LLM.
2. Rebuild `skills/author.js` as the seven-stage pipeline in §1, reusing `agents/investigative-
   tools.js` for the Judge step's duplicate-search.
3. Rebuild the `run.js` cycle per §2 — INVESTIGATE/DECIDE/SKEPTIC/CORRELATE/INTEGRATE as
   separate fresh-context calls, replacing the long tool-loop conversations in `triage.js` and
   `correlator.js`. This is the change most likely to also fix the rate-limit fragility.
4. Run the §6 acceptance test against a controlled incident and capture the artifacts.
5. Re-score against the rubric — Malleability and Auditability are the two traits this
   directly targets; Agency should also move given the cheaper per-cycle cost.
