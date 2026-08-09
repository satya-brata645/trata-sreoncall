import { n } from "@disco/core/format";

/**
 * The SRE fixture producer.
 *
 * Everything `npm run seed:artifacts` writes into a run is computed here: the
 * synthetic estate, and the tables derived from it. It is the only module left
 * outside the two planes — the app never imports it, and nothing here renders.
 *
 * One file rather than three because there is only one consumer. The domain
 * model, the generator and the derived tables used to be split for a hand-built
 * page that read all three; with that page gone the split only meant three
 * places to look for one pipeline.
 */

/* ------------------------------------------------------------------ *
 * The domain model
 * ------------------------------------------------------------------ */

/**
 * The SRE on-call domain model.
 *
 * The shape here is the argument the dashboard makes: reliability work is a
 * *pipeline* with leaks, not a pile of counters. A signal becomes an alert,
 * alerts group into an incident, an incident is acknowledged, mitigated, root
 * caused, and written up — and every one of those transitions is a place where
 * time is lost or work is dropped. Modelling the transitions rather than the
 * totals is what lets the top of the page show where the loss actually is.
 */

export type Severity = "SEV1" | "SEV2" | "SEV3" | "SEV4";

export type SourceKind = "metrics" | "logs" | "traces" | "synthetic" | "rum" | "security";

export interface Source {
  id: string;
  name: string;
  kind: SourceKind;
  /** Raw signals ingested in the window. */
  signals: number;
  /** Signals that crossed a rule and became alerts. */
  alerts: number;
  /** Alerts that turned out to be noise: auto-closed, no incident, no action. */
  noise: number;
  healthy: boolean;
}

/** What actually caused it, once someone looked. */
export type RootCause =
  | "bad_deploy"
  | "config_change"
  | "capacity"
  | "dependency"
  | "infra_failure"
  | "data_quality"
  | "unknown";

export type IncidentState =
  | "detected"
  | "acknowledged"
  | "mitigated"
  | "rca_pending"
  | "resolved";

export interface Incident {
  id: string;
  title: string;
  service: string;
  severity: Severity;
  state: IncidentState;
  /** ISO. When the failure actually began, as reconstructed afterwards. */
  startedAt: string;
  /** Minutes from failure to first alert. The detection gap. */
  detectMin: number;
  /** Minutes from alert to a human taking it. The response gap. */
  ackMin: number;
  /** Minutes from ack to customer impact ending. The restore gap. */
  mitigateMin: number;
  /** Minutes from mitigation to a written root cause. Null while outstanding. */
  rcaMin: number | null;
  rootCause: RootCause;
  /** Alerts that collapsed into this one incident. High numbers mean noise. */
  alertCount: number;
  /** Did automation resolve it before a human was needed? */
  autoRemediated: boolean;
  /** Passed to another responder because the first could not resolve it. */
  escalated: boolean;
  responder: string;
  /** Same service and root cause as an earlier incident in the window. */
  repeat: boolean;
  postmortem: boolean;
}

export interface ServiceHealth {
  service: string;
  /** Achieved availability in the window, as a percentage. */
  availability: number;
  /** The promise. Anything under this is spending error budget. */
  slo: number;
  /** Fraction of the period's error budget already consumed, 0–1+. */
  budgetBurn: number;
  p95LatencyMs: number;
  errorRatePct: number;
  saturationPct: number;
  /** Share of deploys that caused an incident. */
  changeFailurePct: number;
  incidents: number;
}

/** One stage of the detect-to-postmortem pipeline. */
export interface PipelineStage {
  id: string;
  label: string;
  /** How many items reached this stage. */
  count: number;
  /** Longer explanation for the tooltip. */
  detail: string;
  /** Items that left the pipeline here, and why. */
  attrition?: { count: number; reason: string };
  /** Median minutes spent in this stage. */
  medianMin?: number;
}

export type AttentionKind = "breach" | "risk" | "stale" | "noise";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  /** Sort key. Higher is more urgent. */
  urgency: number;
  meta: string;
}

export interface SreSnapshot {
  /** ISO timestamp the window ends at. Passed in, never read from the clock. */
  asOf: string;
  windowDays: number;
  sources: Source[];
  incidents: Incident[];
  services: ServiceHealth[];
  /** Alerts per hour across the window, for the volume chart. */
  alertSeries: Array<{ t: string; alerts: number; incidents: number; noise: number }>;
}

export const ROOT_CAUSE_LABEL: Record<RootCause, string> = {
  bad_deploy: "Bad deploy",
  config_change: "Config change",
  capacity: "Capacity",
  dependency: "Dependency",
  infra_failure: "Infra failure",
  data_quality: "Data quality",
  unknown: "Not yet known",
};

