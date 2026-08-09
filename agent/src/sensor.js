// Builds one sweep's evidence window.
//
// PLAN NOTE (§4 / §12 step 2): this file touches zero judgment calls. It
// fetches broadly, normalizes service names, and hands the raw result to
// whoever asked — it never decides what matters, never filters by severity,
// and never narrows its own scope based on what it found. Widening scope is
// always the agent's call, made via the tools in agents/triage.js.
const lgtm = require("./lgtm");
const { FLAGD_URL } = require("./env");
const evidence = require("./evidence");

async function getFlagStates() {
  const res = await fetch(`${FLAGD_URL}/list`);
  if (!res.ok) throw new Error(`flagd /list failed: ${res.status}`);
  return res.json();
}

// One broad sweep: volume shape + raw log sample per service (uncapped by
// severity) + whichever RED-ish metrics exist + recent/error traces + flag
// state. Every fetch here is recorded into the evidence store immediately,
// so anything the triage agent later cites can be replayed verbatim.
async function sweep({ sinceMinutes = 5, logSampleCap = 30 } = {}) {
  const observedAt = new Date().toISOString();

  const [volumeByService, services, flagStates, metricNames] = await Promise.all([
    lgtm.logVolumeByService(sinceMinutes),
    lgtm.listServices(),
    getFlagStates().catch((err) => ({ error: err.message })),
    lgtm.listMetricNames().catch(() => ({ data: [] })),
  ]);

  const logQuery = `{service_name=~".+"}`;
  const rawLogs = await lgtm.queryLogs(logQuery, sinceMinutes, logSampleCap);
  const logsRef = evidence.record({ kind: "log", query: logQuery, raw: rawLogs, observedAt });

  const errorTraceQuery = "error=true";
  const rawErrorTraces = await lgtm.searchTraces(errorTraceQuery, 10).catch((err) => ({ error: err.message }));
  const tracesRef = evidence.record({ kind: "trace", query: errorTraceQuery, raw: rawErrorTraces, observedAt });

  const flagRef = evidence.record({ kind: "flag", query: "flagd:/list", raw: flagStates, observedAt });

  return {
    observed_at: observedAt,
    window_minutes: sinceMinutes,
    services,
    volume_by_service: volumeByService,
    metric_names_sample: (metricNames.data || []).slice(0, 50),
    flag_states: flagStates,
    logs_ref: logsRef,
    error_traces_ref: tracesRef,
    flag_ref: flagRef,
    raw_logs: rawLogs,
    raw_error_traces: rawErrorTraces,
  };
}

module.exports = { sweep, getFlagStates };

// Self-test when run directly: node src/sensor.js
if (require.main === module) {
  (async () => {
    console.log("Running one raw sweep...");
    const window = await sweep();
    console.log(`services: ${window.services.join(", ")}`);
    console.log(`volume_by_service:`, window.volume_by_service);
    console.log(`flag_states:`, window.flag_states);
    console.log(`logs_ref: ${window.logs_ref}  error_traces_ref: ${window.error_traces_ref}`);
    console.log("Sensor sweep OK — zero judgment performed, raw data only.");
  })().catch((err) => {
    console.error("Sensor sweep failed:", err.message);
    process.exit(1);
  });
}
