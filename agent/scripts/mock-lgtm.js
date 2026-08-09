// Controlled evidence source for the malleability demo
// (PLAN-malleability-only-95.md §1). Monkey-patches global.fetch so
// agents/triage.js and agents/correlator.js run COMPLETELY UNMODIFIED —
// only the network layer underneath lgtm.js is swapped, so evidence.js still
// records exactly what it would from a live run.
//
// Scenario: Kafka consumer lag. `checkout` (a real service in this
// deployment) produces order events; `fraud-detection` (part of the real
// OpenTelemetry Demo architecture, though not observed running in this
// trimmed hackathon deployment) consumes them. This is a documented
// assumption, not fabricated nonsense — it matches the real demo's actual
// service graph even where this specific deployment doesn't run every
// consumer service.
const { MIMIR_URL, LOKI_URL, TEMPO_URL, FLAGD_URL } = require("../src/env");

let stage = "active"; // "active" | "recovered"
let nonceCounter = 0;

function setStage(next) {
  if (!["active", "recovered"].includes(next)) throw new Error(`Unknown stage: ${next}`);
  stage = next;
  nonceCounter += 1; // ensures fixture payloads differ pass-to-pass -> different evidence hashes
}

const REAL_FLAGS = [
  { name: "adFailure", defaultVariant: "on", description: "Fail ad service" },
  { name: "adHighCpu", defaultVariant: "off", description: "Triggers high cpu load in the ad service" },
  { name: "adManualGc", defaultVariant: "off", description: "Triggers full manual garbage collections in the ad service" },
  { name: "cartFailure", defaultVariant: "on", description: "Fail cart service n% of the time" },
  { name: "emailMemoryLeak", defaultVariant: "off", description: "Memory leak in the email service." },
  { name: "failedReadinessProbe", defaultVariant: "off", description: "readiness probe failure for cart service" },
  { name: "imageSlowLoad", defaultVariant: "off", description: "slow loading images in the frontend" },
  { name: "intlShippingSlowdown", defaultVariant: "off", description: "Delays international shipping responses" },
  { name: "kafkaQueueProblems", defaultVariant: "off", description: "Overloads Kafka queue while simultaneously introducing a consumer side delay leading to a lag spike" },
  { name: "loadGeneratorTraffic", defaultVariant: "on", description: "Enable synthetic traffic from the load generator." },
  { name: "paymentFailure", defaultVariant: "on", description: "Fail payment service charge requests n%" },
  { name: "paymentUnreachable", defaultVariant: "off", description: "Payment service is unavailable" },
  { name: "productCatalogFailure", defaultVariant: "off", description: "Fail product catalog service on a specific product" },
  { name: "recommendationCacheFailure", defaultVariant: "off", description: "Fail recommendation service cache" },
];

const SERVICES = ["ad", "cart", "checkout", "currency", "email", "frontend-proxy", "fraud-detection",
  "load-generator", "payment", "product-catalog", "quote", "recommendation", "shipping"];

