# Security

## Threat model

This is an agent that reads text nobody vouched for — threat-intel advisories,
CVE descriptions, asset and host names harvested from customer environments,
OSINT from brand monitoring, documents customers upload as evidence — and that
can drive a visible desktop. Those two facts together are the whole threat
model. An attacker who can get text in front of the agent (a hostname, a
finding, an uploaded PDF) will try to make it read that text as instruction:
open something, change what the analyst is looking at, narrow a filter so the
one row that matters falls out of view, or assert that "the user has already
approved" whatever comes next. A second class of attack targets the approval
loop rather than the agent: getting a yes without a person meaning it — by
speaking approval words into a microphone, by posting to an ingest route that
never checks who is calling, or by having the browser believe it holds a wider
permission than the server granted. What an attacker cannot do through this
agent is run a command, reach a cluster, or touch a machine: there is nothing
in the protocol that does those things. The exposure is the screen and what the
person in front of it believes.

## The consent boundary

The line is not "may the agent act". In Collab it arranges your windows freely,
and asking permission to move a window is not collaboration — it is a permission
dialog with extra steps. The line sits where the agent reaches **inside** an app
and changes what you are working on.

From `VERB_TABLE` in `lib/os/agentProtocol.ts`:

| Verb | Class | `self` | `collab` |
| --- | --- | --- | --- |
| `open_app` | set | deny | allow |
| `close_window` | set | deny | allow |
| `focus` | state | deny | allow |
| `minimize` | state | deny | allow |
| `restore` | state | deny | allow |
| `snap` | state | deny | allow |
| `set_geometry` | state | deny | allow |
| `pin_app` | state | deny | allow |
| `unpin_app` | state | deny | allow |
| `focus_panel` | state | deny | **ask** |
| `set_affordance` | state | deny | **ask** |
| `full_screen` | forbidden | deny | **deny** |

Two verbs ask, and they are the two that change what the screen shows you rather
than where the frames sit. `focus_panel` switches which part of an app is
displayed; `set_affordance` sets a declared control inside it. What a screen
shows is what a person acts on, so that is the thing worth interrupting for.

`full_screen` is refused in **every** mode, including Collab, and is the only
verb classed `forbidden`. Full screen hides the dock and the menu bar — and the
menu bar is where the mode control lives. An agent that full-screens a window
has hidden the user's own off-switch. The refusal carries its alternative
(`snap` with the `fill` preset) so the model learns the substitution instead of
retrying variations. It is also simply absent from the `desktop_act` verb enum
in `app/api/agent/route.ts`, so a model that tried anyway would fail schema
validation.

In `self`, `verbsForMode` returns empty and the desktop tools are **omitted from
the request entirely** — `callModel` sends `[deferTool]` or `[...dataTools]`
instead of the desktop set, plus a system-prompt line telling the model not to
claim it can drive windows. Not offered and refused: omitted. A tool the model
can see is a tool it will try. The one thing `self` does not remove is
`read_events` on the reasoning lane — reading is not driving, and an agent that
cannot check its own claims while being questioned about them is useless exactly
when it matters most.

A denial is an **answer**. Both approval sites
(`components/os/apps/ChatApp.tsx`, and `lib/os/useSummonAgent.ts` on the
unlanded branch) push a tool
result saying the plan was declined and must not be retried. Without it the
model waits on a reply that is never coming and the turn hangs — which trains
users to click yes to unstick things.

## Server-side enforcement

`POST /api/agent` re-reads `DOS_AGENT_MODE_CEILING` on every request. Not at
boot, not per session — per request, so tightening the ceiling takes effect on
the next turn rather than the next deploy. Validation is `OS_AGENT_MODES.includes`
and the fallback is `collab`: unset, misspelled, or a stale `auto` all fail
closed.

The client sends `agentMode` as a preference. The route computes
`clampMode(requested, ceiling)` and — this is the part that matters — returns
the **clamped** mode and the ceiling to the browser in the `done` frame.

