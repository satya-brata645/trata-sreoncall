// Shared read-only investigative tools (query logs/metrics/traces/flags,
// load a skill) used by BOTH triage.js and correlator.js. Extracted so the
// correlator isn't limited to whatever alerts happen to say — it can check
// for itself whether an incident's evidence has actually changed, which is
// required by §7: "never resolve because an alert stopped firing, only
// because you can point to evidence of recovery."
//
// PLAN NOTE: same as sensor.js/lgtm.js — this file only fetches, records to
// the evidence store, and returns. No judgment lives here.
const lgtm = require("../lgtm");
const evidence = require("../evidence");
const sensor = require("../sensor");
const skills = require("../skills/loader");

const INVESTIGATIVE_TOOLS = [
  {
    name: "query_logs",
    description: "Run an arbitrary LogQL query against Loki. Returns raw log lines, unmodified.",
    input_schema: {
      type: "object",
      properties: {
        logql: { type: "string", description: 'LogQL selector, e.g. {service_name="cartservice"}' },
        since_minutes: { type: "number", description: "How far back to look. You choose this — widen it if you need more context." },
      },
      required: ["logql"],
    },
  },
  {
    name: "query_metric",
    description:
      'Run an instant PromQL query against Mimir (Prometheus-compatible). PromQL only — e.g. \'up\', \'rate(http_server_duration_count[5m])\'. Do NOT pass LogQL log-selector syntax like {service_name="x"} |= "error" here; use query_logs for that.',
    input_schema: {
      type: "object",
      properties: { promql: { type: "string" } },
      required: ["promql"],
    },
  },
  {
    name: "query_metric_range",
    description: "Run a PromQL range query against Mimir to see how a metric moved over time. PromQL only, same constraint as query_metric.",
    input_schema: {
      type: "object",
      properties: { promql: { type: "string" }, since_minutes: { type: "number" } },
      required: ["promql"],
    },
  },
  {
    name: "search_traces",
    description: "Search Tempo for traces matching a tag filter, e.g. 'service.name=cartservice error=true'.",
    input_schema: {
      type: "object",
      properties: { tag_filter: { type: "string" }, limit: { type: "number" } },
      required: ["tag_filter"],
    },
  },
  {
    name: "get_trace",
    description: "Fetch a single trace by its trace ID for detailed span inspection.",
    input_schema: {
      type: "object",
      properties: { trace_id: { type: "string" } },
      required: ["trace_id"],
    },
  },
  {
    name: "list_services",
    description: "List every service name currently visible in telemetry.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_flag_states",
    description: "Get current feature-flag states from flagd — the closest thing to a change/deploy feed in this environment.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "load_skill",
    description: "Load the full body of a skill by name.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
];

// The evidence store always keeps the untouched raw response (auditability
// requires the literal bytes be replayable). What goes back to the model in
// the tool result is trimmed for size — log lines here carry large
// per-line "resources" blobs (host CPU/arch metadata etc.) that are
// irrelevant to judgment and were blowing multi-turn conversations past the
// token budget. This is presentation trimming, not scope narrowing: the
// full data is still fetched and still stored, still reachable via
// evidence_ref, and the model can always issue a more specific follow-up
// query itself if it needs something this trimmed view left out.
const MAX_MODEL_CHARS = 4000;

function slimForModel(raw) {
  let slim = raw;
  if (raw?.data?.result) {
    // Loki query_range shape: strip the bulky "resources" object out of
    // each log line's JSON body, keep everything judgment-relevant.
    slim = {
      ...raw,
      data: {
        ...raw.data,
        result: raw.data.result.map((stream) => ({
          stream: stream.stream,
          values: (stream.values || []).map(([ts, line]) => {
            try {
              const parsed = JSON.parse(line);
              delete parsed.resources;
              return [ts, JSON.stringify(parsed)];
            } catch {
              return [ts, line];
            }
          }),
        })),
      },
    };
  }
  const text = JSON.stringify(slim);
  if (text.length <= MAX_MODEL_CHARS) return slim;
  return { truncated: true, note: `Response truncated to ${MAX_MODEL_CHARS} chars for context size — narrow your query (fewer minutes, more specific selector) for full detail.`, preview: text.slice(0, MAX_MODEL_CHARS) };
}

function buildInvestigativeToolImpls({ services } = {}) {
  function wrap(kind, query, promise) {
    return promise.then((raw) => {
      const ref = evidence.record({ kind, query, raw });
      return { evidence_ref: ref, data: slimForModel(raw) };
    });
  }
  return {
    query_logs: async ({ logql, since_minutes }) => wrap("log", logql, lgtm.queryLogs(logql, since_minutes || 10, 20)),
    query_metric: async ({ promql }) => wrap("metric", promql, lgtm.queryMetric(promql)),
    query_metric_range: async ({ promql, since_minutes }) =>
      wrap("metric", promql, lgtm.queryMetricRange(promql, since_minutes || 15)),
    search_traces: async ({ tag_filter, limit }) => wrap("trace", tag_filter, lgtm.searchTraces(tag_filter, limit || 5)),
    get_trace: async ({ trace_id }) => wrap("trace", `trace_id=${trace_id}`, lgtm.getTrace(trace_id)),
    list_services: async () => ({ services: services || (await lgtm.listServices()) }),
    get_flag_states: async () => wrap("flag", "flagd:/list", sensor.getFlagStates()),
    load_skill: async ({ name }) => {
      const skill = skills.loadByName(name);
      return skill ? { name: skill.name, body: skill.body } : { error: `No skill named "${name}"` };
    },
  };
}

module.exports = { INVESTIGATIVE_TOOLS, buildInvestigativeToolImpls };
