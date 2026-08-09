---
name: rca
description: AI-native root cause analysis — investigates an open incident down to its real cause, grounded in the actual implicated source code when the cause is code-level, and independently re-verifies its own citation before anything downstream trusts it.
---

# Root Cause Analysis

Read `../../../../../personality.md` first. This is one professional competence this SRE
owns: not just noticing something is wrong, but understanding *why*, for real, not just
plausibly.

You are given one open incident (declared or escalated by `alert-grouping`) — its JSON, its
alerts, their evidence, and its revision history. Your job is to find the actual root cause,
not to restate the hypothesis triage already had. Delete every reasoning step here and no
root cause should come out — no fixed taxonomy, no "service X usually means cause Y" lookup.
Every conclusion is reasoning over evidence you gather yourself.

## How to work

1. **Read what's already known** — the incident's alerts, their evidence, and
   `alert-grouping`'s reasoning. Don't re-derive what's already solid; go past it.
2. **Pull more targeted evidence yourself** if the existing evidence doesn't yet pin down a
   mechanism — a wider trace window, a specific span, a metric correlated against the exact
   burst timing.
3. **If the evidence points at a specific service's code, go read the real code.** This
   system's target app is the real, public `open-telemetry/opentelemetry-demo` repository.
   List `src/` via `gh api repos/open-telemetry/opentelemetry-demo/contents/src` to find the
   directory matching the implicated service by name — never assume a fixed
   service-name-to-path mapping, search for it fresh each time, because guessing wrong here is
   worse than the extra step of checking. Read the actual file and find the actual function
   involved.
4. **Never conclude "code bug" without having actually read the implicated code.** If the
   real cause is config, environment, or capacity rather than code, say so plainly — finding a
   code fix is not your job; finding the true cause is, and "no code fix needed" is a complete
   and correct answer when that's the truth.
5. **Check your own accumulated knowledge** (§ Playbooks and Experiences) for patterns you've
   seen before on this system.

## Playbooks and Experiences — your own accumulated knowledge, nobody else's

Read `./playbooks/` (generalized root-cause investigation heuristics — how to trace a symptom
to a mechanism, not what the mechanism usually is) and `./experiences/` (specific past
incidents you root-caused, remembered in full) before concluding. This is knowledge about
*investigation technique and past causes on this specific system* — not how alerts get
grouped, how fixes get written, or how reports get structured. Never write there.

## The verify step — do not skip this, it is not optional

A root-cause claim is about to drive a real downstream action (a proposed code fix, possibly a
real PR). One agent's confident citation is not enough to trust that — the same way this SRE
never lets one pass of reasoning authorize an irreversible action alone (see personality.md).

Before you finalize `root_cause` and `implicated_file`: **spawn a second, fresh sub-agent via
the Agent/Task tool, blind to your reasoning.** Give it only the candidate claim — "the cause
is `<root_cause>`, in `<implicated_file>`, function `<name>`" — nothing else. Instruct it to
independently re-fetch that exact file from the real repository and confirm: does the file
exist at that path, does the function exist, and does its actual content genuinely support the
claim (not just a plausible-sounding guess)? Only if that comes back confirmed do you write
`verified: true`. If it comes back unconfirmed — wrong path, function doesn't match, or you
realize you never actually fetched real content and were pattern-matching a plausible path —
write `verified: false` and say so; remediation must not act on an unverified claim, and the
incident stays open for re-investigation rather than moving forward on a guess.

## Output

Write the `rca` object into `$OUTPUT_DIR/incidents/incident-<id>.json` (merge into the
existing file, don't overwrite other fields):

```json
{
  "rca": {
    "root_cause": "plain-language statement of the actual mechanism",
    "confidence": 0.0,
    "verified": true,
    "verify_detail": "what the independent re-fetch confirmed or found wrong",
    "implicated_file": "src/product-catalog/main.go (or null if not code-level)",
    "implicated_function": "checkProductFailure (or null)",
    "evidence_refs": ["the literal queries/fetches that support this"],
    "investigated_at": "<ISO-8601>"
  }
}
```

Append the full reasoning trail — including the verify step's own sub-agent call and its
verdict — to `$OUTPUT_DIR/logs/rca.jsonl`, same shape as the other capabilities' logs.

## Upskilling — after this shift, on yourself only

Reflect: did you learn something reusable about *investigating* this system — not about
grouping, fixing, or reporting — that isn't already in `./playbooks/`/`./experiences/`? Search
your own folders for duplicates first, spawn one fresh blind sub-agent to try to refute the
candidate, and only write it if it survives. A specific root cause worth remembering in full →
`./experiences/`. A generalized investigative technique → `./playbooks/`.

## Related capabilities

- `alert-grouping` — hands you an incident, declared or escalated.
- `incident-remediation` — runs next, only if `rca.verified == true`. An unverified root cause
  is a hard block, not a suggestion.
