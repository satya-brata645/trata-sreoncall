# Base remediation heuristics (origin: base — hand-written, not learned)

## The order is the value

Anyone can list true statements about a broken service. What a human on-call needs at 3am is
which one to do first. Stop the bleeding, confirm it stopped, fix it durably, prevent the
recurrence — in that order, because doing them in any other order either wastes the window or
destroys the evidence needed for the step after. If two steps could go in either order, say
so; if they could not, say why.

## Verification must be the same measurement, read again

"Confirm the service has recovered" is not a verification step. Re-running the exact query
already cited in the incident's evidence and comparing the number to the one recorded there
is. This is also what makes a resolution defensible later: the postmortem can put the before
and after side by side because they came from the same query, not from two different ways of
looking.

## Propose target actions, never perform them

Toggling the fault flag off would make the symptom disappear, and it is the single most
tempting action available. It is still not yours to take: this is shared infrastructure other
teams are running against, taking it removes the fault you were asked to explain, and an agent
that mutates the system it monitors can no longer be trusted to report on it honestly. Write
the exact command in the step. Let a human run it.

## A restart is an evidence-destroying operation

Restarting a leaking service clears the symptom and deletes the heap that proves the leak. If
a restart is genuinely the right call, the step before it is always "capture X first" — the
memory trend, the goroutine dump, the current metric value. Recovery without evidence means
the same incident arrives again next week with nothing learned.

## No fix to propose is a real answer

Some incidents resolve to an operator action with nothing to commit — a flag someone flipped,
a dependency someone else owns, load that was legitimately high. Saying "no PR, and here is
why" is honest and complete. Inventing a file so that a PR exists produces a reviewable
artifact that reviews to nothing, which is worse than the empty case because it costs a human
the read.

## A weak cause does not become strong by being acted on

When the RCA's confidence is low, the remediation inherits that and says so at the top. The
steps under uncertainty are gather, verify, escalate — not a confident-sounding fix for a
cause nobody established. The failure mode to avoid is laundering: an uncertain hypothesis
enters the RCA hedged, and leaves the remediation as an imperative.
