// Stateless per-tick anomaly scoring. Each tick pulls a fresh trailing window (via
// getServiceDigest) and scores the most recent points against the mean/stddev of the
// rest of that same window — no persisted history, so there's nothing to corrupt across
// restarts and no ambiguity about what counts as "baseline."

const RECENT_POINTS = 3; // how many trailing samples count as "now" vs "baseline"

function toNumbers(series) {
  const values = series?.[0]?.values;
  if (!values || values.length === 0) return [];
  return values.map(([, v]) => Number(v)).filter((n) => Number.isFinite(n));
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr, avg) {
  if (arr.length < 2) return 0;
  const variance = arr.reduce((a, b) => a + (b - avg) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// Returns null if there isn't enough data to say anything meaningful.
function scoreMetric(series) {
  const points = toNumbers(series);
  if (points.length < RECENT_POINTS + 5) return null;

  const baselinePoints = points.slice(0, -RECENT_POINTS);
  const recentPoints = points.slice(-RECENT_POINTS);
  const avg = mean(baselinePoints);
  const sd = stddev(baselinePoints, avg);
  const current = recentPoints[recentPoints.length - 1];

  // Flat baseline (sd ~ 0): use absolute jump instead of dividing by ~0.
  const z = sd > 0.01 ? (current - avg) / sd : current - avg > 0.5 ? current - avg : 0;

  return {
    current,
    baselineMean: avg,
    baselineStddev: sd,
    z: Number(z.toFixed(2)),
  };
}

// digest is the object returned by lgtm.getServiceDigest(service).
function scoreDigest(digest) {
  const scored = {};
  for (const key of ["errorRate", "latencyP99", "cpu", "mem"]) {
    const s = scoreMetric(digest[key]?.series);
    if (s) scored[key] = { ...s, query: digest[key].query };
  }
  return { service: digest.service, metrics: scored };
}

module.exports = { scoreMetric, scoreDigest, RECENT_POINTS };
