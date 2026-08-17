# SREonCall — Team Submission

## Team + members
**Team ID:** team-2
**Repo:** https://github.com/satya-brata645/trata-sreoncall
**Members** (from commit history): Satyabrata Behera, Preetam Chhipa, Shashwat Sharma, Sujeet Kumar

## One-line pitch
An AI-native on-call system: a backend SRE agent that autonomously detects, triages, and correlates incidents from live telemetry — citing evidence for every claim — paired with a proactive "Trata DOS" desktop agent that decides what actually deserves a human's attention and can act on the desktop by voice, instead of waiting to be asked.

## Interfaces we built

| Interface | What it is | Ladder rungs it actually hits |
|---|---|---|
| **Web UI — "Trata DOS"** (`app/`, `components/os/`) | A windowed desktop-OS surface (dock, chat app, brain/memory app, activity log, generative UI "disco" surface, voice bar, approval cards) driven by a live agent (`claude-haiku-4-5`/`claude-sonnet-5` via `/api/agent`) | **Progressive disclosure** — solid (headline-first chat, detail in expandable app windows). **Agency** — partial (heartbeat loop speaks up proactively, but several app surfaces — Files, App Store, compliance — are fixture, not live). **Auditability** — partial (approval cards + evidence refs surfaced, but not every desktop action is traced). |
| **CLI / autonomous agent loop** (`agent/`, `sre-engineer/`) | The actual investigation engine: `triage.js` and `correlator.js` run a tool-calling loop (OpenAI `gpt-4o` / `gpt-4o-mini`) over read-only observability tools (LogQL, PromQL, Tempo) with no human trigger | **Observability** — solid (real Loki/Mimir/Tempo queries, not canned data). **Agency** — solid (runs unprompted on a schedule, decides itself whether to raise an alert). **Auditability** — solid (every tool call wrapped in `evidence.record()`; alerts and incident merges/splits require cited `evidence_refs` and forced reasoning). |
| **Slack** | A dock icon fixture only (`lib/mock/fixtures.ts`) | **Not started** — no bot, no webhook, no real Slack integration exists. Listed here only so we're not overclaiming it. |

## Architecture in 3–5 bullets
- **Two agents, no shared runtime.** The SRE engineer (`agent/`, `sre-engineer/` — Node + OpenAI) watches telemetry and produces evidenced alerts/incidents; the desktop manager (`app/`, Next.js — Claude) decides what's worth a person's attention and can act on the desktop. They meet at exactly one interface: `POST /api/events`.
- **No database.** Everything is append-only NDJSON under `.data/<scope>/` (events, conversations, heartbeat state), scoped per tenant and replayable — a deliberate simplicity choice, not an oversight.
- **Proactive, not request/response.** A heartbeat loop (`lib/agent/heartbeat-runner.ts`) runs every 15 minutes with a debounced early-wake on salient events, so the desktop agent can speak first instead of only answering when asked.
- **Evidence is structural, not stylistic.** Every investigative tool call (`query_logs`, `query_metric`, `search_traces`, …) returns an `evidence_ref`; `raise_alert` requires `evidence_refs` + `severity_reasoning`; `merge_incidents`/`split_incident` require `previously_believed`, `now_believes`, `why_changed` — self-revision is logged, never silent.
- **Learning is shared, not siloed.** Skills/playbooks carry a `times_applied` counter (bumped only when actually cited, never used to gate or rank), and a `learning` event type routes lessons straight into long-term memory that every surface reading the desktop's memory can see.

### Key prompts / tool defs
Triage system prompt (`agent/src/agents/triage.js`):
> "You are the detection and triage layer of an autonomous SRE on-call service... Nobody is watching. Nobody asked you to look... Raising zero alerts is a valid and often correct outcome. You are being paid to be right, not to look busy."

Tool schemas:
- `raise_alert(title, service, severity, severity_reasoning, hypothesis, evidence_refs)`
- `declare_incident / attach_alert / merge_incidents / split_incident` — merges/splits require `reasoning, previously_believed, now_believes, why_changed`
- Shared investigative tools: `query_logs`, `query_metric`, `query_metric_range`, `search_traces`, `get_trace`, `list_services`, `get_flag_states`, `load_skill`
- Desktop agent tools (`app/api/agent/route.ts`): `read_desktop`, `begin_takeover`, `restore_layout`, `desktop_act`

## What's NOT production-ready yet
- **Storage won't scale.** File-based NDJSON has no concurrency control and can't survive a multi-instance deployment.
- **Heartbeat is a single-process `setInterval`.** Our own README already flags that a real deployment needs an external cron hitting `/api/heartbeat` instead.
- **Slack is a mock icon, nothing more.** No bot, no webhook receiver.
- **Several desktop apps are fixture, not live** (Files, App Store, compliance surfaces) behind one seam (`lib/api/client.ts`) — honest but incomplete.
- **No real RAG.** "Skills" retrieval is a hand-curated folder of markdown files browsed by name — no embeddings, no semantic search, won't scale past a small library.
- **Thin auth.** `/api/events` ingest is protected by a single shared secret header (`SRE_INGEST_SECRET`), no per-source auth or rotation.
- **Anthropic access path is untested at the SDK level** — model calls to Claude are hardcoded model strings with no `@anthropic-ai/sdk` dependency in `package.json`; worth verifying this actually works end-to-end under load.
- **Test-count story is unreconciled.** Our own engineering docs (`docs/` added in the latest commit) flag a discrepancy between 523, 374, and 186 tests reported in different places — we haven't gone back to fix that yet.

## One thing the real SREonCall product should borrow
The **evidence-ref + forced-reasoning pattern**: every claim the agent makes traces back to a replayable `evidence_ref` from the actual query that produced it, and every time the agent revises its own conclusion (merging or splitting an incident) it's required to state what it previously believed, what it believes now, and why it changed its mind. It's a cheap mechanism — no vector DB, no extra infrastructure — that buys auditability, malleability, and progressive disclosure (headline conclusion, expandable to raw evidence) all at once, and it's the single easiest thing to lift wholesale into a production on-call agent.
