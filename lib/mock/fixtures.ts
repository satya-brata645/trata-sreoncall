/**
 * The fixture workspace.
 *
 * Everything the OS reads comes from here until the service lands. Shapes are
 * the real wire shapes (`lib/api/types.ts`), so a resource can be moved to the
 * backend one endpoint at a time without touching a component.
 *
 * Timestamps are computed relative to load so the freshness stamps §4 of the
 * concept note calls mandatory are never wrong by a day — a demo that says
 * "refreshed 4 minutes ago" and means it is the point.
 */

import type { Project, ProjectFile, SessionWithSummary } from "@/lib/api/types";
import type { Build } from "@/lib/api/builds";
import type { ConversationFilesItem } from "@/lib/api/conversations";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const BOOT = Date.now();
export const ago = (ms: number) => new Date(BOOT - ms).toISOString();

/* ---------------------------------------------------------------------------
   Apps
   ------------------------------------------------------------------------ */

function app(
  id: string,
  name: string,
  description: string,
  tags: string[],
  enabled: boolean,
): Project {
  return {
    id,
    name,
    description,
    path: `/apps/${id}`,
    url: `https://github.com/trata/apps/${id}`,
    has_claude_md: true,
    has_project_json: true,
    tags,
    enabled,
  };
}

/** Owned by the workspace — these appear in the Launchpad and the dock. */
export const OWNED_APPS: Project[] = [
  app(
    "dpflo",
    "dpflo",
    "Data privacy posture across every store the estate touches. Maps flows, ranks exposure, drafts the DPIA.",
    ["domain:privacy", "cloud:aws", "cloud:gcp"],
    true,
  ),
  app(
    "sreoncall",
    "SREonCall",
    "Reliability and incident response. Owns the pager, writes the postmortem, holds the change freeze.",
    ["domain:reliability", "cloud:aws"],
    true,
  ),
  app(
    "kodeshield",
    "KodeShield",
    "Application and supply-chain security. Triages CVEs against real reachability and opens the fix PR.",
    ["domain:appsec", "domain:supply-chain"],
    true,
  ),
  app(
    "auditiseasy",
    "AuditIsEasy",
    "Continuous compliance. Keeps SOC 2 and ISO 27001 evidence current instead of assembling it in a panic.",
    ["domain:compliance", "framework:soc2", "framework:iso27001"],
    true,
  ),
];

/** In the library but not owned — the App Store's "available" half. */
export const AVAILABLE_APPS: Project[] = [
  app(
    "netmap",
    "NetMap",
    "Network exposure and segmentation drift, continuously diffed against the intended topology.",
    ["domain:network", "cloud:azure"],
    false,
  ),
  app(
    "identityledger",
    "IdentityLedger",
    "Standing access, dormant credentials and privilege creep across every identity provider.",
    ["domain:iam"],
    false,
  ),
  app(
    "vendorwatch",
    "VendorWatch",
    "Third-party risk: what each vendor can reach, and what changed since you signed.",
    ["domain:trust", "domain:vendor"],
    false,
  ),
];

export const ALL_APPS: Project[] = [...OWNED_APPS, ...AVAILABLE_APPS];

/* ---------------------------------------------------------------------------
   Builds — an app's promoted logic, newest first
   ------------------------------------------------------------------------ */

export const BUILDS: Record<string, Build[]> = {
  dpflo: [
    { number: 3, promoted_at: ago(9 * DAY), promoted_by: "alex@trata.dev", conversation_id: "conv-dpflo-scope" },
    { number: 2, promoted_at: ago(38 * DAY), promoted_by: "alex@trata.dev" },
    { number: 1, promoted_at: ago(74 * DAY), promoted_by: "system" },
  ],
  sreoncall: [
    { number: 2, promoted_at: ago(21 * DAY), promoted_by: "alex@trata.dev" },
    { number: 1, promoted_at: ago(61 * DAY), promoted_by: "system" },
  ],
  kodeshield: [
    { number: 4, promoted_at: ago(2 * DAY), promoted_by: "alex@trata.dev", conversation_id: "conv-kode-reach" },
    { number: 3, promoted_at: ago(17 * DAY), promoted_by: "alex@trata.dev" },
    { number: 2, promoted_at: ago(45 * DAY), promoted_by: "system" },
    { number: 1, promoted_at: ago(80 * DAY), promoted_by: "system" },
  ],
  auditiseasy: [
    { number: 1, promoted_at: ago(52 * DAY), promoted_by: "system" },
  ],
};

