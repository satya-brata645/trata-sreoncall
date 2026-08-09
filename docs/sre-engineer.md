# The SRE side

Two producers feed the desktop, and neither one is the desktop. `sre-engineer/` is a
Claude-native shift engineer that runs a whole on-call shift end to end — detect, correlate,
root-cause, fix, merge, report. `agent/` is a Node + OpenAI service that runs the
detect-and-triage half of that shift continuously and stops there on purpose. They share a
target system (the OpenTelemetry Demo app on the shared hackathon LGTM stack), a set of
values, and exactly one seam to the manager agent: `POST /api/events`.

This documents the producer plane. For what happens after an event lands, see
[`architecture.md`](architecture.md); for the ingest schema and the gates behind it, see
[`proactive-loop.md`](proactive-loop.md).

---

# Part 1 — `sre-engineer`: the Claude-native shift engineer

## What it is

Not a bundle of scripts wired together. **One engineer** whose competence is organized into
**six** owned capabilities, each owning its own accumulated knowledge
(`playbooks/`, `experiences/`), all sharing one identity (`personality.md`) and one shift
sequence (`sre-engineer/CLAUDE.md`). Invoked non-interactively, once per shift, via `run.sh`.

| Capability | Skill(s) | Home |
|---|---|---|
| log-triage | `log-triage` | `capabilities/log-triage/` |
| alert-grouping | `alert-grouping` | `capabilities/alert-grouping/` |
| on-call-paging | `on-call-paging` | `capabilities/on-call-paging/` |
| root-cause-analysis | `rca` | `capabilities/root-cause-analysis/` |
| incident-remediation | `remediation`, `release-approval` | `capabilities/incident-remediation/` |
| reporting | `reporting` | `capabilities/reporting/` |

`sre-engineer/.claude/skills/*` are symlinks into those real homes, so the coordinator can
invoke a skill by name while the knowledge stays with the capability that earned it
(`on-call-paging` has no top-level symlink — `run.sh` invokes it by path like the rest). Every
capability reads `personality.md` before acting. That file is authored, not learned, and
does not change per shift — *"a person has to actually decide what they stand for before
they can find out whether they lived up to it."* Different competence, same person
underneath.

## The gate, before anything else

> Delete every reasoning step in this session and nothing should come out — no alert, no
> incident, no root cause, no fix, no merge, no report, no learned playbook entry.

That is the acceptance test for the whole system, stated at the top of `CLAUDE.md` rather
than buried in a section on quality. Its enforcement clause is the sharp part: **if any step
ever becomes a fixed rule instead of reasoning — a threshold, a keyword list, a grouping
rule, a severity→remediation lookup, a vote count standing in for a judgment — that step has
FAILED and must be redone as reasoning.**

Each skill restates it in its own terms. `log-triage`: *"if you ever catch yourself writing
`if errorRate > X` logic instead of reasoning about it, stop."* `alert-grouping`: no
"same service within N minutes" rule, no fingerprint-hash dedup, ever. `rca`: no fixed
taxonomy, no "service X usually means cause Y" lookup. `remediation`: decide the fix *type*
by reasoning, never a lookup table.

## No human in the loop, and what replaces one

There is no human anywhere in this loop. Every judgment is this engineer's own. Where a
consequential, irreversible action needs a check before it happens (a merge), the check is a
second, **independent AI voice — never a person, and never the same voice that made the first
call.** `personality.md` argues why this is a value rather than a limitation: *"a single pass
of reasoning, even careful reasoning, misses things that a fresh, unbiased second look
catches… That split isn't bureaucracy. It's the same reason a surgeon has someone else count
the instruments."*

The pattern appears three times, at three stakes:

| Where | First voice | Independent second |
|---|---|---|
| `rca`'s verify step | the investigator naming a file + function | a blind sub-agent re-fetching that file from the real repo; `verified: false` if it can't confirm |
| `remediation`'s second opinion | the author of the diff | a blind sub-agent given only the diff + RCA, never the rationale |
| `release-approval` | `remediation` — a whole separate process | the only skill with `gh pr merge` authority, re-deriving all four checks itself |

## The shift sequence

```
log-triage                             (reads corrections → sweeps → EVALUATES against its own
                                         baselines, writing evaluation.md → alerts → revises
                                         baselines → writes experience)
  → alert-grouping                     (ALWAYS, even if log-triage raised nothing)
    → for each OPEN incident (declared or escalated):
        on-call-paging                 (BEFORE rca, on purpose — see below)
        root-cause-analysis            (SKIP if an rca exists AND nothing was revised since)
          → remediation                (ONLY if rca.verified == true, not yet remediated)
            → release-approval         (IF remediation opened a PR, or one is still open)
→ reporting                            (ALWAYS, LAST, UNCONDITIONALLY)
```

- **`alert-grouping` always runs**, even on zero alerts — resolving an incident is its job
  too, and silence is not evidence of recovery.
