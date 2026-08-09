// Runs once per poll tick. Builds one compact digest across every discovered service and
// asks the LLM which (if any) genuinely warrant a deep investigation — the model decides,
// not a fixed z-score threshold, so it can weigh things like "every service's CPU is up
// equally, that's host-wide noise, not a per-service incident" (see src/baseline.js).

const lgtm = require("./lgtm");
const baseline = require("./baseline");
const { runToolLoop } = require("./openaiClient");
const { TRIAGE_TOOLS, dispatch } = require("./tools");

const SKIP_SERVICES = new Set(["flagd", "flagd-ui", "telemetry-docs", "load-generator", "otelcol-contrib"]);
const CHEAP_MODEL = process.env.OPENAI_TRIAGE_MODEL || "gpt-4o-mini";

async function buildDigest() {
  const services = (await lgtm.listServiceNames()).filter((s) => !SKIP_SERVICES.has(s));
  const digests = await Promise.all(
    services.map(async (service) => {
      try {
        const raw = await lgtm.getServiceDigest(service);
        return baseline.scoreDigest(raw);
      } catch {
        return { service, metrics: {} };
      }
    })
  );
  return digests.filter((d) => Object.keys(d.metrics).length > 0);
}

// For every metric we track, only an INCREASE is bad — a falling error rate or falling p99 is
// a recovery, not an incident. Scoring on signed z (not |z|) stops the agent from "detecting"
// its own good news, which it did before this was added.
const WIDESPREAD_Z = 1.5; // a metric counts as "elevated" for fleet-share purposes above this
const WIDESPREAD_SHARE = 0.35; // if >= this fraction of services share an elevated metric, flag it as fleet-wide

// Computes, per metric, what fraction of services currently show |z| above WIDESPREAD_Z —
// this is the arithmetic the LLM was failing to eyeball reliably from 14 raw digest lines.
// Doing the comparison in code and handing over the verdict is more auditable than asking a
// small model to infer "is this shared?" from a wall of numbers.
function computeFleetStats(digests) {
  const byMetric = {};
  for (const d of digests) {
    for (const [metric, s] of Object.entries(d.metrics)) {
      byMetric[metric] = byMetric[metric] || [];
      byMetric[metric].push({ service: d.service, z: s.z });
    }
  }
  const stats = {};
  for (const [metric, entries] of Object.entries(byMetric)) {
    const elevated = entries.filter((e) => e.z > WIDESPREAD_Z);
    stats[metric] = {
      total: entries.length,
      elevatedCount: elevated.length,
      elevatedServices: elevated.map((e) => e.service),
      widespread: entries.length > 0 && elevated.length / entries.length >= WIDESPREAD_SHARE,
    };
  }
  return stats;
}

function formatFleetStats(fleetStats) {
  return Object.entries(fleetStats)
    .map(([metric, s]) => {
      const verdict = s.widespread
        ? `WIDESPREAD (${s.elevatedCount}/${s.total} services elevated: ${s.elevatedServices.join(", ")}) — likely host-wide noise, not a per-service incident`
        : `isolated (${s.elevatedCount}/${s.total} services elevated${s.elevatedServices.length ? ": " + s.elevatedServices.join(", ") : ""})`;
      return `- ${metric}: ${verdict}`;
    })
    .join("\n");
}

function formatDigest(digests) {
  return digests
    .map((d) => {
      const parts = Object.entries(d.metrics).map(
        ([metric, s]) => `${metric}: current=${s.current.toFixed(2)} z=${s.z} (baseline ${s.baselineMean.toFixed(2)}±${s.baselineStddev.toFixed(2)})`
      );
      return `- ${d.service}: ${parts.join(", ")}`;
    })
    .join("\n");
}

// Returns an array of { service, reason, confidence } for services worth investigating.
async function runTriageTick(openIncidentServices = []) {
  const digests = await buildDigest();
  const digestText = formatDigest(digests);
  const fleetStats = computeFleetStats(digests);
  const fleetText = formatFleetStats(fleetStats);

  const system = `You are the triage layer of an SRE agent watching the OpenTelemetry Demo app via live Mimir metrics.
Every tick you see a z-score digest (current value vs trailing-30-minute baseline) for every service, plus a
fleet-wide summary that has already done the "is this shared or isolated?" arithmetic for you per metric.
Call flag_for_investigation only for a service whose elevated metric is marked "isolated" in the fleet-wide
summary, or whose elevation is far more extreme than the rest of the "WIDESPREAD" group it's part of (e.g.
error rate spiking on one service while every other service's error rate is flat). Do NOT flag a service
solely because it appears in a metric's WIDESPREAD elevated-services list — that arithmetic already tells
you it's a shared trend, not a per-service incident, so treat that as a reason to skip it, not investigate it.
For every metric here, only an INCREASE is bad. A NEGATIVE z-score means the metric went DOWN — lower error
rate, lower latency, lower resource use — which is a recovery or an improvement. Never flag a negative z as
a problem. The one exception: if an open incident's error rate has dropped back to baseline, that is worth
flagging so the investigation loop can verify and resolve it.
Services with an incident already open: ${openIncidentServices.join(", ") || "(none)"} — for these, flag
again only if the digest shows something materially different from before (getting worse, better, or a
different symptom), since that's what lets the investigation loop decide whether to revise or resolve.
If nothing warrants investigation, call no tool at all.`;

  const userMessage = `Fleet-wide summary (per metric, computed across all services this tick):\n${fleetText}\n\nPer-service digest (z-scores relative to each service's own trailing 30-minute window):\n${digestText}`;

  const result = await runToolLoop({
    system,
    userMessage,
    tools: TRIAGE_TOOLS,
    dispatch,
    terminalToolNames: [], // triage never ends the process; every flag call matters, collect them all
    maxTurns: 1,
    model: CHEAP_MODEL,
  });

  return result.toolCallLog
    .filter((c) => c.name === "flag_for_investigation")
    .map((c) => c.args);
}

module.exports = { runTriageTick, buildDigest, formatDigest };