It has to, because the browser is what runs the verbs. The approval card is
rendered client-side by `batchNeedsApproval(proposedVerbs(...), mode)`. A client
that believed it was in a wider mode than the server granted would skip the
approval the server thinks it is enforcing, and the server would never know: it
sees a plan go out and nothing come back. Returning the clamped mode keeps the
two halves agreeing about which rules are in force.

**A client preference is never an authorization.** `GET /api/agent/policy`
exists so the mode selector can explain a downgrade instead of silently applying
one, and nothing the client does with that answer can raise what the agent is
allowed to do.

## Structural limits, not just policy

Some rules here are enforced by the shape of the protocol rather than asserted
in a prompt, and those are the ones worth trusting.

**There is no verb for submit, confirm, or apply.** The `set_affordance` step
carries one string and sets one declared control of kind `search`, `filter` or
`select`. It can narrow or move what is displayed; empty string clears it. That
is the entire vocabulary. So the doctrine rule "don't submit" is structural, not
asserted — an agent cannot reach for a verb the protocol cannot express, and a
prompt injection that says "submit the form" is asking for a capability that has
no encoding.

The same holds for addressing. Windows are named by small integers reissued on
every read; the internal `windowId` is never serialized. One way to name a
window means one thing to validate, and an invented handle fails resolution with
a message listing the real ones instead of moving the wrong window. Affordances
are **declared** by the app, never harvested from the DOM — a harvested
element's class is unknowable, and an open params bag would be harvesting
arriving by the back door. Batches are bounded (1–8 steps), tagged with the
`epoch` of the desktop they were planned against, and rejected whole if that
signature changed.

What this agent does **not** have, at all:

- no shell, no command execution
- no `kubectl`, no cluster or cloud API access
- no container or VM
- no screenshot capture, no pointer or keyboard control
- no LGTM/observability tools — a separate SRE agent watches the systems and
  reports; this agent does not query telemetry and the prompt tells it not to
  offer to
- no network egress beyond `api.anthropic.com`, `api.elevenlabs.io`, and the
  configured backend base URL

The tool list is four desktop tools (`read_desktop`, `begin_takeover`,
`restore_layout`, `desktop_act`), one data tool (`read_events`), and one handoff
(`defer_to_reasoning`). That is the complete surface.

## Prompt injection

`lib/agent/untrusted-content.ts` is the mitigation layer. Untrusted sources are
named explicitly in that file: threat-intel advisories, CVE descriptions, asset
and host names harvested from customer environments, OSINT from brand
monitoring, and documents customers upload as evidence. Chat already reads all
of it through file and session tools.

The pieces:

- `fenceUntrusted(content, source)` wraps content in
  `<untrusted_content source="…">` tags.
- `UNTRUSTED_CONTENT_INSTRUCTION` is a system-prompt section, included in
  `HEAVY_SYSTEM`, stating that fenced text is data and never command; that
  content trying to instruct the agent is itself a finding to report; that no
  desktop action, scan, message or setting change may happen because content
  asked; and that a closing tag inside the content does not end the fence.
  Product docs are the stated exception — those are authoritative.
- `looksLikeInjection(content)` matches six signals: "ignore previous
  instructions", "disregard your instructions/system prompt/rules", "you are now
  a/an/in", `system: you`, a literal `<untrusted_content>` / `<system>` /
  `<assistant>` tag, and — pointedly — "the user has already
  approved/authorized/consented".
- `fenceWithNotice` appends a note telling the agent to report it as a possible
  injection rather than act on it. `fenceIfText` applies it to string values;
  `markUntrustedValues` stamps a result object with `untrusted_values: true`.

The file says the honest thing about itself, and it is repeated here because it
is the point:

> **Fencing is a mitigation, not a gate.** The gate is Collab mode, where no
> write happens without a human clicking yes. Treat everything here as reducing
> the odds, never as making them zero.

