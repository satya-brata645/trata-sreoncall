# Voice

One microphone, one session machine, two ways in — and a rule underneath all of
it: **an open microphone is a promise, not a feature flag.** Almost every
decision in `lib/voice` falls out of that, plus the fact that voice fails
*quietly*: there is no error state to look at, just a mic that stopped
mattering.

## Two ways in, treated differently on purpose

| | ⌥Space (command bar) | "hey SOS" (menu bar) |
|---|---|---|
| Opens with | A chord (`isSummonChord`, `lib/os/AgentSummonContext.tsx`) | A per-person persisted toggle (`lib/os/ambientListening.ts`) |
| Microphone | **Muted** at mount | **Open**, and stays open |
| Talking | Hold Space, or click the mic to latch | Just talk; the wake phrase gates it |
| `SessionOrigin` | `hotkey` → opens in `awake` | `ambient` → opens in `ambient` |
| Default | Always available | **Off**, per person |

**The chord summons the agent; it does not consent to an open microphone.**
`CommandBar.tsx` mounts muted and stays muted until you hold Space. Two reasons,
the second empirical: a bar that appears on a hotkey and starts listening has
taken a decision that was not its to take, *and* a permanently live mic in a
room with any noise in it dispatches turns nobody asked for — an open session
here picked up ambient speech and answered it, repeatedly.

`held` and `latched` are tracked separately so releasing Space cannot close a
microphone the mic button deliberately opened. Space is push-to-talk only while
the field is **empty** — once there is text, Space is a space and typing wins.
The hold releases on `keyup` *and* on `blur`, because a ⌘-tab mid-hold swallows
the key-up, and a microphone stuck open is the exact failure this design exists
to prevent.

**The bar restores what it found; it does not force a mute on the way out.**
Forcing muted on unmount reached past the command bar into a session it does not
own: with "hey SOS" on, a single summons — including one the *agent* raised
itself — muted the shared microphone for good, with nothing on screen offering
to unmute it. The wake word simply stopped working while the menu-bar toggle
still claimed it was on. Hence `spokenSummons`: a bar raised *by* the wake word
never mutes at all, because someone who has just said "hey SOS" is about to say
the instruction, and muting them at that exact moment loses it.

**The menu-bar toggle is the real promise.** It opens a microphone and streams
continuously — not on a press, not while a dialog is up, but for as long as the
desktop is on screen. So: off by default, scoped to a person rather than an org
(whether your microphone is open is about you and the machine you are sitting
at), loud while running, revocable in one click. Persistence is `localStorage`
behind a try/catch, and the pre-hydration snapshot is a shared `EMPTY` — a
previous user's preference can never leave a microphone open for the next one.

**The indicator reads the effective state, not the preference.** `MicToggle` in
`components/os/MenuBar.tsx` is deliberately *one* button: a separate light next
to a separate switch is two things that can disagree, so the control **is** the
indicator. `open = enabled && !muted` gives two words — **"Mic on"** (amber,
pulsing, capturing) and **"Mic held"** (the preference is on, but the command
bar's push-to-talk is holding it closed; the word stays, the amber does not,
because amber would claim capture that is not happening).

## One session, one owner

`lib/voice/mic-session.ts` is the single browser recognition session shared by
Chat's composer and the desktop. Module-global singleton state, one narrow seam
(`MicSessionSeam`: a recogniser factory and a pair of timers) so tests drive the
real machine rather than a copy of it. Two rules keep it honest.

**A holder opens the mic; mute only closes one that is already open.** `muted`
is a person's preference about a live session; `wantsActive` is the gate that
decides whether capture may begin. Getting this backwards was a real bug:
`acquireMic` was blocked by `muted`, so the desktop session (⌥Space, wake word)
acquired the microphone and then sat behind a mute that **nothing outside the
chat composer ever cleared**. No audio was ever captured for it. The shape now
is `acquireMic` → `holders.add` + `wantsActive = true` → `open()`, and `open()`
is the only place `muted` is consulted. `setMicMuted(false)` resets the backoff
and reopens.

Muting is enforced twice over, because a muted mic that still dispatched
instructions would be a lie the UI cannot correct: `onresult` drops results
arriving from a session muted mid-flight, and `getMicRms()` returns `0` while
muted so the dots cannot dance to speech the session is ignoring.