/* ---------------------------------------------------------------------------
   Wake-ups — the app refreshing itself. There are no runs to launch.
   ------------------------------------------------------------------------ */

function file(name: string, size: number, mime: string, at: string, base: string): ProjectFile {
  return { path: `${base}/${name}`, filename: name, size, mime_type: mime, modified_at: at };
}

interface WakeUpSeed {
  id: string;
  appId: string;
  title: string;
  at: string;
  status?: string;
  headline: string;
  narrative: string;
  criticality: string;
  metrics: string[];
  actions: string[];
  files: Array<[string, number, string]>;
}

const WAKE_UP_SEEDS: WakeUpSeed[] = [
  {
    id: "wake-kode-004",
    appId: "kodeshield",
    title: "Reachability sweep — api-gateway",
    at: ago(11 * MINUTE),
    status: "running",
    headline: "3 critical CVEs, 1 of them actually reachable",
    narrative:
      "Of 47 advisories matched against the dependency graph, 3 are critical and only CVE-2026-1187 sits on a path an unauthenticated request can walk. The other two are behind an admin guard.",
    criticality: "critical",
    metrics: ["47 advisories matched", "3 critical", "1 reachable", "PR #482 drafted"],
    actions: ["Merge PR #482 in api-gateway", "Re-scan after merge"],
    files: [
      ["reachability-report.pdf", 2_411_724, "application/pdf"],
      ["cve-matrix.csv", 184_320, "text/csv"],
      ["dependency-graph.json", 942_113, "application/json"],
    ],
  },
  {
    id: "wake-dpflo-011",
    appId: "dpflo",
    title: "Flow map refresh — eu-west",
    at: ago(2 * HOUR),
    headline: "One new cross-border flow, undocumented",
    narrative:
      "The nightly export from billing-svc now lands in a us-east-1 bucket. No transfer mechanism is recorded for it, which makes it the only unmapped cross-border flow in the estate.",
    criticality: "high",
    metrics: ["312 stores scanned", "1 new cross-border flow", "0 documented SCCs"],
    actions: ["Record a transfer mechanism or move the bucket"],
    files: [
      ["flow-map-eu-west.pdf", 5_182_004, "application/pdf"],
      ["stores-inventory.csv", 447_291, "text/csv"],
    ],
  },
  {
    id: "wake-sre-030",
    appId: "sreoncall",
    title: "Post-incident review — checkout latency",
    at: ago(19 * HOUR),
    headline: "SEV-2 closed, one action item outstanding",
    narrative:
      "Checkout p99 crossed 2.4s for 38 minutes after a connection-pool change. Rolled back at 14:12. The pool sizing runbook still describes the old default.",
    criticality: "medium",
    metrics: ["38 min impact", "p99 2.4s peak", "1 action item open"],
    actions: ["Update the pool-sizing runbook"],
    files: [
      ["postmortem-checkout-latency.pdf", 1_820_442, "application/pdf"],
      ["latency-timeline.json", 288_640, "application/json"],
    ],
  },
  {
    id: "wake-audit-007",
    appId: "auditiseasy",
    title: "Evidence refresh — SOC 2 CC6",
    at: ago(3 * DAY),
    headline: "CC6 fully evidenced for the first time this quarter",
    narrative:
      "Access-review exports landed for all nine in-scope systems. Two controls that were carrying manual attestations now have generated evidence instead.",
    criticality: "low",
    metrics: ["9 systems", "22 controls", "2 attestations replaced"],
    actions: [],
    files: [
      ["cc6-evidence-pack.pdf", 8_931_226, "application/pdf"],
      ["access-review.xlsx", 1_204_992, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ],
  },
  {
    id: "wake-kode-003",
    appId: "kodeshield",
    title: "Supply-chain diff — weekly",
    at: ago(5 * DAY),
    headline: "Two new transitive maintainers on the build path",
    narrative:
      "Both changes are in packages that run at build time, which is the path that can reach CI credentials. Neither publisher has 2FA enabled.",
    criticality: "medium",
    metrics: ["1,204 packages", "2 maintainer changes", "0 with 2FA"],
    actions: ["Pin the two packages to reviewed versions"],
    files: [["supply-chain-diff.pdf", 1_112_004, "application/pdf"]],
  },
  {
    id: "wake-dpflo-010",
    appId: "dpflo",
    title: "DPIA draft — support tooling",
    at: ago(12 * DAY),
    headline: "DPIA drafted for the new support console",
    narrative:
      "The console reads ticket bodies, which carry free-text customer data. Draft assessment attached; the retention question is the one that needs a human.",
    criticality: "medium",
    metrics: ["1 new processing activity", "3 data categories", "1 open question"],
    actions: ["Decide retention for ticket bodies"],
    files: [["dpia-support-console.pdf", 3_442_881, "application/pdf"]],
  },
  {
    id: "wake-sre-028",
    appId: "sreoncall",
    title: "Error-budget review",
    at: ago(26 * DAY),
    headline: "Checkout is 61% through its quarterly budget",
    narrative:
      "Two thirds of the burn came from a single deploy window. At the current rate the budget holds, but a second incident of that size would exhaust it.",
    criticality: "low",
    metrics: ["61% budget consumed", "4 SLOs tracked"],
    actions: [],
    files: [["error-budget-q3.pdf", 902_113, "application/pdf"]],
  },
];

export const WAKE_UPS: SessionWithSummary[] = WAKE_UP_SEEDS.map((seed) => ({
  session_id: seed.id,
  project_id: seed.appId,
  title: seed.title,
  agent_name: "SOS",
  status: seed.status ?? "completed",
  created_at: seed.at,
  updated_at: seed.at,
  last_update: seed.at,
  user_email: "alex@trata.dev",
  org_slug: "trata",
  has_summary: true,
  summary: {
    human_readable_summary: {
      headline: seed.headline,
      narrative: seed.narrative,
      key_metrics: seed.metrics,
      risk_assessment: seed.narrative,
      criticality_level: seed.criticality,
      action_items: seed.actions,
    },
  },
}));

export const WAKE_UP_FILES: Record<string, ProjectFile[]> = Object.fromEntries(
  WAKE_UP_SEEDS.map((seed) => [
    seed.id,
    seed.files.map(([name, size, mime]) =>
      file(name, size, mime, seed.at, `/apps/${seed.appId}/outputs/${seed.id}`),
    ),
  ]),
);

/* ---------------------------------------------------------------------------
   Chat — the home trunk plus side threads
   ------------------------------------------------------------------------ */

export interface MockMessage {
  id: string;
  role: "user" | "agent" | "trace";
  text: string;
  at: string;
  /** Trace rows only: INTENT / ROUTE / EXEC / CORRELATE. */
  kind?: string;
  /** Unread agent messages carry the worst severity behind them. */
  severity?: "critical" | "high" | "medium" | "low";
  read?: boolean;
}

export interface MockThread {
  id: string;
  title: string;
  isHome?: boolean;
  updatedAt: string;
  messages: MockMessage[];
}

export const THREADS: MockThread[] = [
  {
    id: "home",
    title: "Home",
    isHome: true,
    updatedAt: ago(11 * MINUTE),
    messages: [
      {
        id: "m1",
        role: "agent",
        at: ago(11 * MINUTE),
        severity: "critical",
        read: false,
        text:
          "CVE-2026-1187 in api-gateway is reachable without authentication. I have a fix PR open (#482) and I have put a change freeze on the service until it merges. Nothing else in the estate is on that path.",
      },
      {
        id: "m2",
        role: "trace",
        kind: "CORRELATE",
        at: ago(10 * MINUTE),
        text: "Merging #482 also closes 3 pending SOC 2 controls in AuditIsEasy.",
      },
      {
        id: "m3",
        role: "agent",
        at: ago(2 * HOUR),
        severity: "high",
        read: false,
        text:
          "billing-svc started writing its nightly export to a us-east-1 bucket. That is a cross-border transfer with no mechanism recorded — the only one in the estate. Want me to draft the SCC, or should it move back to eu-west?",
      },
      {
        id: "m4",
        role: "agent",
        at: ago(3 * DAY),
        read: true,
        text:
          "SOC 2 CC6 is fully evidenced for the first time this quarter. Two controls that were carrying manual attestations now generate their evidence instead.",
      },
    ],
  },
  {
    id: "conv-kode-reach",
    title: "Reachability, not just severity",
    updatedAt: ago(2 * DAY),
    messages: [
      {
        id: "k1",
        role: "user",
        at: ago(2 * DAY),
        text: "Stop ranking CVEs by CVSS. Rank them by whether anything can actually reach the code.",
      },
      {
        id: "k2",
        role: "agent",
        at: ago(2 * DAY),
        read: true,
        text:
          "Done — that is build 4. Scoring now walks the call graph from every public entrypoint first, and CVSS only breaks ties. The critical count dropped from 11 to 3, and the 3 are real.",
      },
    ],
  },
  {
    id: "conv-dpflo-scope",
    title: "Scope dpflo to production only",
    updatedAt: ago(9 * DAY),
    messages: [
      {
        id: "d1",
        role: "user",
        at: ago(9 * DAY),
        text: "dpflo keeps flagging staging buckets. I do not care about staging.",
      },
      {
        id: "d2",
        role: "agent",
        at: ago(9 * DAY),
        read: true,
        text:
          "Scoped to accounts tagged env:prod, promoted as build 3. Staging still gets scanned — it just does not surface unless something from it reaches a production store.",
      },
    ],
  },
  {
    id: "conv-freeze",
    title: "Change freeze policy",
    updatedAt: ago(16 * DAY),
    messages: [
      {
        id: "f1",
        role: "user",
        at: ago(16 * DAY),
        text: "When are you allowed to freeze a service without asking me?",
      },
      {
        id: "f2",
        role: "agent",
        at: ago(16 * DAY),
        read: true,
        text:
          "Only for a reachable critical on an internet-facing service, and only until the fix merges. Anything else I ask first. That rule lives in the brain, so you can change it there.",
      },
    ],
  },
];

/** Conversation folders under `/chat`. A chat gets a folder because it exists. */
export const CONVERSATION_FILES: ConversationFilesItem[] = [
  {
    conversation_id: "conv-kode-reach",
    title: "Reachability, not just severity",
    last_update: ago(2 * DAY),
    files: [
      file("call-graph-entrypoints.json", 1_884_112, "application/json", ago(2 * DAY), "/chat/conv-kode-reach"),
      file("scoring-change.md", 8_204, "text/markdown", ago(2 * DAY), "/chat/conv-kode-reach"),
    ],
  },
  {
    conversation_id: "conv-dpflo-scope",
    title: "Scope dpflo to production only",
    last_update: ago(9 * DAY),
    files: [
      file("prod-account-tags.csv", 24_880, "text/csv", ago(9 * DAY), "/chat/conv-dpflo-scope"),
    ],
  },
  {
    conversation_id: "conv-freeze",
    title: "Change freeze policy",
    last_update: ago(16 * DAY),
    files: [],
  },
];

/* ---------------------------------------------------------------------------
   Brain — what it believes, and where the belief came from
   ------------------------------------------------------------------------ */

export interface Belief {
  id: string;
  claim: string;
  source: string;
  learnedAt: string;
  confidence: "asserted" | "observed" | "inferred";
}

export const BELIEFS: Belief[] = [
  {
    id: "b1",
    claim: "api-gateway is the only internet-facing service in the estate.",
    source: "Observed — ALB target groups, 3 AWS accounts",
    learnedAt: ago(4 * DAY),
    confidence: "observed",
  },
  {
    id: "b2",
    claim: "Production is anything tagged env:prod. Staging does not count unless it reaches prod.",
    source: "You told me, in “Scope dpflo to production only”",
    learnedAt: ago(9 * DAY),
    confidence: "asserted",
  },
  {
    id: "b3",
    claim: "A reachable critical on an internet-facing service may be frozen without asking.",
    source: "You told me, in “Change freeze policy”",
    learnedAt: ago(16 * DAY),
    confidence: "asserted",
  },
  {
    id: "b4",
    claim: "203.0.113.44 is a contracted scanner, not an attacker.",
    source: "Your note on SREonCall",
    learnedAt: ago(24 * DAY),
    confidence: "asserted",
  },
  {
    id: "b5",
    claim: "The billing-svc export is the estate's only cross-border data flow.",
    source: "Inferred — dpflo flow map, eu-west refresh",
    learnedAt: ago(2 * HOUR),
    confidence: "inferred",
  },
];

export interface LedgerEntry {
  id: string;
  what: string;
  at: string;
  state: "done" | "running" | "waiting" | "planned";
  app?: string;
}

export const TASK_LEDGER: LedgerEntry[] = [
  { id: "t1", what: "Opened PR #482 against api-gateway and froze deploys", at: ago(11 * MINUTE), state: "running", app: "kodeshield" },
  { id: "t2", what: "Re-mapped data flows for eu-west", at: ago(2 * HOUR), state: "done", app: "dpflo" },
  { id: "t3", what: "Wrote the checkout-latency postmortem", at: ago(19 * HOUR), state: "done", app: "sreoncall" },
  { id: "t4", what: "Waiting on a retention decision for ticket bodies", at: ago(12 * DAY), state: "waiting", app: "dpflo" },
  { id: "t5", what: "Quarterly access review, scheduled", at: ago(-6 * DAY), state: "planned", app: "auditiseasy" },
];

/* ---------------------------------------------------------------------------
   Spotlight — people, sources, and what search returns
   ------------------------------------------------------------------------ */

export interface Person {
  id: string;
  name: string;
  email: string;
  /** Tailwind-free: a literal tint for the avatar tile. */
  tint: string;
  initials: string;
  messages: number;
}

export const PEOPLE: Person[] = [
  { id: "p1", name: "Amelia Davis", email: "davis@example.com", tint: "#E8B04B", initials: "AD", messages: 1 },
  { id: "p2", name: "Harper Martinez", email: "gmartinez@example.com", tint: "#3FA75A", initials: "HM", messages: 3 },
  { id: "p3", name: "Gabriel Reed", email: "reed@example.com", tint: "#8B5CF6", initials: "GR", messages: 6 },
  { id: "p4", name: "Noah Anderson", email: "anderson@example.com", tint: "#3B82F6", initials: "NA", messages: 8 },
];

export interface SpotlightFile {
  id: string;
  name: string;
  category: string;
  kind: "PDF" | "CSV" | "DOC" | "XLS" | "JSON";
  size: number;
  modifiedAt: string;
  modifiedBy: string;
  path: string;
}

export const SPOTLIGHT_FILES: SpotlightFile[] = [
  {
    id: "f1",
    name: "Reachability Report v4",
    category: "Technical Spec",
    kind: "PDF",
    size: 2_411_724,
    modifiedAt: ago(2 * HOUR),
    modifiedBy: "SOS",
    path: "apps/kodeshield/4/outputs",
  },
  {
    id: "f2",
    name: "CVE Matrix",
    category: "Guide",
    kind: "CSV",
    size: 184_320,
    modifiedAt: ago(DAY),
    modifiedBy: "SOS",
    path: "apps/kodeshield/4/outputs",
  },
  {
    id: "f3",
    name: "Flow Map — eu-west",
    category: "Research",
    kind: "PDF",
    size: 5_182_004,
    modifiedAt: ago(2 * HOUR),
    modifiedBy: "SOS",
    path: "apps/dpflo/3/outputs",
  },
  {
    id: "f4",
    name: "CC6 Evidence Pack",
    category: "Planning",
    kind: "DOC",
    size: 8_931_226,
    modifiedAt: ago(3 * DAY),
    modifiedBy: "SOS",
    path: "apps/auditiseasy/1/outputs",
  },
  {
    id: "f5",
    name: "Postmortem — Checkout Latency",
    category: "Research",
    kind: "PDF",
    size: 1_820_442,
    modifiedAt: ago(19 * HOUR),
    modifiedBy: "SOS",
    path: "apps/sreoncall/2/outputs",
  },
];

/**
 * The connected sources the Spotlight tab row shows.
 *
 * Each keeps its own brand colour — the single exception to "colour means
 * meaning", because recognising a source at a glance *is* the meaning, and a
 * row of identical grey tiles would be unreadable.
 *
 * `glyph` names a Lucide symbol rather than a vendor logo: shipping
 * approximated trademarks is worse than an honest stroke icon, and it keeps the
 * row at the system's 1.5 weight. Swap in real marks when the integrations are
 * real and their assets come with them.
 */
export interface Source {
  id: string;
  label: string;
  tint: string;
  glyph: "cloud" | "git" | "chat" | "mail" | "board" | "pulse" | "key" | "drive";
}

export const SOURCES: Source[] = [
  { id: "aws", label: "AWS", tint: "#FF9900", glyph: "cloud" },
  { id: "github", label: "GitHub", tint: "#E8E8EC", glyph: "git" },
  { id: "slack", label: "Slack", tint: "#E01E5A", glyph: "chat" },
  { id: "gmail", label: "Gmail", tint: "#EA4335", glyph: "mail" },
  { id: "jira", label: "Jira", tint: "#2684FF", glyph: "board" },
  { id: "datadog", label: "Datadog", tint: "#8B5CF6", glyph: "pulse" },
  { id: "okta", label: "Okta", tint: "#4DA3E5", glyph: "key" },
  { id: "drive", label: "Drive", tint: "#34A853", glyph: "drive" },
];
