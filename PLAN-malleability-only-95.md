# Plan — Malleability to 95+, and nothing else

Single objective: prove, not assert, that the SREonCall agent's reasoning visibly changes
based on what it has actually experienced. This is the one trait scored lowest (55/100)
because both live tests so far ended in an agent *declining* to learn — correctly, but
unfalsifiably, since a single agent's "no thanks" can't be told apart from laziness. This plan
exists to make the DECLARE → RESOLVE → LEARN → RE-TRIGGER loop happen once, for real, with
every step evidenced — and to make it happen in a way that stays fully AI-native throughout,
not just at the edges.

Self-contained. Does not require the other two plan documents, though it reuses the verified
pipeline shape studied from `transilienceai/communitytools`'s `skill-update.js` where it
strengthens this specific loop against being faked.

---

## 0. The AI-native constraint, restated for exactly this scope

Everything below still has to pass the same deletion test as the rest of the build: delete
every model call in this pipeline and **nothing gets written, promoted, or cited** — no
skill file appears, no incident learns anything, silence. The one place this is easy to get
wrong is the *gating* code that decides whether a learned skill gets promoted — it would be
tempting to write `if (confidence > 0.7) promote()`, or its more subtle cousin, tallying
reviewer votes against a majority formula. Both are forbidden here exactly as a domain
threshold is forbidden everywhere else in the build. Every gate function in this plan is only
ever allowed to check **properties an agent already judged and reported as structured output**
(did it search for duplicates? did a reviewing agent weigh the objections and rule PROMOTE or
REJECT?) — never a raw telemetry value, never a numeric domain threshold, and never a vote
count standing in for a judgment. §5 below is the explicit checklist for this.

---

## 1. Design the scenario — realistic, reproducible, genuinely uncovered

The shared hackathon environment is too flaky to guarantee this demo lands live (flags get
reset by other teams mid-test, as already happened this session). So the incident is
constructed with **synthetic evidence shaped exactly like real query responses** — same
service names, same query syntax, same JSON shapes `lgtm.js` actually returns — injected
directly into `evidence.js` via `record()`, the identical mechanism already used successfully
in this session's correlator tests. The pipeline mechanism being exercised is byte-identical
to a live run; only the *source* of the evidence is controlled instead of hoped-for.

