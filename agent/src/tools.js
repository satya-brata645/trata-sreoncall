// Shared tool schemas + dispatcher for both the cheap triage loop and the deep
// investigation loop. Keeping these in one place means both loops cite evidence in the
// exact same shape.

const lgtm = require("./lgtm");
const store = require("./store");
const github = require("./github");
const playbooks = require("./playbooks");

const READ_TOOLS = [
  {
    type: "function",
    function: {
      name: "query_metric",
      description: "Run an arbitrary PromQL instant query against the live Mimir metrics store.",
      parameters: {
        type: "object",
        properties: { promql: { type: "string", description: "A valid PromQL expression." } },
        required: ["promql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_logs",
      description: "Fetch recent log lines for a service from Loki.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string" },
          sinceMinutes: { type: "number", description: "How far back to look. Default 10." },
        },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_error_traces",
      description: "Search Tempo for recent traces flagged as errors for a given service.",
      parameters: {
        type: "object",
        properties: { service: { type: "string" } },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_trace_spans",
      description: "Fetch the full span tree for a specific trace ID (to see which downstream service actually failed).",
      parameters: {
        type: "object",
        properties: { traceId: { type: "string" } },
        required: ["traceId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_related_services",
      description: "List every service currently visible in the shared observability stack (for checking upstream/downstream blast radius).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_metric_names",
      description:
        "Discover which metrics actually exist in this deployment, optionally filtered by substring (e.g. 'kafka', 'cache', 'gc'). Use this instead of guessing metric names — services are written in different languages and export different metric families.",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", description: "Case-insensitive substring to filter metric names by. Omit to list all." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select_playbooks",
      description:
        "Select the investigation playbook(s) whose approach fits what you're seeing, and receive their detailed diagnostic guidance (key signals, query patterns, discriminators, likely root causes). Call this early. You may call it again mid-investigation if the evidence points somewhere different — that re-selection is itself recorded.",
      parameters: {
        type: "object",
        properties: {
          playbookIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs from the catalog. Select more than one if the symptoms span several fault classes.",
          },
          reasoning: { type: "string", description: "Why these fit the evidence you have so far." },
        },
        required: ["playbookIds", "reasoning"],
      },
    },
  },
];

const TRIAGE_TOOLS = [
  {
    type: "function",
    function: {
      name: "flag_for_investigation",
      description:
        "Call this only if a service's current signal digest looks like a real, specific problem worth a deep investigation — not routine noise or a host-wide trend affecting every service equally.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string" },
          reason: { type: "string", description: "What specifically looks wrong, citing the numbers you were given." },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["service", "reason", "confidence"],
      },
    },
  },
];

const EVIDENCE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["metric", "log", "trace"] },
      query: { type: "string", description: "The literal query/selector used." },
      result: { type: "string", description: "The literal value/line/trace-id returned." },
    },
    required: ["type", "query", "result"],
  },
};

const INVESTIGATE_ACTION_TOOLS = [
  {
    type: "function",
    function: {
      name: "open_incident",
      description: "Open a new incident. Only call once you have specific, cited evidence — not a guess.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          service: {
            type: "string",
            description:
              "The ORIGIN service — where the fault actually starts, not the loudest symptom. If service A only fails because downstream B is failing, this is B. Verify with trace spans before deciding.",
          },
          affectedServices: {
            type: "array",
            items: { type: "string" },
            description: "Other services degraded as a consequence (the blast radius). Empty if the fault is contained.",
          },
          severity: { type: "string", enum: ["SEV1", "SEV2", "SEV3", "SEV4"] },
          rootCause: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence: EVIDENCE_SCHEMA,
          recommendedActions: { type: "array", items: { type: "string" } },
          fixType: { type: "string", enum: ["code", "config", "process", "unclear"] },
        },
        required: ["title", "service", "affectedServices", "severity", "rootCause", "confidence", "evidence", "recommendedActions", "fixType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_incident",
      description: "Revise an already-open incident with new evidence. Never overwrites history — this call is itself recorded as a new timeline entry.",
      parameters: {
        type: "object",
        properties: {
          incidentId: { type: "string" },
          revisionReason: { type: "string", description: "What new evidence changed your read, and how." },
          affectedServices: { type: "array", items: { type: "string" }, description: "Updated blast radius, if it changed." },
          severity: { type: "string", enum: ["SEV1", "SEV2", "SEV3", "SEV4"] },
          rootCause: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence: EVIDENCE_SCHEMA,
          recommendedActions: { type: "array", items: { type: "string" } },
          fixType: { type: "string", enum: ["code", "config", "process", "unclear"] },
        },
        required: ["incidentId", "revisionReason", "rootCause", "confidence", "evidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resolve_incident",
      description: "Mark an incident resolved once evidence shows the signal has actually returned to baseline.",
      parameters: {
        type: "object",
        properties: {
          incidentId: { type: "string" },
          summary: { type: "string" },
          resolutionEvidence: EVIDENCE_SCHEMA,
        },
        required: ["incidentId", "summary", "resolutionEvidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "no_incident",
      description: "Call this if, after investigating, the flagged signal turns out to be a false positive.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_fix_pr",
      description:
        "Open a real draft PR on our own prototype repo proposing a concrete fix (runbook, alert-rule config, or documented remediation) tied to this incident. Never merges — draft only.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string" },
          title: { type: "string" },
          body: { type: "string", description: "PR description — must cite the specific evidence behind the proposed fix." },
          fileRelPath: { type: "string", description: "Path within the repo for the proposed file, e.g. runbooks/payment-timeout.md" },
          fileContent: { type: "string" },
        },
        required: ["service", "title", "body", "fileRelPath", "fileContent"],
      },
    },
  },
];

