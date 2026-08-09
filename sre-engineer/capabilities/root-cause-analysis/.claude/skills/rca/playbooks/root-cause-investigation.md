---
name: root-cause-investigation
description: Walking from symptom to origin, and why the absence of a code cause is a complete answer.
origin: base
times_applied: 0
---

# Base root-cause investigation heuristics (origin: base — hand-written, not learned)

## The symptom's location is not the cause's location

The service where an error surfaces is often not where the fault originates. Before
concluding a service is broken, check what it calls and what calls it. A clean trace showing
an error span in service A, immediately downstream of a call into service B, is much stronger
evidence that B is the real cause than A's own logs are.

## A trace's own error message outranks a guess

If a span carries a literal error message or status, that message is direct evidence of
mechanism — use it as the seed of your hypothesis, then verify it against real source, rather
than reasoning from symptoms alone toward a plausible-sounding story.

## Read the code before claiming it's the code

"This is probably a bug in the flag-check logic" is a hypothesis, not a root cause. A root
cause names the actual function, in the actual file, doing the actual thing that produces the
actual symptom. If you cannot point at real code, you have not root-caused a code-level issue
yet — you have a lead.

## Absence of a code cause is a complete answer

Not every incident has a code fix. Capacity, configuration, a genuine upstream dependency
outage, or expected behavior under unusual load are all real root causes. Naming one of these
plainly, with evidence, is exactly as much your job as finding a bug — resist the pull to find
a code-shaped answer when the evidence points somewhere else.