**Interim text fans out; a finished utterance goes to exactly one owner.**
Interim text and errors are *display*, so every subscriber gets them. A
completed utterance is an **instruction**, and delivering it twice sends it
twice — which is what happened when the desktop's wake-word machine and Chat's
composer were both live: one sentence, two turns. `claimTurnOwnership(token)`
(last claim wins — the desktop opening over a listening composer is the desktop
taking the floor, which is what summoning it asked for) routes `onTurnEnd` to
the claimant alone. `useStreamingVoice`'s `exclusiveTurns` is set by the
desktop's `VoiceSession` and nothing else, and it is claimed alongside the
*hold* rather than at mount: a consumer that is not listening must not silence
the one that is. A claimant that unmounted without releasing falls through to
everyone rather than dropping the sentence.

**Restart, backoff, fatality.** Native recognition ends itself constantly, so
`onend` reschedules with backoff from `RESTART_MIN_MS` (120ms) doubling to
`RESTART_MAX_MS` (2s); a session that actually opens resets it. `aborted` and
`no-speech` are the normal shape of a live session and are swallowed.
`not-allowed` / `service-not-allowed` / `audio-capture` are fatal, and
`wantsActive` is cleared **before** the error is announced so `onend` cannot
restart straight back into the same refusal. Everything else (usually `network`)
is reported and the session kept.

**The level meter is a second capture.** Native recognition exposes no samples,
so `getMicRms` runs its own `getUserMedia` stream through an `AnalyserNode`.
Worth the extra stream: this number is what the dots animate on *and* what
barge-in compares against playback, and a constant zero made both dead. Every
failure path leaves the meter at zero rather than throwing — voice keeps working
and only the meter is honest about knowing nothing.

## The session state machine

`lib/voice/session.ts` is a pure class: no DOM, no timers it did not receive.

| `VoiceMode` | Meaning | Leaves on |
|---|---|---|
| `idle` | No session. Every callback returns early. | `open(origin)` |
| `ambient` | Listening, waiting for the wake phrase. | a wake match |
| `awake` | You have the floor; interim text is `heard`. | dispatch, or `AWAKE_TIMEOUT_MS` |
| `thinking` | Turn dispatched, waiting for the answer. | speech starting, or `THINKING_TIMEOUT_MS` |
| `speaking` | The agent is talking; barge-in is armed. | playback draining, or an interruption |
| `confirming` | A spoken question is outstanding. | the store emptying, or `CONFIRMING_TIMEOUT_MS` |

**`SessionOrigin` decides whether a wake phrase is required.** `hotkey` opens
straight into `awake` — you already summoned it; asking you to say its name
again would be theatre. `ambient` opens into `ambient`, where only
`detectWake(text)` gets you out. Origin is also the return address: every exit
from `speaking`, `thinking` and `confirming` returns to `awake` for a hotkey
session and `ambient` for an ambient one. In `awake`, only an *ambient* session
re-arms the awake timeout — a hotkey session's floor does not expire.

**`AWAKE_TIMEOUT_MS` (8s)** returns an ambient session to waiting after silence.

**`THINKING_TIMEOUT_MS` (20s)** is a watchdog over a real trap. `thinking` is
left only by the answer *starting*, and that is observed as speech beginning —
so every path where speech never begins (the request failing, a round that is
all tool calls and no words, a browser with no synthesis, a Chat window closed
before the turn arrived) parked the session in `thinking` **permanently**, where
`onInterim` and `onTurnEnd` both fall through and do nothing. The mic stayed
open, the dots kept moving, nothing anyone said could be heard again, and the
only way out was a reload. Generous on purpose: an answer that takes eleven
seconds should not race it, and firing early only means listening resumes
slightly before the agent speaks.