- **`on-call-paging` runs BEFORE root-cause-analysis, deliberately.** `CLAUDE.md` gives the
  reason: *"urgency is a function of user impact, already known from alert-grouping's
  incident, not of root cause, which isn't known yet."* Waiting for a cause before deciding
  whether to wake someone would make the page late for exactly the incidents where it matters
  most. It is also **re-evaluated every shift**, so it can escalate or stand down as the
  incident's own state changes.
- **RCA is skipped** when an rca exists and nothing has been revised since, because
  *"re-running an unchanged incident produces churn, not insight, not a genuine
  re-investigation."* A second pass over identical evidence yields a fresh-looking
  paragraph, not a new conclusion.
- **`remediation` is hard-gated on `rca.verified == true`** — *"a hard block, not a
  suggestion."* You do not propose a fix for a cause nobody has confirmed is real.
- **`release-approval` runs whenever a PR is open**, including one left open by an earlier
  shift.
- **`reporting` always runs, last, unconditionally.** *"Nothing in this sequence is allowed
  to be silently skipped because there was 'nothing to report.'"*

## The capabilities

**log-triage — noticing problems nobody asked it to look for.** Its turn is a full loop: read
`corrections/log-triage/` first (anything `status: open` is someone saying it got something
wrong — apply and cite, or dispute with reasons, never ignore silently); sweep raw and
unfiltered across the whole stack (`{service_name=~".+"}`, flagd `/list`, whatever RED metrics
exist); **evaluate against its own `baselines/<service>.md`** and write
`$OUTPUT_DIR/evaluation.md` — one entry per service swept, each stating *matches baseline /
deviates / no baseline yet* with the literal values compared; hypothesize and try to break it;
raise alerts; then revise any baseline this shift proved wrong and write an experience. Writes
`alerts/alert-NNN.json` (headline, severity + `severity_reasoning`, hypothesis, confidence,
`disconfirming_checks`, verbatim `evidence[]`) and a reasoning line per step to
`logs/log-triage.jsonl`. `evaluation.md` is a required artifact of **every** shift, including a
quiet one — an incident that later opens should be traceable back to an entry in it, so a
reader can see what the engineer believed normal was at the moment it decided. **Never**
paraphrases evidence, never argues severity from the size of a number, and never suggests
muting, filtering or narrowing telemetry — *"that is blinding yourself, not fixing anything,
and is an automatic violation regardless of how it's framed."* Zero alerts is a valid, often
correct outcome, and a service with no baseline yet is a first-class early outcome, not a gap
to paper over.

**alert-grouping — deciding what a set of symptoms means, together.** Owns the incident
picture; chooses exactly one of `DECLARE / ATTACH / MERGE / SPLIT / RESEVERITY / RESOLVE /
ESCALATE / NOOP` and *acts* on it — describing the decision in prose without writing the file
"has no effect and does not count." Writes `incidents/incident-NNN.json` with a `revisions[]`
trail (previously believed → new evidence → now believes → why changed) and rewrites
`incident-picture.md` completely every run, max 40 lines. **Never** resolves because alerts
stopped arriving — only on positive recovery evidence it fetched itself — and never dedups by
fingerprint or groups by time window. `ESCALATE` is a *successful* outcome.

**on-call-paging — deciding whether this is worth waking someone for.** The one competence the
rest of the pipeline doesn't have: whether this specific incident, right now, justifies
interrupting a specific human's night — and if so which human, and what happens if they don't
respond. Re-derives severity and blast radius from the incident's own evidence rather than
trusting alert-grouping's label, reads `config/oncall-roster.json` (fixture data: which team
owns which services, primary/secondary, escalation policy, business hours), and checks the real
current time by running `date -u` and `date` itself rather than assuming. Chooses one of
`PAGE_NOW / PAGE_BUSINESS_HOURS / NO_PAGE / STAND_DOWN / ESCALATE_PAGE` and merges a `paging`
object into the incident's own JSON — decision, `decided_at`, `urgency_reasoning`, `target`
(team, user, role, `why_this_person`), `informed_not_paged`, `escalation_plan`, `channels`, and
a `revisions[]` trail — plus a line per decision to `logs/on-call-paging.jsonl`. The roster is
ground truth for *who exists and who's up next*; it is explicitly **not** ground truth for
whether the incident deserves a page at all. Time of day is *"an input to urgency, not an
excuse"*: `PAGE_NOW` at 3am for confirmed checkout failure is correct and business hours do not
override it, and daytime does not inflate urgency because paging "feels free." **Never**
invents a notification side effect — there is no pager integration here, so it says what it
*would* send and to whom and never claims it was sent; never lets escalation timing substitute
for its own judgment about whether to page; never narrows the roster, mutes a channel or skips
escalation to quiet a noisy incident. A `NO_PAGE` that later proves wrong earns a revision
entry, *"not something to quietly correct without saying what changed."*

**root-cause-analysis — understanding why, for real.** Goes past what triage had, pulls
targeted evidence itself, and when the trail points at code reads the actual code — listing
`repos/open-telemetry/opentelemetry-demo/contents/src` fresh each time rather than assuming a
service-name-to-path mapping. Writes the `rca` object into the incident JSON: `root_cause`,
`confidence`, `verified`, `verify_detail`, `implicated_file`, `implicated_function`,
`evidence_refs`. **Never** concludes "code bug" without having read the implicated code, never
skips the verify step. *"'No code fix needed' is a complete and correct answer when that's the
truth."*

