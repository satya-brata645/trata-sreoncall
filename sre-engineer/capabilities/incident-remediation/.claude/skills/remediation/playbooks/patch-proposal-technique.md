# Base fix-proposal heuristics (origin: base — hand-written, not learned)

## Minimal, not clever

A fix scoped exactly to the verified cause is easier to review, easier to reason about, and
less likely to hide a second problem inside a "while I'm in here" rewrite. Resist the urge to
also refactor, rename, or "improve" adjacent code in the same diff.

## Fix the cause, don't hide the symptom

An error being caught and silently ignored is not a fix — it's the same failure with the
evidence removed. A real fix changes the condition that produced the failure, or handles it in
a way a future incident can still be observed if it recurs.

## Preserve configurability, don't hardcode around it

If the root cause involves a flag, threshold, or setting, the fix should respect that it's
meant to be configurable — hardcoding a specific value to make today's case pass is a new,
narrower bug waiting for the next configuration.

## A fix that can't be explained in one paragraph is probably not minimal

If the rationale needs several paragraphs of justification for why this large a change was
necessary, reconsider whether a smaller change would address the same verified cause.
