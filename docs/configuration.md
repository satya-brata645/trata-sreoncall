# Configuration

Every environment variable this app reads, what reads it, and what happens when
it is not set. Nothing here is optional-but-secretly-required: each row states
the unset behaviour, because on a laptop most of these stay unset and the app is
meant to work anyway.

Copy `.env.example` to `.env.local`. That file is gitignored (`.gitignore` lists
`.env`, `.env.local`, `.env.*.local`) and this remote is public.

## Reference

| Variable | Read by | Default when unset | Effect |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | `app/api/agent/route.ts` (`apiHeaders`), `app/api/voice/route.ts` (`anthropicHeaders`) | none | Sent as `x-api-key`. Second in key precedence. |
| `CHAT_ANTHROPIC_API_KEY` | same two | none | Sent as `x-api-key`. **First** in precedence — wins over `ANTHROPIC_API_KEY`. |
| `CLAUDE_OAUTH_TOKEN` | same two | none | Sent as `Authorization: Bearer` with `anthropic-beta: oauth-2025-04-20`. Third in precedence; only consulted when neither API key is set. |
| `CLAUDE_CODE_OAUTH_TOKEN` | same two | none | Same OAuth path. Fourth and last. |
| `ELEVENLABS_API_KEY` | `app/api/voice/route.ts` (`synthesize`) | none | Unset ⇒ `provider: "browser"`, no ElevenLabs call at all. |
| `ELEVENLABS_VOICE_ID` | `app/api/voice/route.ts` | `21m00Tcm4TlvDq8ikWAM` | Voice used in the TTS URL path. |
| `ELEVENLABS_MODEL_ID` | `app/api/voice/route.ts` | `eleven_flash_v2_5` | `model_id` in the TTS body. |
| `ELEVENLABS_STABILITY` | `app/api/voice/route.ts` | `0.45` | `voice_settings.stability`. Non-numeric falls back to the default. |
| `ELEVENLABS_SIMILARITY` | `app/api/voice/route.ts` | `0.75` | `voice_settings.similarity_boost`. |
| `ELEVENLABS_STYLE` | `app/api/voice/route.ts` | `0.25` | `voice_settings.style`. |
| `ELEVENLABS_SPEAKER_BOOST` | `app/api/voice/route.ts` | `true` | `voice_settings.use_speaker_boost`. Only the literal string `false` (any case) turns it off. |
| `DOS_AGENT_MODE_CEILING` | `app/api/agent/route.ts` (`agentModeCeiling`), `app/api/agent/policy/route.ts` | `collab` | Highest mode the workspace permits: `self` or `collab`. Anything else — unset, misspelled, an old `auto` — is `collab`. |
| `SRE_INGEST_SECRET` | `app/api/events/route.ts`, `app/api/heartbeat/route.ts` | none | Expected in the `x-internal-secret` header on both POSTs. Unset ⇒ both routes are open. |
| `TRUNK_HEARTBEAT_LOCAL` | `lib/agent/heartbeat-runner.ts` (`startHeartbeat`) | on | The literal string `0` disables the in-process loop. Any other value, including unset, leaves it running. |
| `TRUNK_HEARTBEAT_LOCAL_SECONDS` | `lib/agent/heartbeat-runner.ts` | `900` | Interval in seconds. `Number(...) || 900`, so `0` and garbage both mean 900. |
| `NEXT_PUBLIC_API_BASE_URL` | `lib/api/client.ts` (`API_BASE_URL`, `USING_FIXTURES`) | `""` — fixtures | Unset ⇒ every `fetchBackend` call resolves from `lib/mock/server.ts`. Set ⇒ the identical calls go to that origin. |
| `NEXT_PUBLIC_APP_ENV` | `lib/os/useFileSystem.ts` | unset ⇒ not production | `=== "production"` sets `isProd` on the customer-output file visibility filter. |
| `NEXT_RUNTIME` | `instrumentation.ts` | set by Next | Next's own. The heartbeat only starts when it is `nodejs`. |
| `DOS_AGENT_DEBUG` | `lib/agent/debug-log.ts` (`agentDebugEnabled`), gating `GET /api/agent/debug` | off | Only the literal string `1` enables it. Anything else ⇒ the route 404s. |

## The model