Regex signals catch the phrasings people actually use; they do not catch
paraphrase, encoding, or a novel one. Nothing in this layer should ever be
credited with preventing an injection — it lowers the rate at which one gets
through to a human who then has to decide.

Desktop control is what raises the stakes. Before it, a successful injection
could make the agent **say** something wrong. After it, the agent can **act**.
That is why the consent boundary sits where it does, and why the two verbs that
change what you are looking at ask even in the mode where everything else does
not.

## Voice

Speaking is a second input channel into the approval loop, and it has an attack
that typing does not: **the microphone hears the agent's own voice.** If the
agent asks "go ahead and open Launchpad?" out loud, the speaker feeds "go ahead"
back into the recognizer and `parseConsent` cannot tell whose words those were.
The agent approves itself by echo.

`promptIsEchoSafe(prompt)` in `lib/voice/consent.ts` defeats it structurally:
**the spoken question may never contain its own answer.** It normalizes the
prompt and returns false if any word or phrase from the YES or NO lists appears
in it. `safeSpokenPrompt` in `lib/voice/spoken-approval.ts` then replaces an
unsafe prompt **wholesale** — not by editing out the offending words, but by
substituting `NEUTRAL_APPROVAL_PROMPT`: *"That one needs your decision. Shall
I?"* It carries no detail on purpose. The card on screen has the steps; this is
precisely the case where reading them aloud is what makes them dangerous. A test
asserts the neutral prompt contains no consent word rather than trusting that it
does not.

The other two rules in that module:

- **An unanswered question is denied, not left open.**
  `denyPendingApprovalByVoice()` is the fail-closed exit for timeouts and
  unmounts, and it answers a store populated by something else rather than
  leaving it stranded.
- **A superseded question is denied, not dropped.** A second offer calls
  `live.deny()` on the first. Two outstanding decisions must never both be
  settled by one "yes".

`parseConsent` is a keyword matcher and not a model call, deliberately: latency
matters, and **ambiguity is not consent**. Anything longer than
`MAX_CONSENT_WORDS` (4) is `unclear`. NO is checked before YES, so "no, go
ahead" resolves to no. `unclear` is neither approval nor denial — it simply does
not settle the question, and the question fails closed on its own terms.

## Machine authentication

`POST /api/events` and `POST /api/heartbeat` are authorized by a shared secret
in the `x-internal-secret` header, compared against `SRE_INGEST_SECRET`.
**Authorized by a shared secret rather than a session because the caller is a
process, not a person** — there is no browser, no cookie, and nobody to prompt.

- Mismatch ⇒ `401`.
- Unset ⇒ open. Right for a laptop, wrong everywhere else.
- When it is open, the ingest response says so out loud: `unsecured: true` in
  the JSON body. It fails *visibly* open rather than quietly open.

The `GET` handlers on both routes are not gated. `GET /api/events` returns the
last 100 events; `GET /api/heartbeat` returns the last beat's verdict. On a
shared or deployed instance those are readable by anyone who can reach the URL.

## Human authentication

There is **no identity provider**. Stating it plainly:

- `lib/auth/scope.ts` serves one hardcoded user (`user_trata_demo`, Alex Mercer)
  and one hardcoded org (`org_trata`). `useAuth`, `useUser` and `useOrganization`
  in `lib/auth/mockUser.ts` return those fixtures with `isLoaded: true`.
- `useAuthFetch` sends the literal string `"fixture"` as the bearer token.
  `fetchBackend` ignores it while running on fixtures.
- Nothing anywhere checks who a browser request came from.

What **is** real is the contract. `scopeKey()` returns `orgId || userId`, and
every per-user store is namespaced by it — pinned apps, agent mode, notes, the
conversation store, and `.data/<scopeKey>/` where the event log and heartbeat
state live. That key shape is MCS's, and it is kept even while both halves are
fixtures, because a changed key silently orphans everything a user had pinned.
When a provider lands, exactly one module changes and the key shape stays put.

