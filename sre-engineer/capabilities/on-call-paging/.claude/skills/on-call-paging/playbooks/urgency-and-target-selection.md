---
name: urgency-and-target-selection
description: How to reason about paging urgency from user impact rather than severity labels, and how to pick a specific person rather than a team name.
origin: base
confidence: 0.85
times_applied: 0
---

Two failure modes are equally bad here, and both come from taking a shortcut instead of
reasoning: paging on severity label alone, and paging "the team" instead of a specific person.

**On urgency**: a SEV2 with confirmed checkout failures at 3am deserves PAGE_NOW. A SEV1 that
turns out, on inspection of blast_radius, to be a total outage of a cosmetic feature (say, a
recommendation carousel) does not deserve waking anyone — it deserves PAGE_BUSINESS_HOURS. The
label is alert-grouping's judgment about severity of the *technical* situation; your job is a
different judgment, about *human urgency*, and the two can legitimately disagree. When they
do, say so explicitly rather than silently overriding one with the other.

**On the roster**: `owns_services` tells you which team is responsible for a service, but
"page the commerce team" is not a paging decision — it's an unfinished one. Read the team's
`schedule.layers` and name the actual primary. Only skip to secondary if you have a specific
reason (e.g. the incident already escalated past the primary's timeout on a prior shift).

**On blast radius crossing team boundaries**: when an incident's evidence shows failures in
services owned by two different teams (e.g. a `product-catalog` fault cascading into
`frontend`), resist paging both by default. If a cause is known (RCA has run on a prior shift
for this same incident), page the team that owns the *origin* service and mark the other
team's owner as informed-not-paged. If cause is not yet known, page whichever team owns the
most upstream implicated service you can identify from the evidence, and say plainly that this
is provisional pending root cause.

**On escalation**: this environment cannot observe real human acknowledgement. Do not report
`ESCALATE_PAGE` with false confidence that "they didn't respond" — say instead that the
elapsed time since `decided_at` exceeds the escalation step's `timeout_minutes`, which is the
only signal actually available, and frame the escalation as time-based, not
acknowledgement-based.