`ANTHROPIC_API_KEY`, `CHAT_ANTHROPIC_API_KEY`, `CLAUDE_OAUTH_TOKEN`,
`CLAUDE_CODE_OAUTH_TOKEN`.

Both `apiHeaders()` in `app/api/agent/route.ts` and `anthropicHeaders()` in
`app/api/voice/route.ts` resolve credentials in exactly this order:

1. `CHAT_ANTHROPIC_API_KEY`
2. `ANTHROPIC_API_KEY`
3. `CLAUDE_OAUTH_TOKEN`
4. `CLAUDE_CODE_OAUTH_TOKEN`

The first two are the same branch (`CHAT_ANTHROPIC_API_KEY || ANTHROPIC_API_KEY`)
and produce an `x-api-key` header. The last two are the fallback branch
(`CLAUDE_OAUTH_TOKEN || CLAUDE_CODE_OAUTH_TOKEN`) and produce a bearer token plus
`anthropic-beta: oauth-2025-04-20`. **An API key always beats an OAuth token** —
if both are present the OAuth branch is never reached.

These are **server-only**. They are read inside route handlers that declare
`runtime = "nodejs"`, they never reach a bundle, and they must never be renamed
with a `NEXT_PUBLIC_` prefix — that prefix inlines the value into client
JavaScript, which on a public deployment publishes the key.

With none of them set, `apiHeaders()` returns `null` and the agent route throws
`"Live agent is not configured. Set ANTHROPIC_API_KEY or CLAUDE_OAUTH_TOKEN."`,
which the chat renders as a configuration error in the stream. The voice route's
summarizer returns an empty string and the response is `provider: "silent"`. The
heartbeat stays quiet. That silence is the design: an unconfigured agent says
nothing rather than inventing a line it cannot source.

## Speech

> **Not yet on `main`.** The `ELEVENLABS_*` group and `app/api/voice/route.ts` live on `codex/sreoncall-colored-run-outputs`; on `main` speech is the browser's own `speechSynthesis`. See [docs/README.md](README.md).


`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`,
`ELEVENLABS_STABILITY`, `ELEVENLABS_SIMILARITY`, `ELEVENLABS_STYLE`,
`ELEVENLABS_SPEAKER_BOOST`.

All read in `synthesize()` in `app/api/voice/route.ts`, server-side only.

**With no `ELEVENLABS_API_KEY` the route returns `{ provider: "browser" }` before
making any outbound call, and the browser's own `speechSynthesis` speaks the
line.** Voice is not a paid feature that degrades to nothing; it degrades to the
platform engine. The same fallback happens when ElevenLabs returns a non-OK
response, or throws — the `try` around `synthesize` swallows it, because TTS must
never take down the visible answer.

Note what does *not* fall back: if the summarizer produces nothing, the route
returns `provider: "silent"` and speaks nothing. It never reads the raw `answer`
aloud, because that would turn a markdown response into an accidental audiobook.

The tuning variables only matter once a key is present. `numberFromEnv` parses
each one with `Number()` and keeps the default on anything non-finite, so a typo
degrades to the shipped value rather than to `NaN`. `ELEVENLABS_SPEAKER_BOOST`
is the odd one out: it is compared as a string, and only `"false"` (lowercased)
disables it.

## Agent control

`DOS_AGENT_MODE_CEILING` — `self` or `collab`.

Read by `agentModeCeiling()` on **every** request to `POST /api/agent`, not
cached at boot, and again by `GET /api/agent/policy` so the mode selector can
explain a downgrade rather than silently applying one.

It **fails closed**: `OS_AGENT_MODES.includes(raw)` is the whole validation, and
anything failing it becomes `DEFAULT_AGENT_MODE`, which is `collab`. There is no
third mode above `collab` to fall into — the old `auto` was deleted, not merely
unused.

The client sends `agentMode` in the request body; the route runs
`clampMode(requested, ceiling)` and uses the result. **A client asking for more
gets less.** The clamped mode, plus the ceiling, is sent back in the `done`
frame so the browser knows which rules it is actually operating under. See
`docs/security.md` for why that return trip is load-bearing.

## The proactive loop

`SRE_INGEST_SECRET` guards `POST /api/events` (where the SRE agent posts what it
found) and `POST /api/heartbeat` (beat now). Both compare it against the
`x-internal-secret` request header and return `401` on mismatch. **Unset leaves
both routes open** — right for a laptop, wrong anywhere else — and the ingest
response says so in the payload: `unsecured: true` whenever the secret is
missing. `GET` on either route is not gated.