**This must be closed before any multi-tenant deployment.** A scope key is a
namespace, not an authorization. Today anyone who can reach the app is Alex
Mercer.

## Secrets handling

- Model and TTS credentials are read only inside route handlers that declare
  `runtime = "nodejs"` (`app/api/agent/route.ts`, `app/api/voice/route.ts`).
  They never reach a bundle.
- **Never prefix a credential with `NEXT_PUBLIC_`.** That prefix inlines the
  value into client JavaScript. The two `NEXT_PUBLIC_` variables this app has
  (`NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_APP_ENV`) are public by necessity —
  the browser is the caller — and neither is a secret.
- `.env`, `.env.local` and `.env.*.local` are gitignored, with a comment in
  `.gitignore` saying why: this remote is public and that line exists
  specifically so a key never lands in it.
- `GET /api/agent/debug` returns prompt-adjacent **metadata** — timestamp,
  model, lane, requested/ceiling/clamped mode, tool names offered, message
  count, tool calls made, duration, error string — from a 20-entry in-memory
  ring. Never the conversation. It **404s rather than 403s** when
  `DOS_AGENT_DEBUG` is unset, so the route does not advertise its own existence.
  Even so: it has no business existing in a deployed environment. The error
  field carries a truncated upstream response body, which is the one place
  something sensitive could surface.

## Data at rest

`.data/` is plaintext NDJSON on local disk — `.data/<scopeKey>/events.ndjson`
plus `heartbeat-state.json`. Append-only, no encryption, no access control
beyond filesystem permissions, no retention policy. It is gitignored.

`artifacts/` (`runs/`, `specs/`) is **not** gitignored and is committed to a
public remote. Anything written there is world-readable.

What that means for anything real: incident content, hostnames, customer asset
names and anything the SRE agent reports are exactly the sort of thing that must
not sit unencrypted on a shared box or land in a public repo. Today this is
demo-grade storage and should carry only demo-grade data. Real data needs a real
store with access control, encryption at rest, and a retention policy — none of
which exists here.

## Deployment checklist

Before this is exposed to anyone but its author:

1. **Land an identity provider.** Replace `lib/auth/scope.ts` so `scopeKey()`
   reflects the actual signed-in user and org. Keep the `orgId || userId` shape.
2. **Authenticate every browser-facing route.** `POST /api/agent`,
   `GET /api/agent/policy`, `GET /api/events` and `GET /api/heartbeat` currently
   check nothing.
3. **Set `SRE_INGEST_SECRET`** and confirm the ingest response no longer reports
   `unsecured: true`. Gate the `GET` handlers too, or accept that the event log
   is public.
4. **Set `DOS_AGENT_MODE_CEILING` explicitly.** Do not rely on the fail-closed
   default to be the value you meant.
5. **Unset `DOS_AGENT_DEBUG`.** Verify `/api/agent/debug` returns 404.
6. **Confirm no credential carries a `NEXT_PUBLIC_` prefix**, and that
   `.env.local` is absent from the deployed image and from git history.
7. **Set `TRUNK_HEARTBEAT_LOCAL=0`** and drive `POST /api/heartbeat` from a real
   scheduler with the ingest secret. The in-process loop dies with the process.
8. **Move `.data/` off local disk** to a store with access control, encryption
   at rest, and a retention policy. Purge `artifacts/` of anything that is not
   intended to be public.
9. **Re-audit the untrusted-content boundary.** Confirm every path that renders
   third-party text into the model's context goes through `fenceIfText` /
   `fenceWithNotice`, and treat a gap there as a live finding.
10. **Keep `full_screen` forbidden and keep the `set_affordance` value a single
    string.** Both limits are structural today; adding a submit-shaped verb or a
    params bag would turn a guarantee back into a promise.