/** Minutes to acknowledge before the on-call promise is broken, by severity. */
export const ACK_SLA_MIN: Record<Severity, number> = {
  SEV1: 5,
  SEV2: 15,
  SEV3: 60,
  SEV4: 240,
};

/** Minutes to restore service before the incident is formally late. */
export const RESTORE_SLA_MIN: Record<Severity, number> = {
  SEV1: 60,
  SEV2: 240,
  SEV3: 1440,
  SEV4: 4320,
};

/* ------------------------------------------------------------------ *
 * The estate
 * ------------------------------------------------------------------ */

/**
 * A deterministic estate.
 *
 * Seeded, and every timestamp derives from an `asOf` passed in by the caller —
 * never from the clock. That is not fussiness: a generator that reads
 * `Date.now()` produces different data on the server than in the browser, which
 * shows up as a hydration mismatch, and different data on every test run, which
 * makes a failure impossible to reproduce.
 *
 * The numbers are shaped to look like a real mid-size estate rather than to
 * look good: alert volume follows a business-hours curve with a deploy-window
 * spike, most alerts are noise, most incidents are minor, and a couple of
 * services are quietly in trouble.
 */

/** Mulberry32 — small, fast, and good enough for shaping plausible data. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SERVICES = [
  "checkout-api",
  "payments-gateway",
  "auth-service",
  "search-index",
  "notification-worker",
  "media-transcode",
  "ledger-db",
  "edge-cdn",
] as const;

const RESPONDERS = ["A. Okafor", "M. Lindqvist", "R. Nakamura", "S. Baptiste", "T. Alvarez"] as const;

const ROOT_CAUSES: RootCause[] = [
  "bad_deploy",
  "config_change",
  "capacity",
  "dependency",
  "infra_failure",
  "data_quality",
  "unknown",
];

/** Weights chosen so deploys and dependencies dominate, as they do in practice. */
const CAUSE_WEIGHT = [0.26, 0.16, 0.14, 0.2, 0.1, 0.08, 0.06];

const TITLES: Record<RootCause, string[]> = {
  bad_deploy: ["Elevated 5xx after release", "Latency regression from rollout", "Crash loop after deploy"],
  config_change: ["Feature flag misfire", "Bad routing rule", "Secret rotation broke auth"],
  capacity: ["Connection pool exhausted", "Queue backlog growing", "Disk pressure on primary"],
  dependency: ["Upstream provider degraded", "Third-party timeout spike", "Partner API rate limiting"],
  infra_failure: ["Node pool eviction", "AZ network partition", "Load balancer flapping"],
  data_quality: ["Stale cache served", "Schema drift in ingest", "Duplicate events downstream"],
  unknown: ["Intermittent errors under investigation", "Unexplained latency spike"],
};

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)];
}

function weighted(r: () => number, weights: number[]): number {
  const x = r();
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (x < acc) return i;
  }
  return weights.length - 1;
}

/** Long tail: most values small, a few very large. Real durations look like this. */
const lognormalish = (r: () => number, median: number, spread = 1.6) =>
  Math.max(1, Math.round(median * Math.pow(spread, (r() - 0.5) * 4)));

const HOUR = 3_600_000;