**incident-remediation / remediation — turning a cause into a concrete fix.** Picks
`code_fix`, `config_proposal` or `deferred` by reasoning. Writes a genuine minimal diff, keeps
a local copy in `remediations/<incident-id>/`, gets a blind second opinion, then opens a PR
against the team's own repo (read from `.hackathon-team.json`, never hardcoded) from a
**throwaway clone outside the live working tree**. **Never** runs `gh pr merge` or pushes to
`main`/`master`. A flagged diff gets one revision attempt; flagged again it becomes `deferred`
rather than being opened anyway. It preserves a distinction the report layer must not blur:
`pr_url: null` **with** a `pr_error` means a real reviewed fix exists and only transport
failed; `type: "deferred"` means no safe change could be proposed.

**incident-remediation / release-approval — the only merge authority.** Blind to
`remediation`'s rationale by construction: given only the diff, the verified RCA and the
second-opinion verdict. Re-derives four checks from primary sources — re-fetch the real
implicated file itself, confirm the diff is minimal and scoped, confirm no reckless pattern
(swallowed errors, removed safety checks, hardcoded config), confirm syntactic validity.
**Never** rubber-stamps — *"do not just check whether the second opinion said yes; that would
make you decoration, not a check"* — never pushes directly, never touches flagd. Not approving
is first-class: the PR stays open with a specific written objection.

**reporting — telling the truth about what happened.** Runs last, every shift: the "labor
delivered" artifact. Writes `shift-report.md` always, plus `postmortems/postmortem-<id>.md`
for anything resolved, remediated or merged. Only the postmortem's section *headings* are
fixed. **Never** states a fact that doesn't trace to something another capability actually
wrote this session, and never pads: *"A quiet shift with nothing to report is a fine report.
Say so in two lines and stop — padding it to look busy is the same dishonesty as fabricating a
finding."*

## `run.sh` — one shift is a sequence of separate processes

This is the architectural point the rest of the design rests on. **A shift is not one long
Claude session invoking skills internally.** It is a sequence of separate `claude -p`
processes, one per capability turn, each `cd`'d into its own capability folder so it
discovers only its own `.claude/skills/` and reads only its own tiny `CLAUDE.md`.

```
run.sh
  ├─ mkdir outputs/<YYMMDD_hhmmss>/{alerts,incidents,logs,postmortems}
  ├─ carry forward every non-resolved incident from the previous run
  ├─ claude -p (cwd capabilities/log-triage)             → logs/log-triage.session.jsonl
  ├─ claude -p (cwd capabilities/alert-grouping)         → logs/alert-grouping.session.jsonl
  ├─ per open incident:
  │    claude -p (cwd capabilities/on-call-paging)       → logs/on-call-paging_<id>.session.jsonl
  │    claude -p (cwd capabilities/root-cause-analysis)  → logs/rca_<id>.session.jsonl
  │    claude -p (cwd capabilities/incident-remediation) → logs/remediation_<id>.session.jsonl
  │    claude -p (cwd capabilities/incident-remediation) → logs/release-approval_<id>.session.jsonl
  ├─ claude -p (cwd capabilities/reporting)
  └─ post-hoc guardrail check per log, then concat → logs/session.jsonl
```

The file's header says why, and it is a claim a single-session design cannot make:

> it means release-approval and RCA's verify step are structurally blind to the agent that
> made the first call (separate process, zero shared context), not just blind because a
> prompt told them to pretend — and it means each capability's `--disallowedTools`
> restriction is real process isolation, not an in-session convention that could leak.

`release-approval` cannot see `remediation`'s rationale because it is a different process
with a fresh context, not because it was asked not to peek — it said so itself in one run:
*"I did not read its `rationale.md` — this skill is blind to the author's own reasoning by
design."* And `remediation`'s turn launches with `Bash(gh pr merge*)` denied; in one session
that is a convention a model could talk itself past, across processes the command is simply
not in that turn's surface.

**State passes ONLY through `$OUTPUT_DIR` files** — the files every capability already reads
and writes independently by design. No shared memory, no passed conversation, no hidden
channel.

## The guardrails, both layers

**Layer 1 — the baseline denylist every capability gets, regardless of role:**

```bash
BASE_DENY="Bash(git push*main*),Bash(git push*master*),Bash(curl*4001/toggle*),Bash(curl*-X POST*4001*)"
```

No direct push to `main`/`master`, no flagd `/toggle`, no POST to `:4001` at all. Per
capability, `remediation` gets `BASE_DENY` **plus** `Bash(gh pr merge*)`; `release-approval`
gets `BASE_DENY` only — the single turn in the project where `gh pr merge` is reachable.

**Layer 2 — the post-hoc hard gate.** Each invocation writes its own
`logs/<label>.session.jsonl`, and the check greps *that* file — never one merged log:

> Each entry in `INVOCATION_LOGS` names exactly which capability turn produced it, so a
> violation is never guessed from adjacency — it's checked against the one file that turn
> actually wrote.

It looks for `gh pr merge` (expected only under a `release-approval:*` label),
`git push … (main|master)`, and `4001/toggle/<flag>/(on|off)`. Any hit outside its allowed
turn prints `GUARDRAIL VIOLATION` and the shift exits non-zero. Only afterwards are the
per-invocation files concatenated into the `logs/session.jsonl` deliverable.

## The hard rules, verbatim

From `sre-engineer/CLAUDE.md` — *"mechanical (see `run.sh`), not just stated here"*:

- Only `incident-remediation/release-approval` may ever run `gh pr merge`, and only after its
  own independent re-review. `remediation` and every other capability must never merge a PR.
- No capability may push to `main`/`master` directly, ever.
- No capability may call flagd's `/toggle` — this project is read-only on the real target
  system's fault-injection state, always.
- No capability may deploy to, or otherwise write to, the real
  `open-telemetry/opentelemetry-demo` app — reading its source for RCA/remediation is the
  only interaction with it, always.
- A capability's own upskilling may only write to its own `playbooks/`/`experiences/` — never
  another capability's folder.
- Nothing may gate on a `times_applied` or `confidence` value — not skipping a baseline, not
  distrusting a playbook, not retiring an experience. They are informational only. A rule like
  "ignore baselines with confidence: low" is a threshold deciding behavior, which is exactly
  what the gate above forbids, however reasonable it sounds.

Plus one environmental rule from the same file: **never query `10.10.1.21` — that's real
production**, not the hackathon stack.

## Output layout and the carry-forward rule

```
sre-engineer/
  outputs/<YYMMDD_hhmmss>/
    alerts/       alert-NNN.json          ← log-triage
    incidents/    incident-NNN.json       ← alert-grouping, enriched by rca + remediation
    logs/         <capability>.jsonl      ← reasoning trails (disclosure level 4)
                  <label>.session.jsonl   ← one raw stream-json trace per invocation
                  session.jsonl           ← all of them concatenated
    postmortems/  postmortem-<id>.md      ← reporting
    evaluation.md                         ← log-triage's baseline comparison, EVERY shift
    incident-picture.md                   ← the live headline view
    shift-report.md                       ← the shift deliverable
  remediations/<incident-id>/             ← diffs + rationale, outside any single run
  config/oncall-roster.json               ← on-call-paging's fixture roster
  corrections/<capability>/               ← the inbox where a capability is told it got it wrong
  capabilities/log-triage/.../baselines/  ← what normal looks like, written from real windows
  capabilities/*/.../experiences/         ← one entry per capability per shift of real work
```

Progressive disclosure runs top-down: `incident-picture.md` → `shift-report.md` →
`postmortems/` → `logs/*.jsonl`. Each layer points at the next; none duplicates it.

**Carry-forward.** Every run starts by copying each incident from the most recent prior run
whose `status` is not `resolved`/`closed` into the new run's `incidents/`. The rule:
**an open incident stays open ACROSS SHIFTS until a capability resolves or merges it on real
evidence — never because a new shift started.**

## What it has actually produced

`sre-engineer/outputs/` holds four real shifts and four standalone capability tests:

| Run | What ran | Result |
|---|---|---|
| `20260809_085144` | log-triage, alert-grouping | `alt-001` and `inc-001` (sev2) from live telemetry; `incident-picture.md` written. No RCA turn yet. |
| `20260809_105306` | the full chain | Two incidents, both root-caused and verified; one PR merged; `shift-report.md` + two postmortems. |
| `20260809_122146` | remediation, release-approval, reporting on a carried-forward `inc-001` | Approved on the merits but **not merged** — nothing to merge; produced `remediations/inc-001/` and `PR-PENDING.md`. |
| `20260809_135833` | log-triage, alert-grouping, reporting | A quiet-window shift on a carried-forward `inc-001`; the report states plainly which capabilities did *not* re-run and why. |
| `rca_standalone_test` | `rca` alone, canned incident | Root cause at conf 0.97, `verified: true` via a blind sub-agent that re-fetched the real upstream `main.go` and quoted lines 373-377 and 419-420. |
| `paging_standalone_test` | `on-call-paging` alone | `PAGE_BUSINESS_HOURS`, not `PAGE_NOW`: peak blast radius would have justified waking someone, but the last burst was 5h04m earlier — *"a 30x+ deviation"* from the established 6–10 minute burst cadence. Target derived from the roster by origin service, not by symptom. |
| `release_approval_pr12_test` | `release-approval` alone | Independent re-review against a real PR. |
| `learning_verify_test` | `log-triage` learning path | `evaluation.md` plus `pending-upskilling/{baselines,experiences}` — the durable-memory write path exercised in isolation. |

`E2E-TEST-RESULTS.md` records a further run under an extra safety measure: `main` on the shared
repo had no branch protection and three PRs open, so that shift denied `Bash(gh pr merge*)` for
**every** turn including `release-approval`. The tracked `run.sh` was not modified.

