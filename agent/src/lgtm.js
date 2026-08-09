// Query layer for the shared hackathon LGTM stack — extends
// starter/lgtm-client.js with range queries and trace-by-id lookup.
//
// PLAN NOTE (§0 / §12 step 1): this file only fetches, parses, and
// normalizes. It never decides whether something is wrong — that judgment
// lives entirely in agents/triage.js and agents/correlator.js.
const { MIMIR_URL, LOKI_URL, TEMPO_URL, ORG_ID } = require("./env");

const headers = { "X-Scope-OrgID": ORG_ID };

// Known trap (docs/02, PROMPT §4): Loki labels services as
// "opentelemetry-demo/<service>", Mimir and Tempo use the bare name. Every
// caller of this module works in bare names; we normalize at the edges so
// cross-signal joins never silently go empty.
const LOKI_PREFIX = "opentelemetry-demo/";

function toBareServiceName(lokiServiceName) {
  return lokiServiceName.startsWith(LOKI_PREFIX)
    ? lokiServiceName.slice(LOKI_PREFIX.length)
    : lokiServiceName;
}

function toLokiServiceName(bareServiceName) {
  return bareServiceName.startsWith(LOKI_PREFIX)
    ? bareServiceName
    : `${LOKI_PREFIX}${bareServiceName}`;
}

// LIVE TRAP CONFIRMED (matches PROMPT §4's warning exactly): Loki's actual
// service_name label value is "opentelemetry-demo/<service>". A query like
// {service_name="cartservice"} — the natural, bare form anyone (including
// the triage agent, which authors its own LogQL) would write — silently
// matches nothing. Rather than trust every caller to remember the prefix,
// rewrite service_name selectors here so both forms work. This is label
// plumbing, not judgment: it doesn't decide what's abnormal, it just makes
// sure "cartservice" and "opentelemetry-demo/cartservice" mean the same
// query, always.
function normalizeServiceNameSelectors(logql) {
  // Only rewrite exact-match selectors (service_name="literal"). Anything
  // already written as a regex (=~) — including the sensor's own broad
  // {service_name=~".+"} sweep — is left untouched: it's either already a
  // deliberate pattern, or (as with ".+") already prefix-agnostic by
  // construction, so rewriting it would only risk corrupting it.
  return logql.replace(/service_name\s*=\s*"([^"]*)"/g, (match, value) => {
    if (value.includes(LOKI_PREFIX)) return match;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return `service_name=~"(${LOKI_PREFIX})?${escaped}"`;
  });
}

async function fetchJson(url, what) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function queryMetric(promql) {
  const url = `${MIMIR_URL}/prometheus/api/v1/query?query=${encodeURIComponent(promql)}`;
  return fetchJson(url, "Mimir instant query");
}

async function queryMetricRange(promql, sinceMinutes = 15, stepSeconds = 30) {
  const end = Date.now() / 1000;
  const start = end - sinceMinutes * 60;
  const url =
    `${MIMIR_URL}/prometheus/api/v1/query_range?query=${encodeURIComponent(promql)}` +
    `&start=${start}&end=${end}&step=${stepSeconds}`;
  return fetchJson(url, "Mimir range query");
}

async function listMetricNames() {
  return fetchJson(`${MIMIR_URL}/prometheus/api/v1/label/__name__/values`, "Mimir label query");
}

async function queryLogs(logqlSelector, sinceMinutes = 10, limit = 100) {
  const normalizedQuery = normalizeServiceNameSelectors(logqlSelector);
  const start = Math.floor((Date.now() - sinceMinutes * 60 * 1000) * 1e6); // ns
  const url =
    `${LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(normalizedQuery)}` +
    `&start=${start}&limit=${limit}`;
  const raw = await fetchJson(url, "Loki query_range");
  return normalizeLokiResult(raw);
}

// Strips the opentelemetry-demo/ prefix off every stream's service_name label
// so callers never have to think about which store they're reading from.
function normalizeLokiResult(raw) {
  const result = raw?.data?.result ?? [];
  for (const stream of result) {
    if (stream.stream?.service_name) {
      stream.stream.service_name = toBareServiceName(stream.stream.service_name);
    }
  }
  return raw;
}

async function searchTraces(tagFilter, limit = 5) {
  const url = `${TEMPO_URL}/api/search?tags=${encodeURIComponent(tagFilter)}&limit=${limit}`;
  return fetchJson(url, "Tempo search");
}

async function getTrace(traceId) {
  const url = `${TEMPO_URL}/api/traces/${encodeURIComponent(traceId)}`;
  return fetchJson(url, "Tempo trace lookup");
}

// Volume shape across every service in one shot — used by the sensor for its
// broad sweep. Uses the LOKI-prefixed matcher internally, returns bare names.
async function logVolumeByService(sinceMinutes = 5) {
  const query = `sum by (service_name) (count_over_time({service_name=~".+"}[${sinceMinutes}m]))`;
  const url =
    `${LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(query)}` +
    `&start=${Math.floor((Date.now() - sinceMinutes * 60 * 1000) * 1e6)}&limit=1000`;
  const res = await fetchJson(url, "Loki volume query");
  const out = {};
  for (const stream of res?.data?.result ?? []) {
    const name = toBareServiceName(stream.metric?.service_name || stream.stream?.service_name || "unknown");
    const lastSample = stream.values?.[stream.values.length - 1];
    out[name] = lastSample ? Number(lastSample[1]) : 0;
  }
  return out;
}

async function listServices() {
  const url = `${LOKI_URL}/loki/api/v1/label/service_name/values`;
  const raw = await fetchJson(url, "Loki service_name label values");
  return (raw?.data ?? []).map(toBareServiceName);
}

module.exports = {
  toBareServiceName,
  toLokiServiceName,
  queryMetric,
  queryMetricRange,
  listMetricNames,
  queryLogs,
  searchTraces,
  getTrace,
  logVolumeByService,
  listServices,
};

// Self-test when run directly: node src/lgtm.js
if (require.main === module) {
  (async () => {
    console.log(`Connecting to LGTM stack as tenant "${ORG_ID}"...`);
    const names = await listMetricNames();
    console.log(`Mimir: ${names.data.length} metric names available`);
    const services = await listServices();
    console.log(`Loki: ${services.length} services seen — ${services.join(", ")}`);
    const logs = await queryLogs('{service_name=~".+"}', 10, 5);
    console.log(`Loki: ${logs.data?.result?.length ?? 0} log stream(s) in the last 10 minutes`);
    const traces = await searchTraces("service.name=frontend-web");
    console.log(`Tempo: ${traces.traces?.length ?? 0} recent trace(s) found`);
    console.log("All three signal types reachable. Query layer OK.");
  })().catch((err) => {
    console.error("Connection failed:", err.message);
    process.exit(1);
  });
}