function flagList() {
  return REAL_FLAGS.map((f) =>
    f.name === "kafkaQueueProblems" ? { ...f, defaultVariant: stage === "active" ? "on" : "off" } : f
  );
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function isKafkaRelevant(str) {
  return /kafka|fraud|consumer|lag|queue/i.test(String(str || ""));
}

// ---- Loki -------------------------------------------------------------

function lokiLagLogLine(minutesAgo, lagValue) {
  const ts = Date.now() - minutesAgo * 60_000;
  return [
    String(ts * 1e6),
    JSON.stringify({
      body: `Consumer group lag: ${lagValue} messages behind on topic orders`,
      severity: lagValue > 100 ? "WARN" : "INFO",
      attributes: { "kafka.consumer.group": "fraud-detection-group", "kafka.topic": "orders", lag: lagValue, nonce: nonceCounter },
    }),
  ];
}

function lokiCheckoutLogLine(minutesAgo) {
  const ts = Date.now() - minutesAgo * 60_000;
  return [String(ts * 1e6), JSON.stringify({ body: "order placed", severity: "INFO", attributes: { nonce: nonceCounter } })];
}

function handleLokiQueryRange(query, url) {
  const isVolumeQuery = /count_over_time/.test(query);

  if (isVolumeQuery) {
    // sensor.js's logVolumeByService — one stream per service with a
    // plausible sample count.
    const result = SERVICES.map((svc) => ({
      metric: { service_name: svc },
      stream: { service_name: svc },
      values: [[String(Date.now() * 1e6), String(svc === "fraud-detection" ? 40 : 300)]],
    }));
    return jsonResponse({ status: "success", data: { resultType: "streams", result } });
  }

  if (isKafkaRelevant(query)) {
    const lagValues = stage === "active" ? [120, 480, 850] : [15, 12, 10];
    const values = lagValues.map((v, i) => lokiLagLogLine(6 - i * 2, v));
    return jsonResponse({
      status: "success",
      data: { resultType: "streams", result: [{ stream: { service_name: "fraud-detection" }, values }] },
    });
  }

  if (/checkout/i.test(query)) {
    const values = [0, 1, 2].map((i) => lokiCheckoutLogLine(6 - i * 2));
    return jsonResponse({
      status: "success",
      data: { resultType: "streams", result: [{ stream: { service_name: "checkout" }, values }] },
    });
  }

  // Generic/unrelated query -> quiet baseline, no signal.
  return jsonResponse({ status: "success", data: { resultType: "streams", result: [] } });
}

function handleLokiLabelValues() {
  return jsonResponse({ status: "success", data: SERVICES });
}

// ---- Mimir --------------------------------------------------------------

function handleMimirQuery(query) {
  if (isKafkaRelevant(query)) {
    const value = stage === "active" ? 850 : 10;
    return jsonResponse({ status: "success", data: { resultType: "vector", result: [{ metric: { service_name: "fraud-detection" }, value: [Date.now() / 1000, String(value)] }] } });
  }
  if (/checkout|produc/i.test(query)) {
    // Producer throughput stays flat/normal regardless of stage — this is
    // the discriminator the scenario is built to require noticing.
    return jsonResponse({ status: "success", data: { resultType: "vector", result: [{ metric: { service_name: "checkout" }, value: [Date.now() / 1000, "42"] }] } });
  }
  return jsonResponse({ status: "success", data: { resultType: "vector", result: [] } });
}

function handleMimirQueryRange(query) {
  const points = stage === "active" ? [120, 480, 850] : [15, 12, 10];
  if (isKafkaRelevant(query)) {
    const values = points.map((v, i) => [Date.now() / 1000 - (points.length - i) * 120, String(v)]);
    return jsonResponse({ status: "success", data: { resultType: "matrix", result: [{ metric: { service_name: "fraud-detection" }, values }] } });
  }
  if (/checkout|produc/i.test(query)) {
    const values = [42, 41, 43].map((v, i) => [Date.now() / 1000 - (3 - i) * 120, String(v)]);
    return jsonResponse({ status: "success", data: { resultType: "matrix", result: [{ metric: { service_name: "checkout" }, values }] } });
  }
  return jsonResponse({ status: "success", data: { resultType: "matrix", result: [] } });
}

function handleMimirLabelNames() {
  return jsonResponse({ status: "success", data: ["up", "kafka_consumer_group_lag", "http_server_duration_count", "http_errors_total"] });
}

// ---- Tempo ----------------------------------------------------------------

function handleTempoSearch(tags) {
  if (isKafkaRelevant(tags) && stage === "active") {
    return jsonResponse({
      traces: [
        { traceID: `fdtrace${nonceCounter}`, rootServiceName: "fraud-detection", rootTraceName: "ConsumeOrder", durationMs: 4200 },
      ],
      metrics: { inspectedTraces: 500, inspectedBytes: "10000" },
    });
  }
  return jsonResponse({ traces: [], metrics: { inspectedTraces: 500, inspectedBytes: "10000" } });
}

// ---- dispatcher -----------------------------------------------------------

async function mockFetch(url, opts) {
  const u = String(url);

  if (u.startsWith(LOKI_URL)) {
    const parsed = new URL(u);
    if (u.includes("/query_range")) return handleLokiQueryRange(parsed.searchParams.get("query") || "", u);
    if (u.includes("/label/service_name/values")) return handleLokiLabelValues();
    return jsonResponse({ status: "success", data: { result: [] } });
  }

  if (u.startsWith(MIMIR_URL)) {
    const parsed = new URL(u);
    if (u.includes("/label/__name__/values")) return handleMimirLabelNames();
    if (u.includes("/query_range")) return handleMimirQueryRange(parsed.searchParams.get("query") || "");
    if (u.includes("/query")) return handleMimirQuery(parsed.searchParams.get("query") || "");
    return jsonResponse({ status: "success", data: {} });
  }

  if (u.startsWith(TEMPO_URL)) {
    const parsed = new URL(u);
    if (u.includes("/api/search")) return handleTempoSearch(parsed.searchParams.get("tags") || "");
    if (u.includes("/api/traces/")) return jsonResponse({ batches: [] });
    return jsonResponse({});
  }

  if (u.startsWith(FLAGD_URL)) {
    if (u.includes("/list")) return jsonResponse(flagList());
    return jsonResponse({ ok: true });
  }

  // Anything else (the OpenAI API, etc.) is not part of the mocked surface —
  // pass it through to the real network untouched.
  return realFetch(url, opts);
}

let installed = false;
let realFetch = null;

function install() {
  if (installed) return;
  realFetch = global.fetch;
  global.fetch = mockFetch;
  installed = true;
}

function uninstall() {
  if (!installed) return;
  global.fetch = realFetch;
  installed = false;
}

module.exports = { install, uninstall, setStage, getStage: () => stage };
