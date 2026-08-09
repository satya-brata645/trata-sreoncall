# Trata — DOS: engineering documentation

This is the reference documentation for the repository: what each subsystem
is, what it guarantees, and *why it is built the way it is*. The root
`README.md` is the product argument; this is the manual.

The code in this repository is unusually heavily commented, and those comments
are the primary source. These documents do not repeat them — they give the map
the comments assume you already have, and they record the invariants that span
more than one file, which is exactly what a per-file comment cannot say.

## Read in this order

| | | |
|---|---|---|
| 1 | [Architecture](architecture.md) | The two agents, the three planes, the process model, and how a signal becomes a spoken sentence. **Start here.** |
| 2 | [The desktop](desktop.md) | Window manager, registry, geometry, the derived file system, dock and Spotlight. |
| 3 | [Agent control](agent-control.md) | The protocol the model sees: snapshot, handles, epoch, verbs, modes, the planner/executor split, the audit record. |
| 4 | [The live agent](live-agent.md) | `/api/agent`: two lanes, tool sets, SSE framing, history, deferral, debugging. |
| 5 | [Voice](voice.md) | Microphone ownership, wake word, barge-in, spoken approval, TTS, speaking first. |
| 6 | [The proactive loop](proactive-loop.md) | Events, salience, the heartbeat, the three gates, memory tiers, the Brain derivation. |
| 7 | [Storage](storage.md) | `.data/`, `artifacts/`, append-only NDJSON, dedupe, builds, schedules, the backend seam. |
| 8 | [Dashboards (disco)](dashboards.md) | Spec, profiler, recommender, layout solver, size contracts, controls, the patch protocol. |
| 9 | [HTTP API](http-api.md) | Every route: method, shape, auth, failure modes. |
| 10 | [Configuration](configuration.md) | Every environment variable, what reads it, and what happens when it is unset. |
| 11 | [The SRE side](sre-engineer.md) | The Claude-native shift engineer and the Node signal agent that feed this one. |
| 12 | [Security](security.md) | Threat model, prompt-injection fencing, the consent boundary, secrets, and what is honestly not built. |
| 13 | [Testing](testing.md) | What the 541 assertions actually prove, and what they deliberately do not. |
| 14 | [Operations](operations.md) | Running it, deploying it, the failure modes and what each looks like. |
| 15 | [Contributing](contributing.md) | Recipes: add an app, add a verb, add a block, land a backend endpoint. Plus the design system and the conventions. |

## Scope: which tree this describes

These documents were written against the working tree of
`codex/sreoncall-colored-run-outputs`, which is **ahead of `main` in one
subsystem**. The following exist on that branch and are **not on `main` yet**:

| Not yet on `main` | What it is |
|---|---|
| `app/api/voice/route.ts` | The spoken-summary + ElevenLabs synthesis route |
| `lib/voice/spoken-summary.ts`, `agent-playback.ts`, `pcm-player.ts` | The hosted-TTS half of the voice pipeline |
| `lib/voice/__tests__/spokenSummary.test.ts` | Its test |
| `lib/os/useSummonAgent.ts` | The summon box's own conversation runner |
| `scripts/import-sre-engineer-runs.ts` (`npm run import:sre-runs`) | Importing recorded SRE shifts as dashboard runs |
| `packages/trata-mcp/` | The MCP server package and its three test files |
| `sre-engineer/capabilities/professional-bestpractices/` | The tabletop-rehearsal capability |

Everywhere one of these is described, the surrounding section carries a
**Not yet on `main`** marker. On `main` today the voice pipeline speaks through
the browser's own `speechSynthesis` (`lib/voice/browser-playback.ts`), which is
documented as the fallback path and is currently the only path. Delete these
markers when the branch lands; do not delete the sections.

## Conventions used throughout

**"Live" vs "fixture."** A subsystem is *live* when it reads or writes real
state — a model, the disk, the microphone. It is *fixture* when it resolves
from `lib/mock/`. The boundary is enumerated once, in the root `README.md`, and
each document repeats only the part relevant to it. Nothing in these documents
describes a fixture as if it were live.

**Pure vs impure.** A module described as *pure* has no React, no DOM, no
`fetch`, no filesystem and no ambient clock — a time-dependent one takes `now`
as an argument. This is not stylistic: it is the property that makes the
awkward parts (idempotency, mode refusals, decay, layout) testable in
`node --test` with no browser, and every such module has a test file.

**Referenced but absent.** Several comments cite `docs/os-agent-control.md` and
`docs/os-agent-control-requirements.md` with numbered requirements (`SEC-5`,
`UX-21`, `NFR-11`, `D3`). Those live in the upstream MCS repository
(`transilience/local/mcs`, branch `feat/sos2-proposal`) from which the OS layer
was ported, and are **not** in this repository. [Agent control](agent-control.md)
is the local standalone replacement; where a requirement id is load-bearing it
is restated there in full so no reader has to go and find it.