**The shift report** (`outputs/20260809_105306/shift-report.md`) is the shape of a real one.
One anomaly, tracked as **two** incidents — because *"overlap in time is not proof of
relatedness"* and no causal link was found between onsets ~8 minutes apart:

- **inc-001** — `checkProductFailure` in `src/product-catalog/main.go` gates `GetProduct` on
  the `productCatalogFailure` flag and returns gRPC `Internal` before touching the DB. Blast
  radius argued from real numbers: ~47% of checkout attempts and ~38–47% of product-page
  loads at peak. The fix reclassified `codes.Internal` to `codes.Unavailable` — correct
  transient-failure semantics, fault-injection mechanism left fully intact — proposed,
  blind-reviewed and **merged as PR #11** after `release-approval` re-fetched the live source
  itself rather than trusting the diff.
- **inc-002** — the load generator had been dark 65+ minutes because this sandbox's flagd
  evaluates `loadGeneratorTraffic` to `off`, deviating from upstream's shipped `on`. The
  load generator's own code behaves exactly as designed; `implicated_file` and
  `implicated_function` are correctly `null`. There was nothing to patch, so it was
  **correctly LEFT UNFIXED** with a scoped config proposal and a written hand-off: the flag
  write is outside every capability's allowed tool surface, and the incident *"stays open
  until whoever holds live flagd write access outside this project acts on the documented
  proposal."*

Note what the report refuses to claim. inc-001's errors tapered to zero, but traffic also
stopped at that exact instant for an unrelated reason, so recovery is recorded as *"likely,
not confirmed"* and the next-shift note says plainly: **do not resolve inc-001 on continued
silence.**

### `remediations/inc-001/PR-PENDING.md` — the strongest evidence in the repo

The remediation was finished and had passed blind review CLEAN. The push was blocked:

```
git push -u origin remediation/inc-001-product-catalog-1786278957
→ Destructive command detected — confirm before running.
```

The guard needed interactive confirmation; the capability runs unattended. What it did next,
in its own words:

> I did not override the guard: pushing to a shared repository is an outward-facing action,
> and silently disabling a safety check to do it unattended is exactly the kind of thing that
> should require a human, not a workaround. Two differently-shaped attempts hit the same
> guard, so I stopped rather than keep hammering a declined action.

This is the strongest evidence in the repository, and the reason is precise. Every other
artifact demonstrates capability under conditions where the agent was *permitted* to succeed.
This one records the single case where it had the means to get what it wanted — `gh auth
status` authenticated, `viewerPermission: WRITE`, no fork needed, access demonstrably not the
problem — and a guard stood in the way. It stopped, preserved everything (clone path, branch,
commit `02f4299`, fully-written PR body), wrote down exactly what it declined and why, and
left a copy-pasteable path for a human to finish it. It also refused to blur the outcome:
*"This is **not** `type: "deferred"`. A deferred remediation means no safe change could be
proposed. Here a real, reviewed, evidence-backed change exists and is written down in full;
only the delivery mechanism failed."*

Guardrails that hold only when nobody wants to cross them aren't guardrails. This is the
recorded instance of one holding when the agent wanted to cross it — written by the agent
that was stopped.

---

# Part 2 — `agent/`: the Node + OpenAI detect-and-triage loop

## Scope

Detection and triage only. It watches live telemetry unattended, judges what's abnormal
itself, raises evidenced alerts, and decides what constitutes an incident. **RCA,
remediation and PRs are out of scope by design** — this is the detect-and-triage shift
covered by software, not a second attempt at the whole job. Node ≥18, CommonJS, zero
dependencies (bare `fetch`), OpenAI Chat Completions via `src/llm.js` (`gpt-4o` strong /
`gpt-4o-mini` fast by default). `npm start` runs forever, self-paced; `node run.js --once`
runs one cycle.

## The architecture map

```
run.js
 ├─ hooks/attention.js    cheap model glance → worth a look? + self-paced next_check_in_seconds
 ├─ hooks/world-change.js flagd /list poller → diffs flag flips between cycles
 ├─ hooks/lifecycle.js    event bus: incident.declared/.revised/.resolved/.escalated
 ├─ hooks/human.js        inbox for human interjections → agents/human-response.js
 ├─ sensor.js             raw fetch only, zero judgment
 ├─ agents/triage.js      strong model + tools → raises evidenced alerts
 ├─ agents/correlator.js  strong model + tools → declare/attach/merge/split/resolve/escalate
 ├─ skills/author.js      on incident.resolved: writes/revises a learned skill, or declines
 ├─ professional-practice.js  records real skill use; revisits resolved incidents
 ├─ self-accountability.js  performance report + retroactive-miss check
 └─ surface/cli.js        progressive disclosure: headline → alerts → evidence → full trace
```

**`run.js`** — entrypoint and the only scheduler; wires four hooks to two agents, then sleeps
for however long the attention hook said. *"This is where the system stops being a script
someone runs and starts being a service that runs itself."* **No judgment.** Its three
constants are labelled as such: `RETROACTIVE_CHECK_EVERY_N_CYCLES = 5`,
`PRACTICE_REVIEW_EVERY_N_CYCLES = 3`, and a 30s post-error delay, *"an infra safety rail, not
judgment."*

