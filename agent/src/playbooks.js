// Investigation playbooks — a library of named diagnostic approaches the agent chooses
// between at investigation time.
//
// Two deliberate design rules:
//
// 1. These are keyed to generic SRE FAULT CLASSES (error spike, latency regression, resource
//    exhaustion, ...), never to the demo's specific fault-injection flag names. docs/04 warns
//    that the flags used for judging aren't revealed until code freeze, so anything keyed to
//    `paymentFailure` et al would be hardcoding to a fault we happen to have seen.
//
// 2. They are GUIDANCE the model selects and may deviate from — not a script it executes.
//    The LLM picks which playbooks apply (and can re-pick mid-investigation as evidence
//    changes); nothing here branches on its own. That keeps the reasoning load-bearing
//    rather than turning the agent into an if/else tree wearing a prompt.
//
// Query patterns below use the metric families verified to exist in this deployment — span
// metrics (universal across languages) first, container metrics keyed on container_name.

const PLAYBOOKS = {
  "error-spike": {
    title: "Error rate spike",
    whenToUse:
      "A service's error rate is elevated above its own baseline — requests are failing outright.",
    keySignals: [
      "traces_span_metrics_calls_total with status_code=STATUS_CODE_ERROR climbing",
      "Error traces present in Tempo for this service",
      "Log lines containing exception/error text correlated in time",
    ],
    queryPatterns: [
      'Which operations are failing (not just the service overall): sum by (span_name) (rate(traces_span_metrics_calls_total{service_name="<svc>",status_code="STATUS_CODE_ERROR"}[5m]))',
      'Error share vs total: sum(rate(traces_span_metrics_calls_total{service_name="<svc>",status_code="STATUS_CODE_ERROR"}[5m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="<svc>"}[5m])), 1)',
      "Pull an actual failing trace via search_error_traces, then get_trace_spans on its ID to see the failing span's status message",
    ],
    discriminators: [
      "Is this service the CAUSE or a VICTIM? Check whether its downstream dependencies are erroring first — if a downstream is failing, the real incident is there and this service is collateral.",
      "Is the failure concentrated on one operation/span_name, or spread across all of them? One operation suggests a specific code path; all of them suggests the whole service or its runtime.",
      "Does the error rate correlate with a deploy, a traffic change, or neither?",
    ],
    commonRootCauses: [
      "A downstream dependency returning errors or timing out",
      "A specific code path failing on certain inputs (one product, one currency, one region)",
      "Resource exhaustion causing the service to reject work",
      "Misconfiguration or a bad feature-flag/config value",
    ],
    fixGuidance:
      "If failures trace to a specific code path or missing error handling, fixType is 'code'. If a threshold/timeout/flag value is wrong, fixType is 'config'.",
  },

  "latency-regression": {
    title: "Latency regression",
    whenToUse:
      "p99/p95 latency is climbing for a service without a matching error-rate increase — requests succeed but are slow.",
    keySignals: [
      "traces_span_metrics_duration_milliseconds_bucket p99 rising vs baseline",
      "Slow spans visible in Tempo traces",
      "Often paired with CPU/GC/queue pressure on the same or a downstream service",
    ],
    queryPatterns: [
      'p99 by operation: histogram_quantile(0.99, sum by (le, span_name) (rate(traces_span_metrics_duration_milliseconds_bucket{service_name="<svc>"}[5m])))',
      "Compare p50 vs p99 — if only p99 moved, it's a tail problem (contention, GC, a slow dependency on some requests); if both moved, it's systemic.",
      "Walk a slow trace with get_trace_spans to find which child span consumes the time",
    ],
    discriminators: [
      "Is the time spent IN this service, or waiting on a downstream call? Trace spans answer this definitively — do not guess.",
      "Tail-only (p99 up, p50 flat) vs systemic (both up) points at very different causes.",
      "Did throughput rise at the same time? Latency under increased load is capacity, not a defect.",
    ],
    commonRootCauses: [
      "A downstream dependency slowed down (the real incident is there)",
      "GC pauses or memory pressure in this service's runtime",
      "Cache degradation shifting load onto a slower backing store",
      "Lock contention or connection-pool saturation",
    ],
    fixGuidance:
      "Usually 'config' (pool sizes, timeouts, cache TTL) or 'code' (an N+1 call pattern, a missing index). Say which, and why.",
  },

  "resource-exhaustion": {
    title: "Resource exhaustion (memory leak, CPU saturation, GC pressure)",
    whenToUse:
      "A service's memory or CPU is climbing on a trend, or GC activity is elevated — especially if the climb is monotonic rather than spiky.",
    keySignals: [
      'container_memory_percent_ratio{container_name="<svc>"} trending up without recovering',
      'container_cpu_utilization_ratio{container_name="<svc>"} saturating',
      "Runtime metrics: jvm_gc_duration_seconds_*, v8js_gc_duration_seconds_*, v8js_memory_heap_used_bytes, nodejs_eventloop_delay_*",
    ],
    queryPatterns: [
      'Memory trend over a long window, not a snapshot: container_memory_percent_ratio{container_name="<svc>"}',
      "GC pressure (runtime-dependent — use list_metric_names to find what this service actually emits): rate(jvm_gc_duration_seconds_sum[5m]) or rate(v8js_gc_duration_seconds_sum[5m])",
      "Event-loop lag for Node services: nodejs_eventloop_delay_p99_seconds",
    ],
    discriminators: [
      "CRITICAL: is this service alone, or is every service showing the same shift? A fleet-wide move is host/node-level, not a per-service incident — the triage layer's fleet summary already tells you which.",
      "Monotonic climb that never recovers = leak. Sawtooth that recovers after GC = normal. Step change = a config/deploy change.",
      "Does the resource climb PRECEDE the latency/error symptoms, or follow them? Order tells you cause vs effect.",
    ],
    commonRootCauses: [
      "An unbounded cache or collection growing without eviction (classic leak)",
      "Connection/handle leak",
      "A workload change (larger payloads, more concurrency) exceeding the configured limit",
      "Undersized container limits for actual traffic",
    ],
    fixGuidance:
      "A true leak is 'code'. An undersized limit is 'config'. Do not claim a leak unless the trend is monotonic over a meaningful window — cite the actual values.",
  },

  "dependency-failure": {
    title: "Downstream dependency failure (blast radius)",
    whenToUse:
      "Multiple services are degraded at once, or a service is failing but its own resources look healthy — suspect a shared downstream.",
    keySignals: [
      "Several services degrading in the same window",
      "A service erroring while its CPU/memory are unremarkable",
      "Trace spans showing failures originating in a child span from another service",
    ],
    queryPatterns: [
      "Compare error rates across all services in one query: sum by (service_name) (rate(traces_span_metrics_calls_total{status_code=\"STATUS_CODE_ERROR\"}[5m]))",
      "Use list_related_services, then check the suspected downstream directly",
      "get_trace_spans on a failing trace — the deepest span that first shows an error status is the origin",
    ],
    discriminators: [
      "Find the ORIGIN, not the loudest symptom. The service with the most alarming numbers is often the victim, not the cause — frontend errors usually mean something behind it broke.",
      "Follow the trace, not the metric. Trace spans establish the call direction; metrics alone cannot.",
      "If two unrelated faults are active at once, attribute each symptom to its own cause rather than merging them into one story.",
    ],
    commonRootCauses: [
      "A single backing service failing and fanning out",
      "A shared datastore/cache degraded",
      "Network/DNS issues between services",
      "Cascading timeouts and retry amplification",
    ],
    fixGuidance:
      "The incident belongs to the ORIGIN service. Name the victims in the blast radius, but set `service` to the cause.",
  },

  "cache-degradation": {
    title: "Cache degradation",
    whenToUse:
      "A cache-fronted service shows rising latency or rising load on its backing store, without an obvious error spike.",
    keySignals: [
      "Latency up on the cached path while the backing service's request rate rises",
      "Request rate to the backing store climbing without a matching increase in user traffic",
    ],
    queryPatterns: [
      "Compare the service's inbound rate vs its outbound calls to the backing store — a widening gap means cache misses",
      "Use list_metric_names with a 'cache' filter to find whether hit/miss counters are exported for this service",
    ],
    discriminators: [
      "Rising backing-store load with FLAT user traffic is the signature — if user traffic also rose, it's just load.",
      "Distinguish cache unavailable (errors) from cache ineffective (misses, no errors).",
    ],
    commonRootCauses: [
      "Cache service unavailable, so every request falls through",
      "TTL misconfiguration causing mass expiry",
      "Cache key cardinality change destroying hit rate",
    ],
    fixGuidance: "Usually 'config' (TTL, size, connection settings); 'code' if the key strategy is wrong.",
  },

  "queue-backlog": {
    title: "Queue backlog / consumer lag",
    whenToUse:
      "An async pipeline is falling behind — producers outpacing consumers, or a consumer stalled.",
    keySignals: [
      "Consumer lag metrics climbing",
      "Downstream effects appearing delayed rather than immediately",
    ],
    queryPatterns: [
      "Use list_metric_names with 'kafka', 'queue', or 'consumer' to discover what this deployment actually exports before assuming metric names",
      "Check both producer and consumer rates — a growing gap is the backlog",
    ],
    discriminators: [
      "Is the consumer slow, or the producer unusually fast? Both create lag but need opposite fixes.",
      "Backlog effects are DELAYED — correlate against when the backlog started, not when symptoms appeared.",
    ],
    commonRootCauses: [
      "Consumer crashed, stalled, or scaled down",
      "A poison message blocking progress",
      "Producer burst exceeding consumer throughput",
    ],
    fixGuidance: "'config' for scaling/throughput settings, 'code' for poison-message handling.",
  },

  "recovery-check": {
    title: "Recovery verification",
    whenToUse:
      "An incident is already open for this service and you need to decide whether it has actually recovered, worsened, or changed character.",
    keySignals: [
      "The originally-cited metric returning to its pre-incident baseline",
      "Error traces no longer being produced",
    ],
    queryPatterns: [
      "Re-run the EXACT query cited in the open incident's evidence and compare against the value recorded there",
      "Confirm recovery has held for more than one sample before resolving — a single good data point is not recovery",
    ],
    discriminators: [
      "Recovered vs briefly-quiet: require the signal to hold at baseline across several samples.",
      "Genuinely fixed vs traffic simply stopped — if the denominator (total requests) collapsed, a falling error RATE is an artifact, not a recovery. Check volume too.",
      "Same symptom returning vs a NEW symptom on the same service — the latter warrants revising the incident, not resolving it.",
    ],
    commonRootCauses: [],
    fixGuidance:
      "On resolve, cite the same metric you originally cited, with its new value, so the before/after is directly comparable.",
  },
};

// Compact list for the system prompt — the model picks from this, then gets full detail
// only for what it selects (keeps the prompt small without hiding options).
function catalogSummary() {
  return Object.entries(PLAYBOOKS)
    .map(([id, p]) => `- ${id}: ${p.whenToUse}`)
    .join("\n");
}

function getPlaybooks(ids) {
  const found = {};
  const unknown = [];
  for (const id of ids) {
    if (PLAYBOOKS[id]) found[id] = PLAYBOOKS[id];
    else unknown.push(id);
  }
  return { playbooks: found, unknown, available: Object.keys(PLAYBOOKS) };
}

module.exports = { PLAYBOOKS, catalogSummary, getPlaybooks };
