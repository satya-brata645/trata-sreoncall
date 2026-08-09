---
name: self-skilling
description: Verified skill-learning pipeline — Harvest, Judge, blind Refute, Consensus, then a pure-code-equivalent Gate, before anything is written to the shared skill library. No single agent's say-so promotes a skill alone.
---

# Self-Skilling

Invoked by the coordinator (never by `log-triage` or `alert-grouping` directly) after an
incident RESOLVEs. The entire point of this skill is to make "did this incident teach us
something reusable" a **verified, inspectable decision**, not one agent's unaudited guess —
this is the exact failure mode an earlier version of this system had (an agent that
unfalsifiably declined to learn twice, with no way to tell laziness from a genuine "nothing
new").

## The rule this skill exists to enforce

No skill is ever promoted on one agent's word. Every promotion or rejection must be traceable
to: which of the four gates held, what each of three independent reviewers argued, and what
the deciding factor actually was — never a vote count standing in for a judgment, never a
number from telemetry deciding anything here. If you ever find yourself writing "2 of 3
objected, so reject" instead of naming the substance of the objection, you have broken this
skill's one hard rule.

## Pipeline — run every stage as a genuinely fresh sub-agent (via the Agent/Task tool)

Spawn each stage below as its own agent with ONLY the context it needs — do not let one long
conversation accumulate across stages, that both wastes context and lets earlier framing bias
later "independent" judgment.

```
HARVEST    One agent. Given: the resolved incident.json + its alerts. Reflect honestly:
           what would have helped detect or resolve THIS faster, that isn't already covered?
           Propose 0-3 candidates as "When <symptom>, <approach>" — placeholders only
           (<SERVICE>, <FLAG_NAME>, <METRIC_NAME>), never this incident's specific ids.
           Proposing nothing is correct and common; a bad candidate wastes every later stage.

JUDGE      One agent, per candidate. MUST actually search the existing skill library
           (`../log-triage/`, `../alert-grouping/`, and this skill's own `learned/`) for
           duplicates — at least twice, different terms — before ruling on
           not_already_captured. An unsearched novelty claim auto-fails that gate. Score all
           four, all required to promote:
             generalizable / material / not_already_captured / minimal_footprint
           `minimal_footprint` failing a new-file candidate requires naming which existing
           skills were considered and why none could host it.

REFUTE     THREE independent, blind agents — always run, even when Judge would obviously
           reject, so this is never decoration on the promote path only. Each is given ONLY
           the candidate text (not Judge's verdict) and told to try to kill it on exactly one
           named gate, citing concrete evidence (an exact existing skill + quote, if refuting
           on not_already_captured).

CONSENSUS  One agent, given the Judge verdict and all three Refute verdicts VERBATIM. Rules
           PROMOTE or REJECT by weighing the substance of what was argued — a single reviewer
           with a concrete citation should outweigh two reviewers who raised a vague concern.
           State the ONE deciding factor. "Two of three objected" is never an acceptable
           answer on its own.

GATE       Not a model call — a mechanical check you (the orchestrating context) apply
           directly: promote only if all four Judge gates are true AND Consensus said PROMOTE
           AND the candidate text contains no incident-id/alert-id-shaped string (a raw
           identifier is lore about one incident, not a reusable skill). This is a structural
           checklist over already-decided judgments, never a new judgment of your own.

AUTHOR     One agent, only for a PROMOTEd candidate. Writes the exact skill file content —
           frontmatter + body. It does not re-decide whether to write.

WRITE      Write to `learned/<name>.md` (kebab-case) with this frontmatter:
           ---
           name: <name>
           description: <one line — all a future run sees when choosing whether to load it>
           origin: learned
           learned_from: <incident id>
           evidence_refs: [<the alert/evidence this came from>]
           ---
           <body — an investigative heuristic. NEVER a threshold, NEVER a fixed procedure.>

VERIFY     Re-read the file back. If it doesn't parse as valid frontmatter+body, or its name
           collides with an existing skill, DELETE it — never leave a bad write behind.
```

## Output (progressive disclosure)

Write the full trail to `$OUTPUT_DIR/learning-trail.jsonl` — one line per stage, per
candidate, so a judge can follow exactly why something was promoted or skipped:

```json
{"ts":"<ISO-8601>","stage":"harvest|judge|refute|consensus|gate|author|write|verify","candidate_id":"c1","detail":"...","reasoning":"..."}
```

Append a one-line rollup to `$OUTPUT_DIR/incident-picture.md`'s "Learned" section:
`- <skill-name>: <one-line reason it was promoted>` or `- (nothing promoted): <one failed gate or the Consensus deciding factor>` — never a bare, unexplained decline.

## Where learned skills live

`../self-skilling/learned/` — starts empty on a fresh checkout. `log-triage` and
`alert-grouping` both read this directory's skill descriptions before concluding anything
(see their own SKILL.md files' § Skills). This is the mechanism that makes a second run of
the same fault look different — and better — than the first, and it must never be pre-seeded
before a demo; every file in here should trace to a real `learned_from` incident id.