**`hooks/attention.js`** — one cheap/fast model call over a 3-minute sweep answering two
questions: worth waking full triage, and how long until the next glance. **Judgment: entirely
the model's**, including the cadence (below). Prompted to bias toward `worth_a_look=true` when
uncertain — *"a wasted triage pass costs far less than a missed incident."*

**`hooks/world-change.js`** — polls flagd `/list` and diffs against the previous snapshot, the
closest thing to a deploy feed here. **No judgment**: *"Detecting a flip is plumbing (diffing
two snapshots); what it MEANS for an incident is the correlator's judgment, not this file's."*

**`hooks/lifecycle.js`** — a ten-line `EventEmitter`; `skills/author.js` listens for
`incident.resolved`. **No judgment.**

**`hooks/human.js`** — a queue: `ask()` pushes, `drain()` empties, `run.js` hands each message
to `agents/human-response.js`. **No judgment — just the inbox**; the reasoning lives in the
agent it feeds, which sees the real prior tool-call trace so it can answer "why didn't you
check X" honestly instead of inventing a justification after the fact.

**`sensor.js`** — one broad sweep: log volume by service, an uncapped raw log sample across
every service, available metric names, error traces, flag states, each recorded to the
evidence store immediately. **No judgment, emphatically** — *"it never decides what matters,
never filters by severity, and never narrows its own scope based on what it found. Widening
scope is always the agent's call."*

**`agents/triage.js`** — the strong model with the read-only toolset plus one output channel,
`raise_alert`. **All judgment**: is this abnormal, how severe, which evidence supports it —
all inside the model call; the code only wires tools and shapes the transcript. The prompt
requires investigate-then-disconfirm before alerting, forbids paraphrased evidence, argues
severity from user impact, states that zero alerts is often correct, and closes the narration
loophole: *"describing an alert in your text response without calling the tool has no effect
and does not count."*

**`agents/correlator.js`** — the second strong-model call, owning the incident picture via
eight action tools (`declare_incident`, `attach_alert`, `merge_incidents`, `split_incident`,
`reseverity_incident`, `resolve_incident`, `escalate_incident`, `noop`). **All judgment.** Its
400 lines are tool implementations applying what the model decided to `state.js` — *"it
contains no correlation/grouping logic of its own (no `if (sameService && within5min)`,
ever)."* Merge, split, reseverity and resolve each require a full revision entry in their
schema, so silently changing a published story is structurally impossible; `resolve_incident`
requires at least one `recovery_evidence_refs` entry.

**`agents/investigative-tools.js`** — the shared read-only toolset (`query_logs`,
`query_metric`, `query_metric_range`, `search_traces`, `get_trace`, `list_services`,
`get_flag_states`, `load_skill`) used by triage, correlator, human-response and
self-accountability, so LogQL normalization and context trimming only have to be right once.
**No judgment.** Extracted deliberately: the correlator must be able to check for itself
whether evidence changed rather than being limited to what alerts happen to say.
`slimForModel` strips bulky `resources` blobs before they reach the model — *"presentation
trimming, not scope narrowing: the full data is still fetched and still stored, still
reachable via `evidence_ref`."*

**`evidence.js`** — verbatim, content-addressed store (below). **No judgment.**
**`state.js`** — alerts, incidents, a bounded 40-window history, the performance record and
the practice queue, persisted as JSON. **No judgment**: *"this file only persists what the
agents decide."* **`skills/author.js`** — the self-authoring pipeline (below); **judgment,
but never one agent's alone.** **`skills/gates.js`** — pure code, zero model calls, zero raw
telemetry; **no judgment by construction**, since it may only check properties an agent
*already judged and reported as structured output*. **`professional-practice.js`** — follows
resolved incidents forward (below); **the model judges, the code schedules and validates.**

**`self-accountability.js`** — two things. A plain performance report (`sweeps_run`,
`alerts_raised`, `noise_rate`, `avg_detect_to_declare_ms`, skill outcomes) where every number
is a count the agents already produced as a side effect of their own decisions — **no
judgment**. And the retroactive-miss check: **a real model call** that takes the oldest window
already called clean, supplies later windows as hindsight, and asks whether something was
missed. Its header carries the self-blinding warning: *"the report below must never be
improved by narrowing what the agents look at… If that ever seems tempting while extending
this file, that's the self-blinding rule — stop."*

**`surface/cli.js`** — four disclosure levels: headline → alerts + hypothesis + skills applied
→ full verbatim evidence → the raw model-call trace. **No judgment**: *"a record of work
performed, not where the work happens — the agent runs unattended whether or not anyone ever
looks at this."*

## The AI-native claim, and how to verify it

1. **Delete every model call and this produces nothing** — no alerts, no incidents, no
   severity. `sensor.js`, `evidence.js`, `state.js` and `hooks/world-change.js` only fetch,
   store and diff, and each says so in its header.