export function generateSnapshot(asOfIso: string, windowDays = 14, seed = 20260809): SreSnapshot {
  const r = rng(seed);
  const asOf = Date.parse(asOfIso);
  const start = asOf - windowDays * 24 * HOUR;

  /* -- alert volume, hour by hour ---------------------------------- */

  const alertSeries: SreSnapshot["alertSeries"] = [];
  const hours = windowDays * 24;

  for (let h = 0; h < hours; h++) {
    const t = start + h * HOUR;
    const d = new Date(t);
    const hourOfDay = d.getUTCHours();
    const dayOfWeek = d.getUTCDay();

    // Business hours carry the traffic, so they carry the alerts.
    const diurnal = 0.35 + 0.65 * Math.exp(-((hourOfDay - 14) ** 2) / 40);
    const weekend = dayOfWeek === 0 || dayOfWeek === 6 ? 0.45 : 1;
    // Deploys land early afternoon; that is when things break.
    const deployWindow = hourOfDay >= 13 && hourOfDay <= 16 ? 1.5 : 1;

    const base = 11 * diurnal * weekend * deployWindow;
    const alerts = Math.max(0, Math.round(base + (r() - 0.5) * base * 0.9));
    // Most alerts are noise. That ratio is the point of the chart.
    const noise = Math.round(alerts * (0.55 + r() * 0.25));
    // Tuned so the estate lands around 25-30 alerts per incident. Much higher
    // and the funnel stops being believable; much lower and "alert noise" stops
    // being the problem it actually is in on-call work.
    const incidents = r() < 0.28 * diurnal * weekend ? 1 + (r() < 0.2 ? 1 : 0) : 0;

    alertSeries.push({ t: new Date(t).toISOString(), alerts, incidents, noise });
  }

  const totalAlerts = alertSeries.reduce((a, x) => a + x.alerts, 0);
  const totalNoise = alertSeries.reduce((a, x) => a + x.noise, 0);
  const incidentCount = alertSeries.reduce((a, x) => a + x.incidents, 0);

  /* -- sources ------------------------------------------------------ */

  const sourceSpec: Array<[string, string, Source["kind"], number]> = [
    ["prom", "Prometheus", "metrics", 0.34],
    ["loki", "Loki", "logs", 0.24],
    ["tempo", "Tempo", "traces", 0.08],
    ["synthetics", "Synthetics", "synthetic", 0.13],
    ["rum", "Browser RUM", "rum", 0.12],
    ["falco", "Runtime security", "security", 0.09],
  ];

  const sources: Source[] = sourceSpec.map(([id, name, kind, share]) => {
    const alerts = Math.round(totalAlerts * share);
    return {
      id,
      name,
      kind,
      // Signals dwarf alerts by orders of magnitude; that gap is the funnel's
      // first and largest narrowing.
      signals: Math.round(alerts * (900 + r() * 700)),
      alerts,
      noise: Math.round(alerts * (0.5 + r() * 0.3)),
      healthy: r() > 0.14,
    };
  });

  /* -- incidents ---------------------------------------------------- */

  const incidents: Incident[] = [];
  const seenCause = new Set<string>();

  for (let i = 0; i < incidentCount; i++) {
    const startedAt = start + Math.floor(r() * (asOf - start));
    const sevRoll = r();
    const severity: Severity = sevRoll < 0.07 ? "SEV1" : sevRoll < 0.28 ? "SEV2" : sevRoll < 0.7 ? "SEV3" : "SEV4";

    const service = pick(r, SERVICES);
    const rootCause = ROOT_CAUSES[weighted(r, CAUSE_WEIGHT)];
    const key = `${service}:${rootCause}`;
    const repeat = seenCause.has(key);
    seenCause.add(key);

    // Severity drives urgency, so it drives every duration.
    const sevFactor = severity === "SEV1" ? 0.35 : severity === "SEV2" ? 0.6 : severity === "SEV3" ? 1 : 1.6;
    const autoRemediated = r() < (severity === "SEV3" || severity === "SEV4" ? 0.34 : 0.08);

    const detectMin = lognormalish(r, 4 * sevFactor);
    const ackMin = autoRemediated ? 0 : lognormalish(r, 9 * sevFactor);
    const mitigateMin = lognormalish(r, (autoRemediated ? 6 : 42) * sevFactor);

    const ageHours = (asOf - startedAt) / HOUR;
    // Newer incidents are legitimately still in flight; old ones should be done.
    const resolvedByNow = ageHours > (detectMin + ackMin + mitigateMin) / 60 + r() * 6;

    const rcaDue = severity === "SEV1" || severity === "SEV2";
    const rcaDone = resolvedByNow && (!rcaDue ? r() < 0.35 : r() < 0.62);
    const rcaMin = rcaDone ? lognormalish(r, 340 * sevFactor, 1.5) : null;

    const state: Incident["state"] = !resolvedByNow
      ? ackMin === 0
        ? "detected"
        : r() < 0.45
          ? "acknowledged"
          : "mitigated"
      : rcaDone
        ? "resolved"
        : "rca_pending";

    incidents.push({
      id: `INC-${4200 + i}`,
      title: pick(r, TITLES[rootCause]),
      service,
      severity,
      state,
      startedAt: new Date(startedAt).toISOString(),
      detectMin,
      ackMin,
      mitigateMin,
      rcaMin,
      rootCause,
      // A single incident can shout dozens of times before anyone groups it.
      alertCount: 1 + Math.floor(r() * (severity === "SEV1" ? 40 : 14)),
      autoRemediated,
      escalated: !autoRemediated && r() < (severity === "SEV1" ? 0.55 : 0.18),
      responder: pick(r, RESPONDERS),
      repeat,
      postmortem: rcaDone && (rcaDue ? r() < 0.72 : r() < 0.2),
    });
  }

  incidents.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

  /* -- service health ----------------------------------------------- */

  const services: ServiceHealth[] = SERVICES.map((service) => {
    const mine = incidents.filter((i) => i.service === service);
    const slo = service === "payments-gateway" || service === "ledger-db" ? 99.95 : 99.9;

    // Downtime follows from the incidents actually generated, so the
    // availability figure and the incident list cannot contradict each other.
    const downtimeMin = mine.reduce(
      (a, i) => a + (i.severity === "SEV1" ? i.mitigateMin : i.severity === "SEV2" ? i.mitigateMin * 0.4 : 0),
      0,
    );
    const windowMin = windowDays * 24 * 60;
    const availability = Math.max(97, 100 - (downtimeMin / windowMin) * 100);
    const budgetTotal = (100 - slo) / 100;
    const budgetUsed = Math.max(0, (100 - availability) / 100);

    return {
      service,
      availability: Number(availability.toFixed(3)),
      slo,
      budgetBurn: Number((budgetUsed / budgetTotal).toFixed(2)),
      p95LatencyMs: Math.round(120 + r() * 900),
      errorRatePct: Number((0.05 + r() * 1.6).toFixed(2)),
      saturationPct: Math.round(30 + r() * 62),
      changeFailurePct: Math.round(4 + r() * 26),
      incidents: mine.length,
    };
  });

  return {
    asOf: new Date(asOf).toISOString(),
    windowDays,
    sources,
    incidents,
    services,
    alertSeries,
  };
}

