# Base root-cause heuristics (origin: base — hand-written, not learned)

## The deepest span that fails on its own is the origin

A trace shows failure propagating upward: `frontend-proxy` 500 because `frontend` 500 because
`product-catalog` returned INTERNAL. Only the last of those failed on its own — the other two
did exactly what they should when a dependency breaks. Read the span statuses from the bottom
of the tree up, and stop at the first one whose error is its own rather than inherited. Then
check that service's dependencies too, because "deepest in this trace" and "deepest that
exists" are not the same claim.

## Silence in one signal is a fact about that signal

Several services in this deployment fail hard while emitting no ERROR-level log lines at all —
a real run found `product-catalog`, `recommendation` and `checkout` all returning zero ERROR
streams during an active, heavily-failing window, with the fault visible only in trace spans.
An investigation that concludes "logs are clean, so this service is fine" has learned nothing
about the service. Pivot signals rather than concluding from an absence.

## A flag's description is a hypothesis, its target's error text is evidence

flagd here answers `/status/<flag>` with the flag's static `defaultVariant` and description,
not its live value — so a flag named `productCatalogFailure` sitting next to a failing product
catalog is suggestive and nothing more. The evidence that closes it is the target service's
own span or log text naming the flag. Cite that, not the flag list.

## Cause precedes effect, and the ordering is checkable

Memory climbing before latency rises is a leak causing slowness. Memory climbing after is a
service backing up because something downstream got slow. Same two metrics, opposite stories,
and a range query with a step small enough to see the order distinguishes them. Whenever two
signals move together, establish which moved first before deciding which caused which.

## Fleet-wide is not per-service

If every service's CPU rose together, the story is the host or the node, not any one service.
Before attributing a resource signal to the service you are investigating, check whether its
neighbours show the same shift in the same window. A per-service incident declared on a
fleet-wide trend sends someone to read the wrong code.

## An RCA with nothing ruled out has not been tested

The section that makes a root cause trustworthy is not the evidence for it — it is the list of
alternatives that were considered and what specifically killed each one. If that list is
empty, the conclusion was reached by the first plausible story rather than by elimination, and
it should be labelled low confidence regardless of how good the supporting evidence looks.