2. **No thresholds, keyword lists or grouping rules exist in code.** Grep for a comparison
   deciding something or a hardcoded severity map; you won't find one. Severity, correlation,
   resolution and escalation are single model calls each time.
3. **The cadence itself is a judgment.** `next_check_in_seconds` comes from the model every
   cycle, never a constant. The `MIN_CHECK_SECONDS = 5` / `MAX_CHECK_SECONDS = 30 * 60` clamp
   is a scheduler safety rail — never spin, never go silent forever — *"not a judgment about
   the target system"*, and it cannot change what the model concluded.
4. **The one place numbers are pattern-matched is authored text, never telemetry.**
   `gates.js` rejects a proposed skill body that looks like a hardcoded threshold or a fixed
   severity mapping. It inspects what an agent wrote about how to think; it never touches a
   live value.

## `evidence.js` — verbatim, content-addressed, replayable

Every claim traces to the exact query that produced it and the exact raw bytes that came
back, never a paraphrase. `record({kind, query, raw, observedAt})` returns
`ev_<sha256[0:12]>`, hashed over `{kind, query, raw}` — so recording the same query and
response twice returns the same ref instead of duplicating storage. The stored file holds the
literal, unmodified response, *"stored as-is, never summarized here"*; trimming for the
model's context happens elsewhere and never touches what was written.

That is what makes disclosure level 4 real: point at any sentence in an alert, follow its
`evidence_ref`, read the untouched bytes it was built from. `resolve_incident` cannot be
called without such a ref, and `professional-practice.js` re-filters a review's cited refs
against the refs its own tool calls actually returned — a model cannot cite evidence it did
not fetch.

## The self-authoring skill pipeline

`skills/author.js` fires on `incident.resolved`. Five stages, and **no single agent decides
alone**:

```
HARVEST    strong model reflecting on the resolved incident → "When <SYMPTOM>, <APPROACH>"
           candidates with placeholders only, or an empty array (proposing nothing is valid)
  ↓
JUDGE      strong model + the real search_skills tool → four gates: generalizable, material,
           not_already_captured, minimal_footprint. Must search ≥2× with different terms
           before claiming novelty; the duplicate_search trail is attached from the ACTUAL
           tool calls made, not the model's self-transcription
  ↓
REFUTE     3 independent, blind reviewers — ALWAYS run, never short-circuited by Judge.
           Each searches for itself and tries to break exactly ONE gate. "A refuter who
           always finds something isn't independent, just contrarian."
  ↓
CONSENSUS  strong model reads Judge + all three refutations verbatim, plus the real list of
           existing skill names so a fabricated citation is catchable. Must name the ONE
           deciding factor: "'2 of 3 objected' is not an acceptable answer."
  ↓
GATE       pure code (skills/gates.js) — a formal AND of already-decided judgments.
           No vote tally, no telemetry threshold, no arithmetic over opinions.
  ↓
AUTHOR + WRITE/VERIFY   content gate, kebab-case check, collision check, write, then
                        round-trip re-read; a failed round-trip deletes the file
```

Why the split matters: HARVEST is motivated to propose — it just finished an incident and
learned something. JUDGE has to look for reasons *not* to. REFUTE runs blind and always, so
it is a genuine check rather than decoration on the promote path. CONSENSUS is the only stage
that sees everything and is forbidden from resolving disagreement by counting — *"a single
reviewer with a concrete, checkable citation should outweigh two reviewers who raised a vague
or unsupported concern. A unanimous 'looks fine' with no real scrutiny is weaker evidence than
one sharp, well-cited kill."* And GATE, the only place a candidate is actually promoted,
contains no judgment at all: it verifies Judge's four gates came back true, that the novelty
claim is backed by real searches (`hasEvidencedDuplicateSearch` checks ground truth, so a
judge that merely *claims* to have searched is rejected), that a new-file footprint carries a
`no_host_reason`, that the text carries no incident/alert/evidence/trace ids or literal
timestamps, and that Consensus said `PROMOTE`. Anything else is `SKIP` or `REJECT`, with the
failed gate named.

## `professional-practice.js` — following a resolved incident forward

The on-call agent does not ship fixes, so this module never claims that it did. It asks three
questions later, three separate times per resolved incident: **did the observed recovery
hold, did a comparable failure recur, and did the evidence justify a playbook?** The boundary
is stated and held: *"Code schedules reviews, preserves provenance, and validates writes; it
never decides that a recovery held or that two incidents are the same pattern."*

The code queues each resolved incident for `FOLLOW_UP_ITERATIONS = 3` later reviews, runs at
most one per eligible cycle, filters cited `evidence_refs` down to refs its own tool calls
returned, drops recurrence ids that don't name a real incident, rejects a playbook whose name
isn't kebab-case or whose body trips the content gate or whose author changed the approved
name, and deletes any playbook failing round-trip verification. The model decides everything
else: `recovery_status` (`held` / `recurred` / `inconclusive`), whether a genuine repeated
pattern exists, whether a playbook is warranted — under a prompt insisting that *"a later
incident is comparable only when the actual failure shape and evidence support that judgment;
incident titles or service names alone are not enough"*, and that thin evidence means
`inconclusive` *"rather than manufacturing a reassuring answer."*

