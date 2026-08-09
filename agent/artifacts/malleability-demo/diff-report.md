# Malleability demo — diff report (2026-08-09, superseded)

> **Historical. This is the record of an early, failed attempt, kept because deleting a
> failed result would be dishonest — but it is no longer the current state of this project's
> learning loop, and should not be read as one.**
>
> What it proved at the time: the *promotion* pipeline worked (harvest → judge → 3 blind
> refuters → consensus → gate → write), and one skill was correctly promoted. What it failed
> to prove: that the promoted skill was then *used*. Pass 2 did not cite it.
>
> Root cause, diagnosed afterwards: `times_applied` had no writer anywhere in the codebase —
> `author.js` wrote the literal `0`, `loader.js` read it, and six `SKILL.md` files *instructed*
> the model to increment it, but no code ever did. There was no mechanism by which application
> could be recorded, so it could not be demonstrated.
>
> What supersedes it: `agent/src/skills/loader.js`'s `recordApplication()` and the tracked
> `applications.jsonl` provenance log, plus the committed baselines and applied correction
> under `sre-engineer/`. See `sre-engineer/learning-ledger.md` for the current state.

Skill promoted: YES — `monitor-kafka-consumergroup-recovery`


| Axis | Pass 1 | Pass 2 | Result |
|---|---|---|---|
| Cites the new skill | n/a — doesn't exist yet | NO | NOT CLEARED |
| Tool-call count | 11 | 10 (delta: -1) | CLEARED |
| Hypothesis confidence | already direct | still hedged | NOT CLEARED |
| Disconfirming checks | 0 check(s) (broad) | 0 check(s) | manual review |

**Win condition (first two rows must clear): NOT MET.**
This run did not clear the stated win condition. Reporting honestly per the plan's own instruction not to spin a failure.