/* ------------------------------------------------------------------ *
 * Derived tables
 * ------------------------------------------------------------------ */

/**
 * The metrics layer.
 *
 * Two rules, both borrowed from the dashboard engine next door and both about
 * not lying with an average:
 *
 *   1. **Durations report the median and p90, never the mean.** Incident times
 *      are long-tailed — one four-hour outage drags a "mean MTTR" above every
 *      incident that actually happened, so the number describes nothing anyone
 *      experienced. The median is the typical page; p90 is the bad night.
 *   2. **Every rate names its denominator.** "68% RCA coverage" is meaningless
 *      until you know it is 68% *of resolved incidents that required one*.
 */

const median = (xs: number[]): number => quantile(xs, 0.5);

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export interface Metric {
  id: string;
  label: string;
  value: number;
  /** How to render it. */
  unit: "min" | "hours" | "pct" | "count" | "ratio" | "x";
  /** Percent change against the previous window of the same length. */
  delta: number | null;
  /** True when a fall is the good direction. Wrong here paints a fire green. */
  inverse: boolean;
  /** What it is, in one sentence, for the tooltip. */
  meaning: string;
  /** The denominator, stated. */
  basis: string;
  /** Sparkline data, oldest first. */
  spark?: number[];
  /** Set when the number breaches a target. */
  breach?: boolean;
}


/** Incidents in the most recent half of the window, and the half before it. */
function splitWindow(snap: SreSnapshot): { recent: Incident[]; prior: Incident[] } {
  const asOf = Date.parse(snap.asOf);
  const half = (snap.windowDays / 2) * 24 * HOUR;
  const mid = asOf - half;
  return {
    recent: snap.incidents.filter((i) => Date.parse(i.startedAt) >= mid),
    prior: snap.incidents.filter((i) => Date.parse(i.startedAt) < mid),
  };
}

const pctChange = (now: number, before: number): number | null =>
  before === 0 || !Number.isFinite(before) || !Number.isFinite(now) ? null : ((now - before) / before) * 100;

/** Daily buckets of a per-incident value, for KPI sparklines. */
function dailySpark(snap: SreSnapshot, value: (i: Incident) => number | null): number[] {
  const asOf = Date.parse(snap.asOf);
  const out: number[] = [];
  for (let d = snap.windowDays - 1; d >= 0; d--) {
    const hi = asOf - d * 24 * HOUR;
    const lo = hi - 24 * HOUR;
    const vals = snap.incidents
      .filter((i) => {
        const t = Date.parse(i.startedAt);
        return t >= lo && t < hi;
      })
      .map(value)
      .filter((v): v is number => v !== null);
    out.push(vals.length ? median(vals) : 0);
  }
  return out;
}