// Raw LGTM responses carry enormous label sets and nested metadata. Anything handed back to
// the model has to stay small enough that a multi-turn loop's growing history doesn't blow the
// per-request token limit — so each response is reduced to its diagnostic content here, with
// SIZE_CAP as a last-resort backstop for anything unexpectedly large.
const SIZE_CAP = 6000;

function capSize(result) {
  const json = JSON.stringify(result);
  if (json.length <= SIZE_CAP) return result;
  return {
    truncated: true,
    note: `Result exceeded ${SIZE_CAP} chars and was truncated. Narrow your query (add label filters, a shorter window, or an aggregation) to see the rest.`,
    preview: json.slice(0, SIZE_CAP),
  };
}

// Keeps only labels that identify a series, dropping host/os/telemetry-sdk boilerplate that
// appears on every sample and would otherwise dominate the payload.
const USEFUL_LABELS = new Set([
  "__name__", "service_name", "container_name", "span_name", "status_code", "http_route",
  "http_request_method", "http_response_status_code", "rpc_method", "rpc_response_status_code",
  "le", "jvm_memory_type", "job",
]);

function compactMetricResult(body) {
  const results = body?.data?.result || [];
  return {
    resultType: body?.data?.resultType,
    seriesCount: results.length,
    series: results.slice(0, 25).map((r) => ({
      labels: Object.fromEntries(Object.entries(r.metric || {}).filter(([k]) => USEFUL_LABELS.has(k))),
      value: r.value?.[1],
      lastValues: r.values ? r.values.slice(-5) : undefined,
    })),
    note: results.length > 25 ? `Showing 25 of ${results.length} series — aggregate (sum by / avg by) to narrow.` : undefined,
  };
}

function compactLogsResult(body) {
  const streams = body?.data?.result || [];
  const lines = [];
  for (const s of streams) {
    for (const [ts, line] of s.values || []) {
      lines.push({ at: new Date(Number(ts) / 1e6).toISOString(), line: String(line).slice(0, 300) });
    }
  }
  lines.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { streamCount: streams.length, lineCount: lines.length, lines: lines.slice(0, 25) };
}

function compactTraceSearch(body) {
  const traces = body?.traces || [];
  return {
    traceCount: traces.length,
    traces: traces.slice(0, 10).map((t) => ({
      traceID: t.traceID,
      rootService: t.rootServiceName,
      rootTrace: t.rootTraceName,
      durationMs: t.durationMs,
    })),
  };
}

async function dispatch(name, args) {
  switch (name) {
    case "query_metric":
      return capSize(compactMetricResult(await lgtm.queryMetric(args.promql)));
    case "query_logs":
      return capSize(compactLogsResult(await lgtm.queryLogsForService(args.service, args.sinceMinutes || 10)));
    case "search_error_traces":
      return capSize(compactTraceSearch(await lgtm.searchErrorTraces(args.service)));
    case "get_trace_spans":
      return capSize(lgtm.summarizeTrace(await lgtm.getTraceSpans(args.traceId)));
    case "list_related_services":
      return lgtm.listServiceNames();
    case "list_metric_names": {
      const body = await lgtm.listMetricNames();
      const all = body.data || [];
      const filtered = args.filter
        ? all.filter((n) => n.toLowerCase().includes(String(args.filter).toLowerCase()))
        : all;
      return { count: filtered.length, totalAvailable: all.length, names: filtered.slice(0, 120) };
    }
    case "select_playbooks":
      return playbooks.getPlaybooks(args.playbookIds || []);
    case "flag_for_investigation":
      return { acknowledged: true, ...args };
    case "open_incident":
      return store.create(args);
    case "update_incident":
      return store.update(args.incidentId, args);
    case "resolve_incident":
      return store.resolve(args.incidentId, args);
    case "no_incident":
      return { acknowledged: true, ...args };
    // Deferred on purpose: the model usually proposes a fix in the same turn it opens the
    // incident, so the incident ID doesn't exist yet and it would have to invent one (it did
    // — passing a literal "createIfNotExists"). We accept the proposal here and let
    // investigate.js open the PR afterwards, once the real incident ID is known.
    case "propose_fix_pr":
      return {
        status: "queued",
        message: "Fix proposal accepted. The draft PR will be opened against the incident once it is recorded.",
        proposal: {
          service: args.service,
          title: args.title,
          body: args.body,
          fileRelPath: args.fileRelPath,
          fileContent: args.fileContent,
        },
      };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { READ_TOOLS, TRIAGE_TOOLS, INVESTIGATE_ACTION_TOOLS, dispatch };