**`CONFIRMING_TIMEOUT_MS` (15s)** guards the same shape of trap but is **not** a
silent recovery. `confirming` is left when the approval store empties, and an
answer `parseConsent` will not commit to leaves the mode exactly where it was.
So the watchdog fires `onApprovalTimeout` and the handler is expected to
**deny** — it fires precisely because nobody said yes, and silence is not
consent. Two separate things must happen: the decision resolved (the handler's
job) and the session no longer deaf (the machine's). Deliberately **not**
re-armed by an unclear answer — the deadline runs from when the question was
asked, so "shall I?" cannot be kept alive indefinitely by someone talking around
it. Shorter than the thinking timeout because a question is asked *of* someone:
if they were going to answer, they would have.

## Wake word

`lib/voice/wakeWord.ts` matches "hey SOS" against three patterns, built to
survive what recognition actually returns: `sos`, `s.o.s.`, `soss`, `sauce`,
`source`, after `hey|hi|hello|ok|okay|yo`. Also `SOS, are you there` / `wake up`
/ `listen`, and the bare name at the head of a sentence. The match returns
`{start, end, phrase, rest}` — **`rest` is the instruction**, so "hey SOS, open
the reachability report" wakes *and* dispatches in one breath; `rest === ""`
just wakes and waits.

## Speaking back: the TTS path

> **Not yet on `main`.** This section describes work on `codex/sreoncall-colored-run-outputs`; on `main` today the only playback path is the browser fallback below. See the scope note in [docs/README.md](README.md).


`app/api/voice/route.ts` does two things in order, and the ordering is the
point.

**1. Summarise.** `claude-haiku-4-5-20251001`, `max_tokens: 160`, `temperature:
0.4`, system prompt `SPOKEN_SUMMARY_SYSTEM` (`lib/voice/spoken-summary.ts`).
**The screen answer and the spoken answer have different jobs.** The screen has
every detail and the user is looking at it; the voice is a colleague summing up
out loud. So the prompt forbids restating — "distill, don't restate", one
sentence for a factual reply, 2–3 sentences and ~55 words for an incident
answer, lead with the single most important point, no process narration ("I
fetched", "I checked"), no markdown, no IDs, paths, hashes or machine
timestamps, human phrasing for time. Context is bounded:
`SPOKEN_ANSWER_CONTEXT_CHARS` (6,000), `SPOKEN_ASK_CONTEXT_CHARS` (240); output
is capped at `SPOKEN_SUMMARY_MAX_CHARS` (650) on a word boundary by
`cleanSpokenSummary`, which also strips fences, links, URLs and markdown
punctuation from whatever came back.

**Raw markdown never becomes audio.** If summarisation yields nothing the route
returns `{spoken: "", provider: "silent"}` and never falls back to reading
`answer` — silence is safer than turning the screen's markdown into an
accidental audiobook. A `spoken` field in the request bypasses the summariser
and is reserved for copy already authored for voice: a consent prompt, not a
reply.

**2. Synthesise.** ElevenLabs, `pcm_16000` with `optimize_streaming_latency=4`.
Defaults: voice `21m00Tcm4TlvDq8ikWAM`, model `eleven_flash_v2_5`, stability
`0.45`, similarity boost `0.75`, style `0.25`, speaker boost on — each
overridable by `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`,
`ELEVENLABS_STABILITY`, `ELEVENLABS_SIMILARITY`, `ELEVENLABS_STYLE`,
`ELEVENLABS_SPEAKER_BOOST`. No `ELEVENLABS_API_KEY`, a non-OK response, or a
thrown request all degrade to `provider: "browser"`; the concise line still gets
spoken locally. **TTS must never take down the visible answer.**

**3. Play.** `lib/voice/pcm-player.ts` schedules raw little-endian Int16 through
Web Audio: `Int16 / 32768` into a `Float32Array`, one `AudioBuffer` per chunk,
started at `max(currentTime + 0.02, nextStart)` so chunks are gapless. Raw PCM
needs **no decode step**, which is the whole reason for the format — MP3's
variable decode delay is latency you cannot schedule around. `primeAgentVoice()`
calls `ensureContext()` from the user's gesture, before the network round trip,
so the `AudioContext` is never created cold. `pauseFast`/`resumeFast` are gain
0/1 plus context suspend/resume (provisional, while the arbiter decides);
`stop()` is a 50ms ramp out plus a mute flag, so late audio cannot leak through
after a confirmed barge.

`lib/voice/agent-playback.ts` orchestrates: one `registerPlaybackControl`
regardless of which engine is live, a generation counter plus an
`AbortController` so a superseded answer cannot speak over the new one, and a
fall-through to `speakBrowserText(payload.spoken)` — **still the concise persona
line, never the raw screen response** — when the provider is not ElevenLabs.
`lib/voice/agent-speech.ts` publishes `{line, speaking}` as an external store
read both by the command bar's narration and by the session's speaking/idle
transitions, so no two surfaces can disagree about whether the agent is
mid-sentence.

## Fallback: the browser's own engine

`lib/voice/browser-playback.ts` drives `window.speechSynthesis`. Three
properties of that API shape the file, and **all three were live faults**:

- **It is not a text renderer.** Handed a model reply it reads "asterisk
  asterisk critical asterisk asterisk", spells URLs character by character and
  recites code fences. Hence `speakable.ts`, applied before anything is queued.
- **It stops on its own.** Chromium's engine pauses somewhere around fifteen
  seconds into a single utterance and never resumes, so any answer longer than a
  sentence or two was cut off mid-word. Hence `chunkForSpeech` — sentence
  boundaries first (where a speaker would breathe), then clauses, then words, to
  `MAX_CHUNK_CHARS` (180), so short utterances queued back to back stay under
  the limit — plus `startResumeWatchdog`, which pokes `resume()` every
  `RESUME_TICK_MS` (4s) at an engine whose `speaking` is true while no audio
  comes out.
- **`cancel()` immediately before `speak()` races.** The old code did exactly
  that on every chunk, and in Chromium it intermittently kills the *incoming*
  utterance along with the outgoing one — the failure where the agent answers
  and no sound comes out at all. **Cancelling is now only ever a stop.** A new
  answer cancels, then schedules `speakNext` on the next tick, never off the
  cancel's own callbacks.

**Every exit path ends at `finish()`.** The voice session leaves `speaking` when
playback drains, so an utterance that starts and never reports finishing hangs
the whole machine. So: `onend` and `onerror` both route to `advance`; a
`CHUNK_STALL_MS` (12s) timer covers the engine accepting an utterance and then
never reporting on it, re-armed on `onstart` to give a live chunk room for its
own length; an empty queue calls `finish()`; a missing engine still publishes
the line and finishes after 600ms, so the session's transitions behave exactly
as they would with audio.

The level is a decaying envelope off `onboundary` (`LEVEL_DECAY_MS` 320ms, since
boundaries arrive every ~250ms of speech). The engine exposes no samples, so
this is the only signal available — a constant zero left the dots frozen while
the agent talked and made *every* microphone reading look like an interruption.
`setSpokenLine` is published per chunk so narration follows the voice, while
`speaking` never drops between chunks, so the session does not see the answer
end and restart once per sentence.

## `speakable.ts`: deliberately lossy

Not a markdown renderer — the answer to *"what would a person reading this out
actually say"*. Pure and dependency-free, testable without a DOM or an engine.

- **Fenced blocks are named, not recited**: replaced with "I have put the code
  in the chat." A code-only answer still says something.
- **Link targets are dropped** in favour of the link text; images vanish
  entirely (alt text is not a sentence); a bare URL becomes "the link".
- **Table pipes become pauses** (`, `) — a column break sounds like a comma.
- Headings, block quotes, list markers and rules are structure, not speech:
  stripped, with newlines promoted to `". "` so the engine actually pauses
  between items instead of running them together.
- Emphasis stripping is **paired-only**, so `2 * 3` survives; underscores only
  at word boundaries, or `api_key_rotation` and every other snake_case
  identifier in a security answer loses its middle.
- Inline backticks go and the identifier inside stays, because it is worth
  saying.
- The substitutions readily produce `". ."` and `", ,"`, so the tail of the
  pipeline collapses punctuation runs and re-spaces the result.

## Barge-in

Two stages: cheap and local first, then a decision.

**Stage one — `barge-vad.ts` notices.** Armed only while `mode === "speaking"`.
Every `VAD_TICK_MS` (30ms) it compares `getMicRms()` against the playback level;
a delta above `BARGE_VAD_DELTA` (0.05) sustained for `BARGE_VAD_SUSTAIN_MS`
(180ms) is speech over the agent, and anything shorter resets the counter — a
blip is not a barge-in. Nothing counts until
`playbackHasSettled(BARGE_IN_SETTLE_MS)`, 200ms after first audio, because the
levels have not yet separated at the moment audio starts. On trigger, playback
**pauses provisionally** (`pauseFast`) rather than stopping: the decision has
not been made yet. A transcript arriving while armed pauses immediately and
asks. `VAD_PAUSE_FALLBACK_MS` (1.5s) resumes playback if no verdict ever
arrives, so a stuck arbiter cannot leave the agent silently muted; a `pending`
counter discards verdicts that land after a fallback, a disarm, or a newer
transcript.

**Stage two — `interrupt-arbiter.ts` decides.** Was that a real interruption, or
the microphone hearing the speakers?

This file used to carry the client half of a server contract — a system prompt,
a request builder and a verdict parser for **a relay that was never built and
has no route** — with a local fallback that compared the transcript to the
agent's line by *substring*. Recognition never returns a clean substring of
synthesised speech, so that fallback almost never matched: every word the
microphone caught off the speakers counted as a real interruption, and **the
agent dispatched its own sentence back to itself as the user's next
instruction.** What is left is the check that works.

`echoSimilarity` is **word overlap**, not substring: the share of heard tokens
that also appear in the agent's line, counted against a multiset so a line
repeating one word cannot absorb a transcript repeating another. Overlap
survives dropped and reordered words, which is exactly what echo looks like
coming back through a microphone. At or above `ECHO_SIMILARITY` (0.6) it is echo
and playback resumes; below, it is a distinct utterance and the agent stops.

Order matters. **Stop phrases always win** — "stop", "wait", "hold on", "no",
"cancel", "actually", "never mind", "shut up", "enough" and friends bypass both
the length gate and the overlap test, because "stop" is one word, the agent may
well have just said it, and a person saying it over the top means it. Then
`MIN_WORDS_FOR_ARBITER` (2): one stray word off the speakers is the commonest
echo there is, and the ones that genuinely mean stop were already handled. When
genuinely unsure, **interrupt** — talking over someone trying to stop you is
worse than pausing by mistake; an arbiter that throws is treated the same way.

**It stays local on purpose.** Barge-in has to decide inside a couple of hundred
milliseconds. A round trip cannot, and being slow to stop talking is the failure
this whole path exists to avoid.

## Spoken approval

`spoken-approval.ts` is the producer that was missing. `pending-approval.ts` is
a store with consumers in the voice session and, previously, **no producer at
all** — so `getPendingApproval()` was permanently null, `confirming` was
unreachable, and `parseConsent` and `promptIsEchoSafe` were dead code. Saying
"yes" could not approve anything. Three rules make a spoken approval safe:

- **The question may not contain its own answer.** An agent that says "go ahead
  and open Launchpad?" out loud is one echo away from approving itself: the
  microphone hears its own words and `parseConsent` cannot tell whose "go ahead"
  it was. `promptIsEchoSafe` rejects any prompt containing a consent phrase, and
  `safeSpokenPrompt` replaces it **wholesale** with `NEUTRAL_APPROVAL_PROMPT` —
  *"That one needs your decision. Shall I?"* It carries no detail on purpose:
  the card on screen has the steps, and this is the case where reading them
  aloud is what makes them dangerous.
- **Answering clears the store.** The session leaves `confirming` when the store
  empties, so a responder that forgot to clear would leave the mic waiting for a
  yes to a question already settled. `settle()` also stops only the prompt *it*
  started — answering mid-question cuts the agent off; answering after it moved
  on does not cut off whatever it moved on to.
- **A superseded question is denied, not dropped.** Two outstanding decisions
  cannot both be answered by one "yes", and an unanswered one must never be left
  half-open.

`denyPendingApprovalByVoice()` is the fail-closed exit for timeouts and
unmounts, and it will answer a store populated by something *other* than this
module rather than leave it stranded. **An unanswered question is denied, not
left open.**

`parseConsent` (`consent.ts`) is a keyword matcher, not a model call: latency
matters and **ambiguity is not consent**. Anything over `MAX_CONSENT_WORDS` (4)
is `unclear`; **no wins over yes** in the same breath; matching is
word-boundary, so "yesterday" is not "yes"; anything it will not commit to
leaves the question standing. The module is symmetric by construction — every
phrase the parser accepts is a phrase the prompt may not contain, which its test
asserts rather than trusts.

Only spoken turns get spoken approvals. A typed turn's approval belongs to the
card alone; opening `confirming` for it would leave the session waiting on an
answer through a microphone nobody opened. `useSummonAgent.ts` is the caller: it
renders the plan (`spokenApprovalPrompt`), hands over a sentence, and resolves
the promise its tool loop is blocked on — so `lib/voice` never learns what a
desktop plan is.

## Speaking first

`proactive-speech.ts` is the agent starting a sentence nobody asked for. The
product's claim is a teammate that works while you are away and tells you what
it found, and the standing heartbeat loop that does that work had no voice — it
wrote into the home conversation and was read by whoever happened to be looking.

**The gate is a pure function**, because speaking unprompted is the easiest
thing in this subsystem to get wrong and the rules deserve to be arguable rather
than buried in a component:

- **Only into an open ear.** `SPEAKABLE_MODES` is `{ambient}` alone. A desktop
  with no voice session is a desktop whose owner has not asked to be spoken to;
  ambient listening being on is the standing invitation, and nothing else is.
- **Only when nobody is mid-sentence.** Not `thinking`, `speaking` or
  `confirming` — and **not `awake` either**, because that means the user has
  just summoned it and has the floor.
- **Only what is worth interrupting for**: `critical` and `high`. Medium and low
  are real findings that belong in the activity list, not things to say out loud
  to someone who did not ask a question.
- **Not often**: `PROACTIVE_MIN_GAP_MS` (120s) between unprompted sentences.
- **Never past a mute.** A muted microphone is someone asking for quiet, and
  talking through it would be a strange reading of that.
- And nothing that reduces to an empty `speakableFrom` — an empty utterance
  would still burn the rate limit.

**The watch polls only while the gate could open at all.** `watching` is derived
to a boolean from `canSpeakProactively`, so the poll starts and stops on the
gate opening and closing rather than on every transcript that nudges the mode: a
desktop with voice off makes **no extra requests**, and the feature costs
nothing when it cannot fire.

**It arms silently.** The first read of `/api/conversations/home` sets
`seenThrough` and publishes nothing. What landed while nobody was listening is
history, not news, and a backlog read out the moment the microphone opens is
exactly the behaviour that makes people turn this off. For the same reason there
is **no queue**: a message arriving while the agent is talking is dropped, not
stacked — it is already in the activity list. Ids are marked spoken *before*
speaking, so a wake-up that fails or is barged over is never announced twice.
Delivery is a window event (`PROACTIVE_SPEECH_EVENT`) rather than a callback,
because producer and desktop surface share no ancestor.

## Surfacing failure

`lib/os/useAmbientAgent.ts` wires all of the above together and carries one
extra responsibility. **Voice fails quietly by nature** — there is no error
state to look at, just a microphone that stops mattering — and *"I spoke and
nothing happened"* is indistinguishable from *"it is broken"* unless something
says which. So every path that used to end in a `console.warn`, or in the
session silently reopening its ear, now ends in `notice`:

| Path | What the user is told |
|---|---|
| `onAnswerTimeout` (`THINKING_TIMEOUT_MS`) | "I did not get an answer back. Say that again?" |
| `onApprovalTimeout` (`CONFIRMING_TIMEOUT_MS`) | "I did not hear an answer, so I left it alone." |
| Fatal mic error | "I cannot open the microphone. Check this site's microphone permission." |
| No recognition in this browser | "This browser cannot listen. Type instead." |

A fatal microphone error also turns the ambient preference **off**: a refused
microphone that leaves "Mic on" burning amber in the menu bar is the indicator
lying about the one thing it exists to report. A new turn clears the notice,
because a fresh turn supersedes whatever went wrong with the last one.

The hook is also where origin becomes destination: a turn heard by the summon
session is run by that surface and never inserted into Chat, `exclusiveTurns` is
set so Chat's composer cannot submit the same utterance a second time, the VAD
is armed and disarmed on `mode === "speaking"`, and the pending-approval store
is mirrored into `onApprovalPending` / `onApprovalResolved`.

## Everything decidable is pure and tested

The parts that decide anything take no DOM and no wall clock: the session
machine, the barge loop, the arbiter, the consent parser, the approval rules,
the proactive gate and the markdown reduction all receive their timers and their
dependencies. `mic-session.ts` and `browser-playback.ts` are the two that must
touch the browser, and both were given a seam for the same reason — the mute
gating, the turn ownership and the restart backoff were the three things most
recently fixed in `mic-session.ts` and had **no tests at all**.

| Test file | Covers |
|---|---|
| `lib/voice/__tests__/micSession.test.ts` | Holder vs mute, turn ownership, fatal vs transient errors, restart backoff |
| `lib/voice/__tests__/session.test.ts` | Mode transitions, all three watchdogs, and the arbiter's decisions |
| `lib/voice/__tests__/bargeVad.test.ts` | Sustain, settle, provisional pause, superseded and late verdicts |
| `lib/voice/__tests__/browserPlayback.test.ts` | Chunking, cancel-is-a-stop, swallowed and errored utterances |
| `lib/voice/__tests__/speakable.test.ts` | The lossy reduction, and that chunking loses no words |
| `lib/voice/__tests__/spokenApproval.test.ts` | Echo-safety, clearing, superseded-is-denied, fail-closed exits |
| `lib/voice/__tests__/wakeAndConsent.test.ts` | Wake patterns, consent parsing, prompt/parser symmetry |
| `lib/voice/__tests__/proactiveSpeech.test.ts` | The gate, and the heartbeat message filter |
| `lib/voice/__tests__/spokenSummary.test.ts` | Prompt construction and the spoken-line cleanup |