export function computeMetrics(snap: SreSnapshot): Metric[] {
  const { recent, prior } = splitWindow(snap);
  const all = snap.incidents;

  const mttd = (xs: Incident[]) => median(xs.map((i) => i.detectMin));
  const mtta = (xs: Incident[]) => median(xs.filter((i) => !i.autoRemediated).map((i) => i.ackMin));
  const mttr = (xs: Incident[]) => median(xs.map((i) => i.detectMin + i.ackMin + i.mitigateMin));

  const totalAlerts = snap.alertSeries.reduce((a, x) => a + x.alerts, 0);
  const totalNoise = snap.alertSeries.reduce((a, x) => a + x.noise, 0);

  const resolved = all.filter((i) => i.state === "resolved" || i.state === "rca_pending");
  const rcaDone = all.filter((i) => i.rcaMin !== null);
  const needsRca = all.filter((i) => i.severity === "SEV1" || i.severity === "SEV2");
  const rcaOnSev = needsRca.filter((i) => i.rcaMin !== null);

  // Windowed availability across services, weighted equally — a single service
  // dragging the mean is exactly the signal we want visible.
  const availability = snap.services.reduce((a, s) => a + s.availability, 0) / snap.services.length;
  const worstBurn = Math.max(...snap.services.map((s) => s.budgetBurn));

  const open = all.filter((i) => i.state !== "resolved");
  const p1 = all.filter((i) => i.severity === "SEV1");

  const ackBreaches = all.filter((i) => !i.autoRemediated && i.ackMin > ACK_SLA_MIN[i.severity]);

  const mttrNow = mttr(recent);
  const mttrBefore = mttr(prior);

  const metrics: Metric[] = [
    {
      id: "mttr",
      label: "MTTR",
      value: mttrNow,
      unit: "min",
      delta: pctChange(mttrNow, mttrBefore),
      inverse: true,
      meaning: "Median time from failure starting to service being restored — detect, acknowledge and mitigate combined.",
      basis: `median of ${recent.length} incidents in the last ${snap.windowDays / 2} days`,
      spark: dailySpark(snap, (i) => i.detectMin + i.ackMin + i.mitigateMin),
      breach: mttrNow > 90,
    },
    {
      id: "mtta",
      label: "MTTA",
      value: mtta(recent),
      unit: "min",
      delta: pctChange(mtta(recent), mtta(prior)),
      inverse: true,
      meaning: "Median time from an alert firing to a human taking ownership of it.",
      basis: "median across incidents a human handled; auto-remediated ones excluded",
      spark: dailySpark(snap, (i) => (i.autoRemediated ? null : i.ackMin)),
      breach: mtta(recent) > 15,
    },
    {
      id: "mttd",
      label: "MTTD",
      value: mttd(recent),
      unit: "min",
      delta: pctChange(mttd(recent), mttd(prior)),
      inverse: true,
      meaning: "Median time between a failure beginning and monitoring noticing it.",
      basis: `median of ${recent.length} incidents`,
      spark: dailySpark(snap, (i) => i.detectMin),
      breach: mttd(recent) > 10,
    },
    {
      id: "mtbf",
      label: "MTBF",
      value: all.length > 1 ? (snap.windowDays * 24) / all.length : snap.windowDays * 24,
      unit: "hours",
      delta: pctChange(prior.length || 1, recent.length || 1),
      inverse: false,
      meaning: "Mean hours between incidents. Rising is good — failures are getting rarer.",
      basis: `${snap.windowDays} days ÷ ${all.length} incidents`,
    },
    {
      id: "availability",
      label: "Availability",
      value: availability,
      unit: "pct",
      delta: null,
      inverse: false,
      meaning: "Mean availability across all monitored services for the window.",
      basis: `unweighted mean of ${snap.services.length} services`,
      breach: availability < 99.9,
    },
    {
      id: "burn",
      label: "Worst budget burn",
      value: worstBurn,
      unit: "x",
      delta: null,
      inverse: true,
      meaning:
        "Fraction of the period's error budget already spent by the worst service. Above 1 means the SLO is already missed.",
      basis: `worst of ${snap.services.length} services`,
      breach: worstBurn > 1,
    },
    {
      id: "noise",
      label: "Alert noise",
      value: totalAlerts ? (totalNoise / totalAlerts) * 100 : 0,
      unit: "pct",
      delta: null,
      inverse: true,
      meaning: "Share of alerts that closed with no incident and no action. This is what burns out on-call.",
      basis: `${n(totalNoise)} of ${n(totalAlerts)} alerts`,
      breach: totalAlerts > 0 && totalNoise / totalAlerts > 0.6,
    },
    {
      id: "ratio",
      label: "Alerts per incident",
      value: all.length ? totalAlerts / all.length : 0,
      unit: "ratio",
      delta: null,
      inverse: true,
      meaning: "How many alerts fire for each real incident. High values mean grouping rules are not doing their job.",
      basis: `${n(totalAlerts)} alerts ÷ ${all.length} incidents`,
    },
    {
      id: "auto",
      label: "Auto-remediated",
      value: all.length ? (all.filter((i) => i.autoRemediated).length / all.length) * 100 : 0,
      unit: "pct",
      delta: null,
      inverse: false,
      meaning: "Incidents automation closed without waking anyone. The single best lever on on-call load.",
      basis: `of ${all.length} incidents`,
    },
    {
      id: "escalation",
      label: "Escalation rate",
      value: all.length ? (all.filter((i) => i.escalated).length / all.length) * 100 : 0,
      unit: "pct",
      delta: null,
      inverse: true,
      meaning: "Incidents the first responder could not resolve alone. A proxy for runbook and access gaps.",
      basis: `of ${all.length} incidents`,
    },
    {
      id: "rca",
      label: "RCA coverage",
      value: needsRca.length ? (rcaOnSev.length / needsRca.length) * 100 : 100,
      unit: "pct",
      delta: null,
      inverse: false,
      meaning: "Share of critical and major incidents that have a written root cause.",
      basis: `${rcaOnSev.length} of ${needsRca.length} SEV1/SEV2 incidents`,
      breach: needsRca.length > 0 && rcaOnSev.length / needsRca.length < 0.8,
    },
    {
      id: "repeat",
      label: "Repeat incidents",
      value: all.length ? (all.filter((i) => i.repeat).length / all.length) * 100 : 0,
      unit: "pct",
      delta: null,
      inverse: true,
      meaning: "Incidents with the same service and root cause as an earlier one. Repeats mean the fix did not stick.",
      basis: `of ${all.length} incidents`,
      breach: all.length > 0 && all.filter((i) => i.repeat).length / all.length > 0.25,
    },
    {
      id: "ack_sla",
      label: "Ack SLA met",
      value: all.length ? (1 - ackBreaches.length / Math.max(1, all.filter((i) => !i.autoRemediated).length)) * 100 : 100,
      unit: "pct",
      delta: null,
      inverse: false,
      meaning: "Incidents acknowledged inside the promise for their severity — 5 minutes for a SEV1.",
      basis: `${ackBreaches.length} breaches across human-handled incidents`,
      breach: ackBreaches.length > all.length * 0.15,
    },
    {
      id: "open",
      label: "Open incidents",
      value: open.length,
      unit: "count",
      delta: null,
      inverse: true,
      meaning: "Incidents not yet fully resolved, at any stage of the pipeline.",
      basis: `${p1.filter((i) => i.state !== "resolved").length} of them critical`,
      breach: open.filter((i) => i.severity === "SEV1").length > 0,
    },
  ];

  return metrics;
}

