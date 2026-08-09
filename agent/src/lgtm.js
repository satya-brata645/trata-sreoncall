// Live observability layer against the shared hackathon LGTM stack.
// Extends starter/lgtm-client.js's raw query primitives with the service-discovery
// and multi-signal digest shapes SREonCall's real lgtm-query.service.ts uses
// (error rate / p99 latency / CPU / memory PromQL, LogQL, TraceQL search).

const path = require("path");
const {
  queryMetric,
  listMetricNames,
  queryLogs,
  searchTraces,
} = require(path.join(__dirname, "..", "..", "starter", "lgtm-client.js"));

const MIMIR_URL = process.env.MANAGED_MIMIR_URL || "http://10.10.1.139:9009";
const TEMPO_URL = process.env.MANAGED_TEMPO_URL || "http://10.10.1.139:3200";
const ORG_ID = process.env.MANAGED_LGTM_ORG_ID || "hackathon";
const headers = { "X-Scope-OrgID": ORG_ID };

// PromQL metric name + fallback chains, mirroring lgtm-query.service.ts's getServiceHealth.
// `OR vector(0)` guards against Prometheus returning an empty vector (not zero) when a
// filtered series — e.g. 5xx responses — genuinely has no matching samples (a healthy service).
const ERROR_RATE_QUERIES = (svc) => [
  // Span metrics come from the collector's spanmetrics connector, so they exist for every
  // service regardless of language/protocol — including Node services like payment, which
  // emit no http_server_* or rpc_server_* series at all. Tried first for that reason.
  `100 * (sum(rate(traces_span_metrics_calls_total{service_name="${svc}",status_code="STATUS_CODE_ERROR"}[5m])) OR vector(0)) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="${svc}"}[5m])), 1)`,
  `100 * (sum(rate(http_server_request_duration_seconds_count{service_name="${svc}",http_response_status_code=~"5.."}[5m])) OR vector(0)) / clamp_min(sum(rate(http_server_request_duration_seconds_count{service_name="${svc}"}[5m])), 1)`,
  // gRPC services (Go/Java backends like checkout) report rpc_response_status_code
  // as a string ("OK" | "INTERNAL" | ...) instead of an HTTP status code.
  `100 * (sum(rate(rpc_server_call_duration_seconds_count{service_name="${svc}",rpc_response_status_code!="OK"}[5m])) OR vector(0)) / clamp_min(sum(rate(rpc_server_call_duration_seconds_count{service_name="${svc}"}[5m])), 1)`,
];
// Long-lived streaming spans (flagd's EventStream is open for the process lifetime) sit at
// tens of seconds by design. Left in, they dominate p99 and make every service look like it
// has a latency incident — so they're excluded from the latency signal, not from anything else.
const STREAMING_SPAN_EXCLUSION = 'span_name!~".*EventStream.*|.*Watch.*|.*Subscribe.*"';
const LATENCY_P99_QUERIES = (svc) => [
  `histogram_quantile(0.99, sum(rate(traces_span_metrics_duration_milliseconds_bucket{service_name="${svc}",${STREAMING_SPAN_EXCLUSION}}[5m])) by (le))`,
  `1000 * histogram_quantile(0.99, sum(rate(http_server_request_duration_seconds_bucket{service_name="${svc}"}[5m])) by (le))`,
  `1000 * histogram_quantile(0.99, sum(rate(rpc_server_call_duration_seconds_bucket{service_name="${svc}"}[5m])) by (le))`,
];
// Container-level metrics (keyed by container_name, not service_name) work uniformly across
// every language runtime in the demo (dotnet/go/java/js) — app-runtime metrics like
// jvm_cpu_recent_utilization_ratio only exist for the one or two JVM services.
const CPU_QUERIES = (svc) => [
  `100 * avg(container_cpu_utilization_ratio{container_name="${svc}"})`,
  `100 * avg(jvm_cpu_recent_utilization_ratio{service_name="${svc}"})`,
  `100 * avg(rate(process_cpu_seconds_total{service_name="${svc}"}[5m]))`,
];
const MEM_QUERIES = (svc) => [
  `100 * avg(container_memory_percent_ratio{container_name="${svc}"})`,
  `100 * sum(jvm_memory_used_bytes{service_name="${svc}",jvm_memory_type="heap"}) / clamp_min(sum(jvm_memory_committed_bytes{service_name="${svc}",jvm_memory_type="heap"}), 1)`,
];