A related honesty mechanism: `recordSkillApplications` increments a skill's `times_applied`
only when triage **loaded** it (proven by the actual `load_skill` tool call) *and* cited it on
a raised alert — *"this prevents a model from inflating its own record by merely naming a
skill in prose."* The outcome is later overwritten with the review's real verdict rather than
assumed.

## The LGTM trap worth documenting

**Loki labels services as `opentelemetry-demo/<service>`. Mimir and Tempo use the bare name.**
`{service_name="cartservice"}` — the natural form anyone writes, including a model authoring
its own LogQL — silently matches nothing, and an empty result looks exactly like a healthy
service.

Normalization lives in exactly one place, `lgtm.js`'s `normalizeServiceNameSelectors`, which
rewrites exact-match selectors to `service_name=~"(opentelemetry-demo/)?cartservice"`. Regex
selectors (`=~`) are deliberately left untouched: already-deliberate patterns, or already
prefix-agnostic, and rewriting could only corrupt them. *"This is label plumbing, not
judgment: it doesn't decide what's abnormal, it just makes sure 'cartservice' and
'opentelemetry-demo/cartservice' mean the same query, always."*

The same trap is documented on the Claude side, in `log-triage`'s SKILL.md and its
`lgtm-signal-gotchas.md` playbook — which also records that `payment` is Node.js and emits no
`http_server_*`/`rpc_server_*` metrics (empty is a metric-family gap, not health), that
flagd's own `EventStream` spans sit open ~15s and will dominate an unfiltered p99, and that
resource metrics key on `container_name`, not `service_name`. That playbook's header is worth
reading for its own sake: it was ported from someone else's live-tested findings and says so,
and deliberately **excludes** that source's fleet-correlation logic, because a z-score cutoff
computing a "widespread vs isolated" verdict in code *"crosses into a threshold deciding
correlation for you, which is exactly what you must never accept from a source, your own prior
reasoning, or anywhere else."*

Two other live quirks: flagd's real API is `:4001`, not the `:4000` web UI; and this is a
shared environment where other teams toggle the same flags.

---

# Part 3 — the seam

Either producer reaches the desktop the same way, through the one interface between planes:

```
POST /api/events
  content-type: application/json
  x-internal-secret: $SRE_INGEST_SECRET
```

When `SRE_INGEST_SECRET` is unset the ingest response says `unsecured: true` rather than
pretending otherwise — right for a laptop, wrong anywhere else. The body is an `SreEventInput`
(`lib/agent/events.ts`), deliberately narrow:

| Field | Required | Notes |
|---|---|---|
| `source` | yes | which agent is speaking, e.g. `sre-engineer` |
| `kind` | yes | `detection` \| `incident` \| `diagnosis` \| `remediation` \| `resolved` \| `report` |
| `severity` | yes | `critical` \| `high` \| `medium` \| `low` \| `info` |
| `headline` | yes | one line; what the brain reads first and often all it needs |
| `summary` | no | |
| `actionItems` | no | `string[]` |
| `evidence` | no | `{ kind, ref, label? }[]` — **references, never payloads** |
| `confidence` | no | 0–1, never inferred by the receiver |
| `incidentId` / `sessionId` | no | |
| `externalId` | no | the producer's own id, used for dedupe |
| `at` | no | ISO 8601; defaults to arrival |

Two properties are load-bearing. **Evidence is references, never payloads** — *"the value of
'cites a real trace id' is that someone can go and look, and a copied-in log line is a claim
rather than a citation."* And **the id is derived from content**, not random: a producer
retrying a failed POST does not create a second event, and does not have to send an id to get
that.

```bash
curl -X POST localhost:3000/api/events \
  -H 'content-type: application/json' \
  -H "x-internal-secret: $SRE_INGEST_SECRET" \
  -d '{
    "source": "sre-engineer",
    "kind": "diagnosis",
    "severity": "high",
    "confidence": 0.97,
    "incidentId": "inc-001",
    "externalId": "inc-001-rca",
    "headline": "product-catalog GetProduct is gated on the productCatalogFailure flag",
    "summary": "checkProductFailure returns gRPC Internal before reaching the DB; ~47% of checkout attempts failed at peak.",
    "actionItems": ["Reclassify codes.Internal to codes.Unavailable"],
    "evidence": [
      { "kind": "trace", "ref": "a1f39c02bb7e4d51", "label": "failing GetProduct span" },
      { "kind": "pr", "ref": "https://github.com/satya-brata645/trata-sreoncall/pull/11" }
    ]
  }'
```

The producers sit on the far side of a shared secret, never a session. Nothing about the
desktop's behaviour is decided here: validation, salience, the brain call and the cursor all
happen after ingest. The full schema and the three gates an event must pass before it becomes
a spoken sentence are in [`proactive-loop.md`](proactive-loop.md); the plane boundaries are in
[`architecture.md`](architecture.md).