**Scenario: Kafka consumer lag**, using the real `kafkaQueueProblems` flag already cataloged
in this environment ("Overloads Kafka queue while simultaneously introducing a consumer side
delay leading to a lag spike"). This is deliberately chosen because:

- It's a real, named fault in the actual target system — not invented.
- **None of the 4 base skills cover it.** `triangulate-signals` (cross-signal checking),
  `check-dependencies-before-blaming-the-symptom` (upstream/downstream), `severity-from-user-
  impact`, and `correlate-with-flag-changes` all apply generically but none tells the agent
  *how to tell producer-surge from consumer-stall* — the one thing that actually matters for
  triaging this fault correctly and fast.
- It was literally the running example used when the skill *format* was first designed
  earlier in this build (`kafka-consumer-lag-triage`) — so this closes a loop that was
  anticipated but never actually exercised.

Constructed evidence for pass 1 (`ev_*` records via `evidence.record`):
- A log line showing consumer group lag climbing steadily across three sweeps.
- A metric-shaped payload showing producer throughput flat/normal (ruling out producer surge).
- A trace showing a consumer-side span with elevated processing latency (supporting
  consumer-stall, not producer-surge).
- A flag-state snapshot showing `kafkaQueueProblems` flipped `off → on` shortly before.

---

## 2. Pass 1 — DECLARE, using the existing (unmodified) triage + correlator

Run `agents/triage.js` against this evidence exactly as built and validated earlier this
session — no changes needed here, it's already proven to raise evidenced alerts correctly.
Expected output: an alert citing the lag trend, the flag correlation, and an *unconfirmed*
hypothesis about consumer-side stalling (since no skill yet tells it this is the discriminator
to look for — it has to work this out from first principles, which is the whole point: this
run has to be visibly harder than the second one).

Then `agents/correlator.js` DECLAREs the incident, same as validated. Then a resolution pass
with fresh "lag returned to baseline" evidence, producing RESOLVE with a `revisions[]` entry —
also already proven mechanics.

**Capture**: the full triage transcript (tool calls, reasoning, final alert) as `run1.json`.

---

## 3. The learning step — Harvest → Judge → Refute → Consensus → Gate → Author → Write → Verify

This is the part that has to change, because the current single-agent `skills/author.js` is
exactly what produced two unfalsifiable declines earlier. Port the verified pipeline:

```
HARVEST   one agent reads the resolved incident + its alerts + evidence, proposes
          candidate heuristics as "When <symptom>, <approach>" — placeholders only
          (<SERVICE>, <FLAG_NAME>), never this incident's specific ids.

JUDGE     one agent scores the candidate against four gates, ALL required:
            generalizable / material / not_already_captured (MANDATORY cited search
            over skills/base + skills/learned — an empty search auto-fails this gate)
            / minimal_footprint.

REFUTE    3 independent, blind agents — always run, even when Judge would otherwise
          reject, so the step is always genuinely verifying something rather than
          becoming decoration on the promote path only. Each tries to kill the
          candidate on exactly one named gate, with cited evidence for the kill.

CONSENSUS one more agent, given all three refuters' full verdicts VERBATIM (not a
          count of how many said yes/no) plus the original Judge verdict, decides
          PROMOTE or REJECT by weighing the substance of the objections — a single
          refuter with a concrete citation ("already captured — see file:line, this
          exact heuristic") should outweigh two refuters who raised a vague or
          unsupported concern. No vote is tallied anywhere; this agent reads the
          actual arguments and rules on them, the way an editor weighs reviewer
          comments rather than just counting them.

GATE      pure code, zero model calls, and — deliberately — no arithmetic of any kind:
          promote only if all four Judge gates hold AND the Consensus agent's decision
          is PROMOTE AND a regex scrub finds no incident/alert-id-shaped strings in the
          candidate text. This function's only inputs are agents' own structured
          verdicts — never raw telemetry, and never a vote count either.

AUTHOR    one agent writes the exact skill file (frontmatter + body) for the promoted
          candidate only. It does not re-decide whether to write.

WRITE     file written to skills/learned/. A separate step re-reads it through the
          existing skills/loader.js and confirms it parses correctly.

VERIFY    if the round-trip fails, or the name collides with an existing skill, DELETE
          the file — never leave a bad write on disk.
```

**Capture**: the full Harvest→Judge→Refute→Consensus→Gate trail as `learning-trail.json` —
every candidate's text, the judge's four gate results, every refuter's verdict and citation,
the consensus agent's reasoning and stated deciding factor, and the final promote/skip
decision with its reason.

**Win condition for this step**: a `PROMOTE` verdict with a complete, inspectable trail —
*or* a `SKIP`/`REJECT` naming the specific failed gate, or quoting the consensus agent's
deciding factor. Either outcome is now defensible to a judge; a bare unexplained decline
(last session's result) is no longer a valid output shape from this pipeline at all, and
neither is "2 of 3 objected" as a reason on its own — the deciding factor must always be a
substantive citation, never a count.

---

## 4. Pass 2 — the re-trigger, and the actual diff

Re-run the identical Kafka-lag scenario (same evidence shapes, fresh `ev_*` records so it's
not literally cached) through `agents/triage.js` unmodified, but now `skills/loader.js` has
the new skill available.

**Capture**: `run2.json`, same shape as `run1.json`.

**Diff `run1.json` against `run2.json` on these specific axes** — this is the actual proof,
not a vibe:

| Axis | Pass 1 (expected) | Pass 2 (win condition) |
|---|---|---|
| Cites the new skill | n/a — doesn't exist yet | `skills_applied` includes it by name |
| Tool-call count | higher — has to work out the discriminator from scratch | measurably lower |
| Hypothesis confidence | tentative, hedged language | direct, names producer-surge vs consumer-stall immediately |
| Disconfirming checks | broad, exploratory | targeted at exactly what the skill says to check |

If pass 2 doesn't clear at least the first two rows, this whole exercise is a failure and
should be reported as such — not spun. The plan's job is to make the outcome *checkable*, not
to guarantee it looks good.

---

## 5. The AI-native checklist for every gate function written in this plan

Before any gate function ships, run this test on it — same standard as the rest of the build:

- [ ] Does it reference `errorRate`, `latency`, a metric value, or any raw telemetry number
      directly? → If yes, it's a smuggled threshold. Forbidden.
- [ ] Does it only reference fields an agent already reported as structured JSON (`judgment.
      generalizable`, `refuted`, a regex match against agent-*authored text*)? → Required.
- [ ] Could deleting every model call in this pipeline still produce a promoted skill? → Must
      be no. If a skill can appear without any agent judgment behind it, the pipeline has
      failed the deletion test.
- [ ] Does the `confidence` field anywhere in this pipeline gate an action (`if confidence >
      X`)? → Forbidden per the main plan's existing rule; it stays informational only here too.
- [ ] Does any accept/reject decision use a vote count, a majority formula, or any other
      arithmetic over agent outputs (`refuteCount >= majority`, etc.)? → Forbidden. This was
      the one gap found in an earlier draft of this plan and deliberately closed: REFUTE's
      three verdicts are read and weighed by a Consensus agent (§3), never tallied by code.
      The only thing code checks about the Consensus step is that its output parsed and its
      `decision` field is a valid enum value — never how many refuters said what.
- [ ] Does REFUTE ever get skipped because Judge already looked like it would reject? → It
      must not. REFUTE always runs, so it's always a genuine check, never decoration that only
      exists on the path that was going to succeed anyway.

---

## 6. Artifacts this plan produces (the actual deliverable)

1. `run1.json` — first triage pass, no skill available yet.
2. `learning-trail.json` — full Harvest→Judge→Refute→Consensus→Gate decision trail.
3. The skill file itself (or the documented rejection reason, if it doesn't promote).
4. `run2.json` — second triage pass, skill available.
5. A short diff summary against the table in §4.

These five artifacts together are the entire proof. Nothing in this plan is complete until all
five exist and the diff in §4 has been honestly reported — including if it fails.

## 7. Order of work

1. Build the pure gate functions that remain — `scrubIncidentIdentifiers`, duplicate-search
   non-emptiness, and the final `promotionGate` (now just an AND of Judge's four booleans +
   the Consensus agent's `decision === "PROMOTE"`, no arithmetic) — and unit-test them with
   hand-built fixtures — zero API calls, zero rate-limit risk, do this first.
2. Rebuild `skills/author.js` as the eight-stage pipeline in §3 (Harvest → Judge → Refute →
   Consensus → Gate → Author → Write → Verify), reusing the existing `agents/investigative-
   tools.js` for the Judge step's duplicate search.
3. Construct the Kafka-lag synthetic evidence set exactly as described in §1.
4. Run pass 1 (§2), capture `run1.json`.
5. Run the learning pipeline (§3), capture `learning-trail.json` and the resulting skill file
   or rejection reason.
6. Run pass 2 (§4), capture `run2.json`, produce the diff.
7. Report the outcome honestly against the win conditions in §4 — this is the number that
   actually moves Malleability, not a claim that it does.