async function queryRange(promql, sinceMinutes = 30, stepSeconds = 60) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - sinceMinutes * 60;
  const url = `${MIMIR_URL}/prometheus/api/v1/query_range?query=${encodeURIComponent(
    promql
  )}&start=${start}&end=${end}&step=${stepSeconds}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Mimir range query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Tries each fallback query in order, returns the first that yields a non-empty series.
async function queryRangeWithFallback(queries, sinceMinutes) {
  for (const q of queries) {
    try {
      const result = await queryRange(q, sinceMinutes);
      const series = result?.data?.result ?? [];
      if (series.length > 0 && series.some((s) => s.values?.length > 0)) {
        return { query: q, series };
      }
    } catch {
      // try next fallback
    }
  }
  return { query: queries[0], series: [] };
}

async function listServiceNames() {
  const url = `${MIMIR_URL}/prometheus/api/v1/label/service_name/values`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Mimir service_name label query failed: ${res.status}`);
  const body = await res.json();
  return (body.data || []).filter(Boolean);
}

// Pulls all 4 signals for one service over the trailing window, as raw time series
// (query + series) — the caller (baseline.js) turns these into z-scores.
async function getServiceDigest(service, sinceMinutes = 30) {
  const [errorRate, latencyP99, cpu, mem] = await Promise.all([
    queryRangeWithFallback(ERROR_RATE_QUERIES(service), sinceMinutes),
    queryRangeWithFallback(LATENCY_P99_QUERIES(service), sinceMinutes),
    queryRangeWithFallback(CPU_QUERIES(service), sinceMinutes),
    queryRangeWithFallback(MEM_QUERIES(service), sinceMinutes),
  ]);
  return { service, errorRate, latencyP99, cpu, mem };
}

async function queryLogsForService(service, sinceMinutes = 10, limit = 20) {
  const start = (Date.now() - sinceMinutes * 60 * 1000) * 1e6;
  const url = `${process.env.MANAGED_LOKI_URL || "http://10.10.1.139:3100"}/loki/api/v1/query_range?query=${encodeURIComponent(
    `{service_name="${service}"}`
  )}&start=${start}&limit=${limit}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Loki query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function searchErrorTraces(service, limit = 5) {
  const url = `${TEMPO_URL}/api/search?tags=${encodeURIComponent(
    `service.name=${service} error=true`
  )}&limit=${limit}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Tempo error-trace search failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getTraceSpans(traceId) {
  const url = `${TEMPO_URL}/api/traces/${encodeURIComponent(traceId)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Tempo trace lookup failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// A full OTLP trace is tens of thousands of tokens of nested JSON — far too large to hand to
// the model (it blows the per-request token limit on its own). This flattens it to the part
// that actually carries diagnostic signal: which service ran which span, how long it took,
// and — critically — the status message on failing spans, which is where the application's
// own error text lives.
function summarizeTrace(traceJson) {
  const batches = traceJson.batches || traceJson.resourceSpans || [];
  const spans = [];
  for (const batch of batches) {
    const service =
      (batch.resource?.attributes || []).find((a) => a.key === "service.name")?.value?.stringValue || "unknown";
    for (const scope of batch.scopeSpans || batch.instrumentationLibrarySpans || []) {
      for (const s of scope.spans || []) {
        const durationMs =
          s.endTimeUnixNano && s.startTimeUnixNano
            ? Number((BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)) / 1000000n)
            : null;
        spans.push({
          service,
          span: s.name,
          status: s.status?.code === 2 || s.status?.code === "STATUS_CODE_ERROR" ? "ERROR" : "OK",
          statusMessage: s.status?.message || undefined,
          durationMs,
        });
      }
    }
  }
  const errors = spans.filter((s) => s.status === "ERROR");
  const slowest = [...spans].sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0)).slice(0, 8);
  return {
    totalSpans: spans.length,
    servicesInvolved: [...new Set(spans.map((s) => s.service))],
    errorSpans: errors.slice(0, 15),
    errorSpanCount: errors.length,
    slowestSpans: slowest,
  };
}

module.exports = {
  queryMetric,
  listMetricNames,
  queryLogs,
  searchTraces,
  queryRange,
  listServiceNames,
  getServiceDigest,
  queryLogsForService,
  searchErrorTraces,
  getTraceSpans,
  summarizeTrace,
};