`TRUNK_HEARTBEAT_LOCAL_SECONDS` sets how often the standing loop beats, default
`900` (fifteen minutes, matching MCS's cron). Drop it to ~30 for a demo. The
interval sleeps first; there is no beat at boot.

`TRUNK_HEARTBEAT_LOCAL=0` turns the in-process loop off entirely. Use that when
a real scheduler drives `POST /api/heartbeat` instead — the loop is in-process
and lives and dies with the server, which is the right lifetime for a laptop and
the wrong one for a deployment.

Independent of both: `POST /api/events` calls `wakeEarly()` when the event
clears the salience bar, which beats after a 2.5 s debounce so a burst of events
is still one briefing.

## The backend seam

`NEXT_PUBLIC_API_BASE_URL`, read once in `lib/api/client.ts`.

Unset — the default — means `USING_FIXTURES` is true and every `fetchBackend`
call resolves against `lib/mock/server.ts`. Set it and the identical calls go to
that origin with `Authorization` and `X-Org-Slug` headers attached. Nothing else
in the app calls `fetch` directly, which is what makes landing a real backend a
per-endpoint change rather than a per-component one.

It is `NEXT_PUBLIC_` **by necessity**: the browser is the caller, so the value
has to be in the bundle. That is fine — it is a URL, not a credential. It is
also the reason a credential must never be given the same treatment.

## Other

`NEXT_PUBLIC_APP_ENV` — read in `lib/os/useFileSystem.ts` and compared against
`"production"` to set `isProd` on the customer-output file visibility filter.
Public by the same logic as the base URL: the filter runs in the browser.

`NEXT_RUNTIME` — Next's own variable, not ours to set. `instrumentation.ts`
returns immediately unless it is `"nodejs"`, because the edge runtime has no
timers that survive a response and importing the store there would fail on
`node:fs`. This is what confines the heartbeat to the Node runtime.

`DOS_AGENT_DEBUG=1` — exposes `GET /api/agent/debug`, the last 20 model calls
with lane, model, tools offered, requested-vs-clamped mode, durations and
errors. **404s when unset**, deliberately, so the route does not advertise
itself. It returns prompt-adjacent metadata, never conversation text.

## Known gap: `.env.example` is incomplete

`.env.example` currently documents the model key, `DOS_AGENT_MODE_CEILING`, the
proactive-loop group and `DOS_AGENT_DEBUG`. It is **missing**:

- the entire `ELEVENLABS_*` group (seven variables)
- `CHAT_ANTHROPIC_API_KEY`, which is the *highest-precedence* credential

Nothing else has a home there either (`NEXT_PUBLIC_API_BASE_URL`,
`NEXT_PUBLIC_APP_ENV`), but those two omissions are the ones that bite: someone
copying the example file cannot discover that voice is configurable at all, and
cannot discover which of two keys wins. `.env.example` should be updated. Until
it is, this table is the reference, not that file.

## Profiles

**Laptop demo** — nothing required. The app runs on fixtures, chat reports a
configuration error, voice falls back to the browser engine, the heartbeat beats
every fifteen minutes and stays silent. To make it live:

```
CHAT_ANTHROPIC_API_KEY=...        # or ANTHROPIC_API_KEY / CLAUDE_OAUTH_TOKEN
TRUNK_HEARTBEAT_LOCAL_SECONDS=30  # so the loop is demonstrable
```

**Shared demo** (anyone but you can reach the URL) — add:

```
SRE_INGEST_SECRET=...             # close the ingest and heartbeat routes
DOS_AGENT_MODE_CEILING=collab     # explicit, not inherited from a default
ELEVENLABS_API_KEY=...            # optional; browser TTS otherwise
# DOS_AGENT_DEBUG stays unset
```

**Deployment** — everything from the shared profile, plus:

```
NEXT_PUBLIC_API_BASE_URL=https://...   # off fixtures
NEXT_PUBLIC_APP_ENV=production
TRUNK_HEARTBEAT_LOCAL=0                # a real scheduler drives POST /api/heartbeat
```

and `DOS_AGENT_DEBUG` unset. A deployment also has prerequisites that are not
environment variables at all — see the deployment checklist in
`docs/security.md`.