/* ------------------------------------------------------------------ *
 * The pipeline
 * ------------------------------------------------------------------ */

export function buildPipeline(snap: SreSnapshot): PipelineStage[] {
  const signals = snap.sources.reduce((a, s) => a + s.signals, 0);
  const alerts = snap.alertSeries.reduce((a, x) => a + x.alerts, 0);
  const noise = snap.alertSeries.reduce((a, x) => a + x.noise, 0);
  const grouped = alerts - noise;

  const incidents = snap.incidents;
  const acked = incidents.filter((i) => i.state !== "detected");
  const mitigated = incidents.filter((i) => i.state === "mitigated" || i.state === "rca_pending" || i.state === "resolved");
  const rca = incidents.filter((i) => i.rcaMin !== null);
  const postmortem = incidents.filter((i) => i.postmortem);

  const med = (xs: number[]) => (xs.length ? Math.round(median(xs)) : undefined);

  return [
    {
      id: "signals",
      label: "Signals",
      count: signals,
      detail: `Raw datapoints across ${snap.sources.length} connected sources.`,
    },
    {
      id: "alerts",
      label: "Alerts fired",
      count: alerts,
      detail: "Signals that crossed a rule threshold.",
      attrition: { count: signals - alerts, reason: "below threshold — normal operation" },
    },
    {
      id: "grouped",
      label: "After dedup",
      count: grouped,
      detail: "Alerts left once duplicates were grouped and known-noise was suppressed.",
      attrition: { count: noise, reason: "noise: auto-closed, no action taken" },
    },
    {
      id: "incidents",
      label: "Incidents",
      count: incidents.length,
      detail: "Alert groups a human or policy promoted to a declared incident.",
      attrition: { count: Math.max(0, grouped - incidents.length), reason: "handled without declaring an incident" },
      medianMin: med(incidents.map((i) => i.detectMin)),
    },
    {
      id: "acked",
      label: "Acknowledged",
      count: acked.length,
      detail: "Incidents someone has taken ownership of.",
      attrition: { count: incidents.length - acked.length, reason: "still unacknowledged" },
      medianMin: med(acked.filter((i) => !i.autoRemediated).map((i) => i.ackMin)),
    },
    {
      id: "mitigated",
      label: "Mitigated",
      count: mitigated.length,
      detail: "Customer impact has ended, whether or not the cause is understood.",
      attrition: { count: acked.length - mitigated.length, reason: "still impacting" },
      medianMin: med(mitigated.map((i) => i.mitigateMin)),
    },
    {
      id: "rca",
      label: "Root cause",
      count: rca.length,
      detail: "Incidents with a written, agreed root cause.",
      attrition: { count: mitigated.length - rca.length, reason: "cause never established" },
      medianMin: med(rca.map((i) => i.rcaMin!)),
    },
    {
      id: "postmortem",
      label: "Postmortem",
      count: postmortem.length,
      detail: "Written up and shared, with actions assigned.",
      attrition: { count: rca.length - postmortem.length, reason: "no postmortem published" },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Attention
 * ------------------------------------------------------------------ */

export function buildAttention(snap: SreSnapshot): AttentionItem[] {
  const items: AttentionItem[] = [];
  const asOf = Date.parse(snap.asOf);

  // Unresolved criticals, oldest first — the thing you look at before anything.
  for (const i of snap.incidents.filter((x) => x.severity === "SEV1" && x.state !== "resolved")) {
    const ageMin = Math.round((asOf - Date.parse(i.startedAt)) / 60_000);
    items.push({
      id: `p1-${i.id}`,
      kind: "breach",
      title: `${i.id} · ${i.title}`,
      detail: `${i.service} — critical, still ${i.state.replace("_", " ")} after ${formatMin(ageMin)}.`,
      urgency: 100 + ageMin / 60,
      meta: i.responder,
    });
  }

  // Error budget: burning faster than the period can absorb.
  for (const s of snap.services.filter((x) => x.budgetBurn > 0.75)) {
    items.push({
      id: `burn-${s.service}`,
      kind: s.budgetBurn > 1 ? "breach" : "risk",
      title: `${s.service} error budget ${s.budgetBurn > 1 ? "exhausted" : "at risk"}`,
      detail:
        s.budgetBurn > 1
          ? `${(s.budgetBurn * 100).toFixed(0)}% of the budget spent — the ${s.slo}% SLO is already missed for this period.`
          : `${(s.budgetBurn * 100).toFixed(0)}% of the budget spent with time still to run.`,
      urgency: 80 + s.budgetBurn * 10,
      meta: `${s.availability.toFixed(3)}% vs ${s.slo}%`,
    });
  }

  // Acknowledgement promises broken.
  const lateAcks = snap.incidents.filter((i) => !i.autoRemediated && i.ackMin > ACK_SLA_MIN[i.severity]);
  if (lateAcks.length > 0) {
    const worst = lateAcks.reduce((a, b) => (b.ackMin > a.ackMin ? b : a));
    items.push({
      id: "ack-sla",
      kind: "breach",
      title: `${lateAcks.length} incident${lateAcks.length === 1 ? "" : "s"} acknowledged late`,
      detail: `Worst was ${worst.id} at ${formatMin(worst.ackMin)} against a ${ACK_SLA_MIN[worst.severity]}-minute promise.`,
      urgency: 70 + lateAcks.length,
      meta: "on-call routing",
    });
  }

  // Incidents restored but never explained — the ones that come back.
  const stale = snap.incidents.filter(
    (i) => i.state === "rca_pending" && asOf - Date.parse(i.startedAt) > 3 * 24 * HOUR,
  );
  if (stale.length > 0) {
    items.push({
      id: "rca-stale",
      kind: "stale",
      title: `${stale.length} incident${stale.length === 1 ? "" : "s"} awaiting root cause for over 3 days`,
      detail: "Service was restored but the cause was never written down, so nothing stops it recurring.",
      urgency: 55,
      meta: stale.map((i) => i.id).slice(0, 3).join(", "),
    });
  }

  // Repeats: the fix did not hold.
  const repeats = snap.incidents.filter((i) => i.repeat);
  if (repeats.length >= 3) {
    const byService = new Map<string, number>();
    for (const i of repeats) byService.set(i.service, (byService.get(i.service) ?? 0) + 1);
    const [service, n] = [...byService.entries()].sort((a, b) => b[1] - a[1])[0];
    items.push({
      id: "repeats",
      kind: "risk",
      title: `${repeats.length} repeat incident${repeats.length === 1 ? "" : "s"} this window`,
      detail: `${service} alone accounts for ${n}. A recurring cause means the previous fix did not hold.`,
      urgency: 50,
      meta: service,
    });
  }

  // Noisiest source: where the pager fatigue is coming from.
  const noisiest = [...snap.sources].sort((a, b) => b.noise / b.alerts - a.noise / a.alerts)[0];
  if (noisiest && noisiest.noise / noisiest.alerts > 0.65) {
    items.push({
      id: `noise-${noisiest.id}`,
      kind: "noise",
      title: `${noisiest.name} is ${Math.round((noisiest.noise / noisiest.alerts) * 100)}% noise`,
      detail: `${n(noisiest.noise)} of ${n(noisiest.alerts)} alerts closed with no action. Tuning this is the cheapest win available.`,
      urgency: 40,
      meta: noisiest.kind,
    });
  }

  return items.sort((a, b) => b.urgency - a.urgency);
}

/* ------------------------------------------------------------------ *
 * Breakdowns for the chart row
 * ------------------------------------------------------------------ */

export function causeBreakdown(snap: SreSnapshot) {
  const counts = new Map<RootCause, number>();
  for (const i of snap.incidents) counts.set(i.rootCause, (counts.get(i.rootCause) ?? 0) + 1);
  return [...counts.entries()]
    .map(([cause, count]) => ({ cause: ROOT_CAUSE_LABEL[cause], count, key: cause }))
    .sort((a, b) => b.count - a.count);
}

export function severityBreakdown(snap: SreSnapshot) {
  const order: Severity[] = ["SEV1", "SEV2", "SEV3", "SEV4"];
  return order.map((severity) => {
    const xs = snap.incidents.filter((i) => i.severity === severity);
    return {
      severity,
      count: xs.length,
      mttr: xs.length ? Math.round(median(xs.map((i) => i.detectMin + i.ackMin + i.mitigateMin))) : 0,
      p90: xs.length ? Math.round(quantile(xs.map((i) => i.detectMin + i.ackMin + i.mitigateMin), 0.9)) : 0,
      sla: RESTORE_SLA_MIN[severity],
    };
  });
}

/**
 * Service health on six normalised axes, 0–100 where higher is better.
 *
 * A radar only works when every axis points the same way, so latency,
 * saturation, error rate and change failure are all inverted here — otherwise
 * a large shape would mean "good at some things and terrible at others" and
 * the overall silhouette would be unreadable.
 */
export function radarAxes(snap: SreSnapshot) {
  // Scored against FIXED targets, not against the worst service observed.
  //
  // Relative normalisation looked reasonable until the dashboard started
  // plotting the three most at-risk services: each one was near the worst on
  // every axis, so all three collapsed to the centre and the chart said
  // nothing. Absolute targets also make a score readable on its own — "latency
  // 60" means roughly 400ms, whoever else is on the chart.
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(100, v)));

  return snap.services.map((s) => ({
    service: s.service,
    /** 99.0% scores 0, 100% scores 100. Below three nines is already a bad month. */
    Availability: clamp(((s.availability - 99) / 1) * 100),
    /** 1000ms p95 scores 0, instant scores 100. */
    Latency: clamp(100 - (s.p95LatencyMs / 1000) * 100),
    /** 2% error rate scores 0. */
    Errors: clamp(100 - (s.errorRatePct / 2) * 100),
    /** Saturation inverted: 100 means all the headroom is still there. */
    Headroom: clamp(100 - s.saturationPct),
    /** 40% of deploys causing an incident scores 0. */
    "Change safety": clamp(100 - (s.changeFailurePct / 40) * 100),
    /** Budget untouched scores 100; budget spent scores 0. */
    "Budget left": clamp((1 - s.budgetBurn) * 100),
  }));
}

/** Incidents by weekday and hour — where the week actually hurts. */
export function incidentHeatmap(snap: SreSnapshot) {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cells: Array<{ day: string; hour: number; count: number }> = [];
  const index = new Map<string, number>();

  for (const i of snap.incidents) {
    const d = new Date(i.startedAt);
    // Three-hour bands: 24 columns is unreadable in a card, 8 is legible.
    const band = Math.floor(d.getUTCHours() / 3) * 3;
    const key = `${DAYS[d.getUTCDay()]}|${band}`;
    index.set(key, (index.get(key) ?? 0) + 1);
  }

  for (const day of DAYS) {
    for (let hour = 0; hour < 24; hour += 3) {
      cells.push({ day, hour, count: index.get(`${day}|${hour}`) ?? 0 });
    }
  }
  return cells;
}

export function formatMin(min: number): string {
  if (min < 1) return "<1m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  return `${(h / 24).toFixed(1)}d`;
}
