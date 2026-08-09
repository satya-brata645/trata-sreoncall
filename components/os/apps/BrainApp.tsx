"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import * as THREE from "three";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cpu,
  GitBranch,
  Link2,
  Radar,
} from "lucide-react";

import { Icon, SectionLabel, StatusDot } from "@/components/ui/primitives";
import { cn, formatCompactRelativeTime } from "@/lib/utils";
import type { OsAppProps } from "@/lib/os/types";

type Panel = "config" | "memory" | "cortex";
type BrainView = "timeline" | "kanban";
type AgentState = "running" | "watching" | "queued" | "done";
type HypothesisState = "leading" | "active" | "watching";
type GraphNodeKind = "core" | "faculty" | "cluster" | "leaf";
type EdgeKind = "hierarchy" | "association";

type BrainLeaf = {
  id: string;
  label: string;
  activity: number;
};

type BrainChild = {
  id: string;
  label: string;
  activity: number;
  leaves: BrainLeaf[];
};

type BrainFaculty = {
  id: string;
  label: string;
  angle: number;
  distance: number;
  color: string;
  activity: number;
  children: BrainChild[];
};

type Agent = {
  id: string;
  role: string;
  focus: string;
  state: AgentState;
  color: string;
};

type Hypothesis = {
  id: string;
  statement: string;
  confidence: number;
  evidence: string;
  status: HypothesisState;
};

type WorkingMemoryEntry = {
  id: string;
  at: string;
  speaker: string;
  text: string;
};

type KanbanCard = {
  id: string;
  title: string;
  owner: string;
  detail: string;
};

type KanbanStage = {
  id: string;
  label: string;
  color: string;
  cards: KanbanCard[];
};

type TimelineTask = {
  id: string;
  label: string;
  start: number;
  end: number;
  state: "done" | "live" | "queued";
};

type TimelineRow = {
  agent: string;
  role: string;
  color: string;
  tasks: TimelineTask[];
};

type GraphNode = {
  id: string;
  label: string;
  kind: GraphNodeKind;
  color: string;
  activity: number;
  x: number;
  y: number;
  z: number;
  parentId?: string;
};

type GraphEdge = {
  from: string;
  to: string;
  kind: EdgeKind;
};

type GraphModel = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeMap: Map<string, GraphNode>;
  inbound: Map<string, string[]>;
  outbound: Map<string, string[]>;
};

type InspectorSelection =
  | { kind: "agent"; id: string }
  | { kind: "hypothesis"; id: string }
  | { kind: "card"; id: string }
  | { kind: "task"; id: string }
  | { kind: "memory"; id: string }
  | { kind: "path"; id: string }
  | { kind: "node"; id: string };

type InspectorLog = {
  at: string;
  label: string;
  text: string;
};

type InspectorDetail = {
  title: string;
  subtitle: string;
  status: string;
  tone: "cyan" | "amber" | "rose" | "violet" | "emerald" | "slate";
  summary: string;
  thinking: string[];
  logs: InspectorLog[];
  checks: string[];
  note?: string;
};

type NodeInsight = {
  status: string;
  summary: string;
  thinking: string[];
  logs: InspectorLog[];
  markdown: string;
  agents: string[];
};

const PANELS: Array<{ id: Panel; label: string }> = [
  { id: "config", label: "Config" },
  { id: "memory", label: "Memory" },
  { id: "cortex", label: "Cortex" },
];

const BRAIN_VIEWS: Array<{
  id: BrainView;
  label: string;
  icon: typeof BrainCircuit;
}> = [
  { id: "timeline", label: "Timeline", icon: Clock3 },
  { id: "kanban", label: "Kanban", icon: GitBranch },
];

const INCIDENT = {
  id: "INC-3117",
  severity: "P1",
  title: "Checkout pods in CrashLoopBackOff after node-pool upgrade",
  status: "Diagnosing",
  confidence: 0.84,
  startedAt: new Date(Date.now() - 16 * 60_000).toISOString(),
  summary:
    "The replacement node pool ships lower allocatable memory. Checkout pods are OOMKilled, then kubelet eviction churn compounds restart pressure across the deployment.",
  nextAction: "Rollback the node pool class after verifying request/limit skew on checkout.",
};

const HYPOTHESES: Hypothesis[] = [
  {
    id: "h1",
    statement: "New node class reduced allocatable memory below checkout working-set demand.",
    confidence: 0.89,
    evidence: "Node metrics show a 22% drop in allocatable memory versus the previous pool.",
    status: "leading",
  },
  {
    id: "h2",
    statement: "OOMKilled containers triggered a kubelet eviction cascade and replica churn.",
    confidence: 0.77,
    evidence: "Events, restarts, and kubelet logs line up within the same three-minute window.",
    status: "active",
  },
  {
    id: "h3",
    statement: "Autoscaler rebalancing amplified the blast radius after the first evictions.",
    confidence: 0.44,
    evidence: "Scale actions overlap, but they trail the first OOM by nearly two minutes.",
    status: "watching",
  },
];

const AGENTS: Agent[] = [
  {
    id: "ATLAS",
    role: "orchestrator",
    focus: "Owning incident flow and decision sequencing",
    state: "running",
    color: "#a78bfa",
  },
  {
    id: "TRIAGE",
    role: "alert correlation",
    focus: "Collapsing alerts into one incident narrative",
    state: "running",
    color: "#f472b6",
  },
  {
    id: "SCOPE",
    role: "root cause",
    focus: "Diffing node-pool capacity and workload demand",
    state: "running",
    color: "#67e8f9",
  },
  {
    id: "MEDIC",
    role: "remediation",
    focus: "Preparing rollback and surge-capacity plan",
    state: "watching",
    color: "#34d399",
  },
  {
    id: "SENTRY",
    role: "verification",
    focus: "Watching burn rate, restart slope, and SLO recovery",
    state: "watching",
    color: "#fbbf24",
  },
  {
    id: "SCRIBE",
    role: "memory & comms",
    focus: "Writing the decision log and stakeholder updates",
    state: "queued",
    color: "#fb7185",
  },
];

const WORKING_MEMORY: WorkingMemoryEntry[] = [
  {
    id: "wm-1",
    at: "T+02m",
    speaker: "TRIAGE",
    text: "PagerDuty page, replica mismatch, and SLO burn collapse into one P1 centered on checkout.",
  },
  {
    id: "wm-2",
    at: "T+04m",
    speaker: "SCOPE",
    text: "CrashLoop pods all landed on the new pool. The old pool is still healthy with identical images.",
  },
  {
    id: "wm-3",
    at: "T+07m",
    speaker: "ATLAS",
    text: "Biasing toward a capacity regression, not an application regression. Keep config diff and metrics joined.",
  },
  {
    id: "wm-4",
    at: "T+10m",
    speaker: "MEDIC",
    text: "Rollback path is ready. Waiting on one more verification pass so we do not mask the cause with extra churn.",
  },
  {
    id: "wm-5",
    at: "T+13m",
    speaker: "SCRIBE",
    text: "Stakeholder draft prepared: degraded checkout, active mitigation in progress, next update in seven minutes.",
  },
];

const HOT_PATH = [
  {
    id: "path-1",
    label: "Perception -> Metrics -> node_allocatable_memory",
    summary: "The memory delta surfaced first as a metrics signature before any rollback decision.",
  },
  {
    id: "path-2",
    label: "Perception -> Kubernetes events -> OOMKilled / Evicted",
    summary: "Events confirm the symptom chain and separate the first failure from secondary churn.",
  },
  {
    id: "path-3",
    label: "Reasoning -> Hypothesis engine -> memory delta",
    summary: "The leading theory consolidates allocatable memory, working set, and restart evidence.",
  },
  {
    id: "path-4",
    label: "Knowledge -> Runbooks -> checkout rollback order",
    summary: "Rollback is gated by a known sequence so the platform avoids a second eviction wave.",
  },
  {
    id: "path-5",
    label: "Tooling -> kubectl / Grafana / ArgoCD",
    summary: "Those three tools are carrying the incident from signal intake to remediation approval.",
  },
];

const KANBAN: KanbanStage[] = [
  {
    id: "detected",
    label: "Detected",
    color: "#f472b6",
    cards: [
      {
        id: "k1",
        title: "Deduplicate alert flood into INC-3117",
        owner: "TRIAGE",
        detail: "PagerDuty, SLO burn, and pod health alerts now point to one incident root.",
      },
    ],
  },
  {
    id: "diagnosing",
    label: "Diagnosing",
    color: "#67e8f9",
    cards: [
      {
        id: "k2",
        title: "Compare old vs new node allocatable memory",
        owner: "SCOPE",
        detail: "Capacity delta suggests the new pool cannot hold current checkout memory limits.",
      },
      {
        id: "k3",
        title: "Join OOM, eviction, and rollout timeline",
        owner: "ATLAS",
        detail: "Ordering matters: first OOM preceded autoscaler movement and the restart storm.",
      },
    ],
  },
  {
    id: "fixing",
    label: "Fixing",
    color: "#34d399",
    cards: [
      {
        id: "k4",
        title: "Prepare node-pool rollback and burst cushion",
        owner: "MEDIC",
        detail: "Rollback plan includes surge nodes and drain order to avoid a second eviction wave.",
      },
    ],
  },
  {
    id: "verifying",
    label: "Verifying",
    color: "#fbbf24",
    cards: [
      {
        id: "k5",
        title: "Track restart slope, burn rate, and checkout availability",
        owner: "SENTRY",
        detail: "Success means restarts flatten, 5xx recede, and burn rate returns under 1x.",
      },
    ],
  },
  {
    id: "closed",
    label: "Closed",
    color: "#94a3b8",
    cards: [
      {
        id: "k6",
        title: "Draft postmortem and memory write-back",
        owner: "SCRIBE",
        detail: "Queued until mitigation is proven stable and decision points are final.",
      },
    ],
  },
];

const TIMELINE_TOTAL = 22;

const TIMELINE: TimelineRow[] = [
  {
    agent: "ATLAS",
    role: "orchestrator",
    color: "#a78bfa",
    tasks: [
      { id: "t-atlas-1", label: "Open incident + route agents", start: 0, end: 2, state: "done" },
      { id: "t-atlas-2", label: "Merge evidence into one theory", start: 2, end: 11, state: "live" },
      { id: "t-atlas-3", label: "Approve rollback", start: 11, end: 16, state: "queued" },
    ],
  },
  {
    agent: "TRIAGE",
    role: "alerts",
    color: "#f472b6",
    tasks: [
      { id: "t-triage-1", label: "Correlate pages", start: 0, end: 4, state: "done" },
      { id: "t-triage-2", label: "Reduce noise floor", start: 4, end: 9, state: "done" },
      { id: "t-triage-3", label: "Watch for secondary services", start: 9, end: 18, state: "live" },
    ],
  },
  {
    agent: "SCOPE",
    role: "root cause",
    color: "#67e8f9",
    tasks: [
      { id: "t-scope-1", label: "Node-pool diff", start: 1, end: 8, state: "done" },
      { id: "t-scope-2", label: "OOM / eviction timeline join", start: 8, end: 15, state: "live" },
      { id: "t-scope-3", label: "Confirm allocatable regression", start: 15, end: 19, state: "queued" },
    ],
  },
  {
    agent: "MEDIC",
    role: "remediation",
    color: "#34d399",
    tasks: [
      { id: "t-medic-1", label: "Model rollback path", start: 6, end: 11, state: "done" },
      { id: "t-medic-2", label: "Pre-stage rollback change", start: 11, end: 17, state: "live" },
      { id: "t-medic-3", label: "Raise surge pool", start: 17, end: 21, state: "queued" },
    ],
  },
  {
    agent: "SENTRY",
    role: "verification",
    color: "#fbbf24",
    tasks: [
      { id: "t-sentry-1", label: "Burn-rate watch", start: 2, end: 10, state: "done" },
      { id: "t-sentry-2", label: "Restart and latency verification", start: 10, end: 19, state: "live" },
    ],
  },
  {
    agent: "SCRIBE",
    role: "memory & comms",
    color: "#fb7185",
    tasks: [
      { id: "t-scribe-1", label: "Decision log", start: 3, end: 9, state: "done" },
      { id: "t-scribe-2", label: "Stakeholder updates", start: 9, end: 14, state: "live" },
      { id: "t-scribe-3", label: "Postmortem scaffold", start: 14, end: 22, state: "queued" },
    ],
  },
];

const FACULTIES: BrainFaculty[] = [
  {
    id: "skillset",
    label: "Skillset",
    angle: -88,
    distance: 29,
    color: "#67e8f9",
    activity: 0.86,
    children: [
      {
        id: "k8s",
        label: "Kubernetes",
        activity: 0.96,
        leaves: [
          { id: "pods", label: "Pods", activity: 0.88 },
          { id: "evictions", label: "Evictions", activity: 0.93 },
        ],
      },
      {
        id: "obs",
        label: "Observability",
        activity: 0.83,
        leaves: [
          { id: "restarts", label: "Restarts", activity: 0.8 },
          { id: "burn", label: "Burn rate", activity: 0.77 },
        ],
      },
      {
        id: "linux",
        label: "Linux",
        activity: 0.62,
        leaves: [
          { id: "cgroup", label: "cgroups", activity: 0.55 },
          { id: "oom", label: "OOM killer", activity: 0.79 },
        ],
      },
      {
        id: "iac",
        label: "IaC",
        activity: 0.44,
        leaves: [
          { id: "nodeclass", label: "Node class", activity: 0.61 },
          { id: "limits", label: "Resource limits", activity: 0.58 },
        ],
      },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    angle: -18,
    distance: 28,
    color: "#fbbf24",
    activity: 0.7,
    children: [
      {
        id: "runbooks",
        label: "Runbooks",
        activity: 0.82,
        leaves: [
          { id: "rollback", label: "Rollback order", activity: 0.84 },
          { id: "stabilize", label: "Stabilize checklist", activity: 0.76 },
        ],
      },
      {
        id: "postmortems",
        label: "Postmortems",
        activity: 0.45,
        leaves: [
          { id: "jan", label: "Pool resize", activity: 0.49 },
          { id: "q2", label: "Checkout RCA", activity: 0.56 },
        ],
      },
      {
        id: "rca",
        label: "RCAs",
        activity: 0.66,
        leaves: [
          { id: "memory", label: "Memory starvation", activity: 0.72 },
          { id: "churn", label: "Node churn", activity: 0.59 },
        ],
      },
      {
        id: "slos",
        label: "SLO specs",
        activity: 0.61,
        leaves: [
          { id: "avail", label: "Availability", activity: 0.68 },
          { id: "latency", label: "Latency", activity: 0.63 },
        ],
      },
    ],
  },
  {
    id: "perception",
    label: "Perception",
    angle: 42,
    distance: 30,
    color: "#f472b6",
    activity: 0.9,
    children: [
      {
        id: "alerts",
        label: "Alerts",
        activity: 0.84,
        leaves: [
          { id: "pd", label: "PagerDuty", activity: 0.74 },
          { id: "replicas", label: "Replica mismatch", activity: 0.78 },
        ],
      },
      {
        id: "metrics",
        label: "Metrics",
        activity: 0.97,
        leaves: [
          { id: "alloc", label: "Allocatable mem", activity: 0.99 },
          { id: "working", label: "Working set", activity: 0.88 },
        ],
      },
      {
        id: "logs",
        label: "Logs",
        activity: 0.72,
        leaves: [
          { id: "oomk", label: "OOMKilled", activity: 0.9 },
          { id: "kubelet", label: "kubelet", activity: 0.73 },
        ],
      },
      {
        id: "events",
        label: "K8s events",
        activity: 0.86,
        leaves: [
          { id: "backoff", label: "BackOff", activity: 0.8 },
          { id: "evicted2", label: "Evicted", activity: 0.91 },
        ],
      },
    ],
  },
  {
    id: "reasoning",
    label: "Reasoning",
    angle: 112,
    distance: 28,
    color: "#a78bfa",
    activity: 0.94,
    children: [
      {
        id: "triage",
        label: "Triage",
        activity: 0.8,
        leaves: [
          { id: "dedupe", label: "Dedupe", activity: 0.78 },
          { id: "blast", label: "Blast radius", activity: 0.66 },
        ],
      },
      {
        id: "hypothesis",
        label: "Hypothesis engine",
        activity: 0.99,
        leaves: [
          { id: "delta", label: "Memory delta", activity: 0.98 },
          { id: "causal", label: "Causal chain", activity: 0.92 },
        ],
      },
      {
        id: "rca2",
        label: "RCA engine",
        activity: 0.82,
        leaves: [
          { id: "diff", label: "Config diff", activity: 0.75 },
          { id: "join", label: "Timeline join", activity: 0.85 },
        ],
      },
      {
        id: "verifier",
        label: "Verifier",
        activity: 0.76,
        leaves: [
          { id: "slo", label: "SLO recovery", activity: 0.77 },
          { id: "restarts2", label: "Restart slope", activity: 0.71 },
        ],
      },
    ],
  },
  {
    id: "tooling",
    label: "Tooling",
    angle: 178,
    distance: 29,
    color: "#34d399",
    activity: 0.73,
    children: [
      {
        id: "kubectl",
        label: "kubectl",
        activity: 0.94,
        leaves: [
          { id: "describe", label: "describe", activity: 0.82 },
          { id: "top", label: "top nodes", activity: 0.9 },
        ],
      },
      {
        id: "grafana",
        label: "Grafana",
        activity: 0.84,
        leaves: [
          { id: "dash", label: "Dashboards", activity: 0.83 },
          { id: "slo2", label: "Burn panels", activity: 0.74 },
        ],
      },
      {
        id: "argocd",
        label: "ArgoCD",
        activity: 0.57,
        leaves: [
          { id: "manifest", label: "Manifest diff", activity: 0.63 },
          { id: "rollback2", label: "Rollback", activity: 0.67 },
        ],
      },
      {
        id: "terraform",
        label: "Terraform",
        activity: 0.49,
        leaves: [
          { id: "poolcfg", label: "Pool config", activity: 0.58 },
          { id: "instance", label: "Instance class", activity: 0.52 },
        ],
      },
    ],
  },
  {
    id: "memory",
    label: "Memory",
    angle: 232,
    distance: 27,
    color: "#60a5fa",
    activity: 0.69,
    children: [
      {
        id: "working",
        label: "Working",
        activity: 0.91,
        leaves: [
          { id: "hyp", label: "Active hypothesis", activity: 0.91 },
          { id: "nextq", label: "Next query", activity: 0.82 },
        ],
      },
      {
        id: "episodic",
        label: "Episodic",
        activity: 0.56,
        leaves: [
          { id: "inc2441", label: "INC-2441", activity: 0.49 },
          { id: "sev2", label: "SEV-2 checkout", activity: 0.58 },
        ],
      },
      {
        id: "semantic",
        label: "Semantic",
        activity: 0.62,
        leaves: [
          { id: "topology", label: "Topology", activity: 0.63 },
          { id: "nodeclasses", label: "Node classes", activity: 0.69 },
        ],
      },
      {
        id: "procedural",
        label: "Procedural",
        activity: 0.68,
        leaves: [
          { id: "checklist", label: "Verify checklist", activity: 0.7 },
          { id: "handoff", label: "Handoff order", activity: 0.55 },
        ],
      },
    ],
  },
  {
    id: "comms",
    label: "Comms",
    angle: 302,
    distance: 28,
    color: "#fb7185",
    activity: 0.55,
    children: [
      {
        id: "incident-channel",
        label: "Incident channel",
        activity: 0.78,
        leaves: [
          { id: "asks", label: "Operator asks", activity: 0.66 },
          { id: "updates", label: "Live updates", activity: 0.75 },
        ],
      },
      {
        id: "status-page",
        label: "Status page",
        activity: 0.49,
        leaves: [
          { id: "note", label: "Customer note", activity: 0.52 },
          { id: "eta", label: "ETA", activity: 0.43 },
        ],
      },
      {
        id: "stakeholders",
        label: "Stakeholder updates",
        activity: 0.62,
        leaves: [
          { id: "exec", label: "Exec brief", activity: 0.59 },
          { id: "ops", label: "Ops sync", activity: 0.64 },
        ],
      },
      {
        id: "handoffs",
        label: "Handoffs",
        activity: 0.41,
        leaves: [
          { id: "owners", label: "Owner ledger", activity: 0.46 },
          { id: "decisions", label: "Decision log", activity: 0.54 },
        ],
      },
    ],
  },
];

const CONFIG_ROWS: Array<[string, string]> = [
  ["Speak when", "It changes what I believe or what I do next"],
  ["Loud on", "Production exposure, safety risk, prolonged customer impact"],
  ["Quiet on", "Low-signal noise, staging churn, informational drift"],
  ["Cadence", "Fast while uncertain, slower once the risk envelope narrows"],
  ["May act alone", "Reachable production instability with a reversible fix path"],
  ["Always ask", "Anything that changes data, access, or non-trivial spend"],
];

const STARFIELD = Array.from({ length: 72 }, (_, index) => ({
  x: (index * 17.23 + (index % 5) * 9.7) % 100,
  y: (index * 11.91 + (index % 7) * 7.1) % 100,
  r: 0.08 + (index % 4) * 0.05,
  o: 0.12 + (index % 5) * 0.08,
}));

const GRAPH_ASSOCIATIONS: Array<[string, string]> = [
  ["metrics", "delta"],
  ["alloc", "memory"],
  ["working", "hyp"],
  ["oomk", "evictions"],
  ["runbooks", "rollback2"],
  ["kubelet", "join"],
  ["top", "alloc"],
  ["burn", "slo"],
  ["stakeholders", "updates"],
  ["decisions", "hypothesis"],
];

const NODE_AGENT_FALLBACK: Record<string, string[]> = {
  core: ["ATLAS"],
  skillset: ["SCOPE", "MEDIC"],
  knowledge: ["ATLAS", "SCRIBE"],
  perception: ["TRIAGE", "SENTRY"],
  reasoning: ["ATLAS", "SCOPE"],
  tooling: ["MEDIC", "SCOPE"],
  memory: ["SCRIBE", "ATLAS"],
  comms: ["SCRIBE"],
  metrics: ["SCOPE", "SENTRY"],
  alloc: ["SCOPE"],
  runbooks: ["MEDIC", "ATLAS"],
  rollback: ["MEDIC"],
  delta: ["SCOPE"],
  evicted2: ["TRIAGE", "SENTRY"],
  working: ["ATLAS"],
  stakeholders: ["SCRIBE"],
};

const NODE_SUMMARY_OVERRIDES: Record<string, string> = {
  core: "The identity layer keeping the system blameless, verify-first, calm under load, and willing to escalate early.",
  metrics: "Metrics is the hottest perception branch because allocatable memory and workload demand diverged immediately after the node-pool change.",
  alloc: "This leaf is carrying the strongest numerical signal in the incident: the new pool exposes materially less allocatable memory.",
  delta: "The hypothesis engine has collapsed the incident around one causal delta rather than a spread of unrelated symptoms.",
  runbooks: "Runbooks are hot because rollback order matters more than rollback speed once evictions are in play.",
  rollback: "The rollback sequence is not optional choreography. It is the safety rail preventing more pod churn during recovery.",
  working: "Working memory is holding the live theory, the unanswered questions, and the next query queue at once.",
  evicted2: "Evicted events are separating primary failure from downstream scheduler churn.",
};

const NODE_MARKDOWN_OVERRIDES: Record<string, string> = {
  core: [
    "## Personality core",
    "The center is not a knowledge bucket. It is an operating contract.",
    "",
    "- blameless under uncertainty",
    "- verify-first before narrative lock-in",
    "- calm under load",
    "- escalate early when customer risk expands",
    "",
    "## Current posture",
    "The core is biasing the system toward a **capacity regression** explanation, not an application regression. That keeps the remediation path reversible while evidence is still converging.",
  ].join("\n"),
  metrics: [
    "## Why metrics is hot",
    "The strongest evidence arrived from the metrics branch before logs or comms caught up.",
    "",
    "```text",
    "old_pool.allocatable_memory  >  checkout_working_set",
    "new_pool.allocatable_memory  <  checkout_working_set",
    "```",
    "",
    "## Operational meaning",
    "This node is telling the cortex that the failure mode is structural. The workloads did not suddenly become hungrier; the floor moved beneath them.",
  ].join("\n"),
  alloc: [
    "## Leaf note: Allocatable mem",
    "The allocatable memory line is the clearest explanation of why pods that were stable before the upgrade began to OOM after rescheduling.",
    "",
    "## Incident implication",
    "If this leaf stays true, rollback beats tuning. Fixing requests and limits is remediation for later, not the move that ends the page right now.",
  ].join("\n"),
  delta: [
    "## Leaf note: Memory delta",
    "The cortex is using this leaf as the leading causal hinge.",
    "",
    "1. Node pool changes reduce allocatable headroom.",
    "2. Checkout pods restart under the new floor.",
    "3. kubelet begins eviction churn.",
    "4. The blast radius widens through rescheduling pressure.",
  ].join("\n"),
  rollback: [
    "## Runbook excerpt",
    "Rollback is a **sequence**, not a switch.",
    "",
    "- restore old node class capacity",
    "- stage surge headroom",
    "- drain upgraded nodes in controlled order",
    "- verify restart slope and burn rate before closure",
  ].join("\n"),
};

function polar(x: number, y: number, radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: x + Math.cos(radians) * radius,
    y: y + Math.sin(radians) * radius,
  };
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function nodeRadius(node: GraphNode) {
  if (node.kind === "core") return 1.45;
  if (node.kind === "faculty") return 0.52;
  if (node.kind === "cluster") return 0.28;
  return 0.18;
}

function worldPosition(node: GraphNode) {
  return new THREE.Vector3((node.x - 50) * 0.18, (50 - node.y) * 0.18, node.z * 0.32);
}

function buildGraphModel(): GraphModel {
  const nodes: GraphNode[] = [
    {
      id: "core",
      label: "Personality Core",
      kind: "core",
      color: "#f8fafc",
      activity: 1,
      x: 50,
      y: 50,
      z: 24,
    },
  ];
  const edges: GraphEdge[] = [];

  FACULTIES.forEach((faculty) => {
    const facultyPoint = polar(50, 50, faculty.distance, faculty.angle);
    const facultyNode: GraphNode = {
      id: faculty.id,
      label: faculty.label,
      kind: "faculty",
      color: faculty.color,
      activity: faculty.activity,
      x: facultyPoint.x,
      y: facultyPoint.y,
      z: 18 + Math.sin((faculty.angle * Math.PI) / 180) * 4,
      parentId: "core",
    };
    nodes.push(facultyNode);
    edges.push({ from: "core", to: faculty.id, kind: "hierarchy" });

    const childSpread = faculty.children.length > 1 ? 58 / (faculty.children.length - 1) : 0;

    faculty.children.forEach((child, index) => {
      const childAngle = faculty.angle + (index - (faculty.children.length - 1) / 2) * childSpread;
      const childPoint = polar(facultyPoint.x, facultyPoint.y, 10.5 + (index % 2) * 1.8, childAngle);
      const childNode: GraphNode = {
        id: child.id,
        label: child.label,
        kind: "cluster",
        color: faculty.color,
        activity: child.activity,
        x: childPoint.x,
        y: childPoint.y,
        z: facultyNode.z - 4 + (index % 2 === 0 ? 2.8 : -2.2),
        parentId: faculty.id,
      };
      nodes.push(childNode);
      edges.push({ from: faculty.id, to: child.id, kind: "hierarchy" });

      const leafSpread = child.leaves.length > 1 ? 18 / (child.leaves.length - 1) : 0;
      child.leaves.forEach((leaf, leafIndex) => {
        const leafAngle =
          childAngle +
          (leafIndex - (child.leaves.length - 1) / 2) * leafSpread +
          (index % 2 === 0 ? -8 : 8);
        const leafPoint = polar(childPoint.x, childPoint.y, 4.8 + leafIndex * 0.7, leafAngle);
        nodes.push({
          id: leaf.id,
          label: leaf.label,
          kind: "leaf",
          color: faculty.color,
          activity: leaf.activity,
          x: leafPoint.x,
          y: leafPoint.y,
          z: childNode.z - 2.8 + leafIndex * 2.2,
          parentId: child.id,
        });
        edges.push({ from: child.id, to: leaf.id, kind: "hierarchy" });
      });
    });
  });

  GRAPH_ASSOCIATIONS.forEach(([from, to]) => {
    edges.push({ from, to, kind: "association" });
  });

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const inbound = new Map<string, string[]>();
  const outbound = new Map<string, string[]>();

  edges.forEach((edge) => {
    const currentOut = outbound.get(edge.from) ?? [];
    currentOut.push(edge.to);
    outbound.set(edge.from, currentOut);

    const currentIn = inbound.get(edge.to) ?? [];
    currentIn.push(edge.from);
    inbound.set(edge.to, currentIn);
  });

  return { nodes, edges, nodeMap, inbound, outbound };
}

const GRAPH_MODEL = buildGraphModel();

function getAgent(agentId: string) {
  return AGENTS.find((agent) => agent.id === agentId);
}

function getNodeAgents(nodeId: string) {
  const direct = NODE_AGENT_FALLBACK[nodeId];
  if (direct) return direct;

  const node = GRAPH_MODEL.nodeMap.get(nodeId);
  if (!node) return ["ATLAS"];

  if (node.parentId && NODE_AGENT_FALLBACK[node.parentId]) {
    return NODE_AGENT_FALLBACK[node.parentId];
  }

  return ["ATLAS"];
}

function buildNodeInsight(nodeId: string): NodeInsight {
  const node = GRAPH_MODEL.nodeMap.get(nodeId);
  if (!node) {
    return {
      status: "Unavailable",
      summary: "This node is not present in the current graph model.",
      thinking: ["The selected node could not be resolved."],
      logs: [],
      markdown: "## Missing node\nThis selection could not be loaded.",
      agents: ["ATLAS"],
    };
  }

  const inbound = (GRAPH_MODEL.inbound.get(nodeId) ?? [])
    .map((id) => GRAPH_MODEL.nodeMap.get(id))
    .filter((value): value is GraphNode => Boolean(value));
  const outbound = (GRAPH_MODEL.outbound.get(nodeId) ?? [])
    .map((id) => GRAPH_MODEL.nodeMap.get(id))
    .filter((value): value is GraphNode => Boolean(value));
  const agents = getNodeAgents(nodeId);
  const leadAgent = getAgent(agents[0]);
  const status =
    node.activity > 0.9
      ? "Hot"
      : node.activity > 0.72
        ? "Active"
        : node.activity > 0.54
          ? "Watching"
          : "Background";
  const summary =
    NODE_SUMMARY_OVERRIDES[node.id] ??
    `${node.label} is part of the ${node.kind === "faculty" ? "faculty" : "incident knowledge"} path and is being consulted because it changes what the cortex should do next.`;
  const markdown =
    NODE_MARKDOWN_OVERRIDES[node.id] ??
    [
      `## ${node.label}`,
      summary,
      "",
      "## Why this node matters now",
      `This ${node.kind} is being touched because the incident model is trying to prove or disprove the current memory-regression theory.`,
      "",
      "## Linked context",
      `- inbound signals: ${inbound.map((entry) => entry.label).join(", ") || "none"}`,
      `- outbound signals: ${outbound.map((entry) => entry.label).join(", ") || "none"}`,
      `- active agent owner: ${leadAgent?.id ?? "ATLAS"}`,
    ].join("\n");

  return {
    status,
    summary,
    thinking: [
      `${leadAgent?.id ?? "ATLAS"} is using ${node.label.toLowerCase()} to reduce uncertainty before acting.`,
      inbound.length
        ? `Inbound evidence from ${inbound.map((entry) => entry.label).join(", ")} is still shaping this node.`
        : `${node.label} is acting as a source node rather than a downstream consequence.`,
      outbound.length
        ? `Outbound links point to ${outbound.map((entry) => entry.label).join(", ")}, so any change here propagates quickly.`
        : "This node is currently a terminal observation, not a branching decision point.",
    ],
    logs: [
      {
        at: "T+05m",
        label: "Query",
        text: `${leadAgent?.id ?? "ATLAS"} pulled ${node.label.toLowerCase()} into the active incident graph.`,
      },
      {
        at: "T+09m",
        label: "Synthesis",
        text: summary,
      },
      {
        at: "T+12m",
        label: "Next use",
        text: outbound.length
          ? `This node now feeds ${outbound.map((entry) => entry.label).join(", ")}.`
          : "This node is being watched for confirmation rather than branching to new work.",
      },
    ],
    markdown,
    agents,
  };
}

function getInspectorDetail(selection: InspectorSelection): InspectorDetail {
  if (selection.kind === "agent") {
    const agent = getAgent(selection.id) ?? AGENTS[0];
    return {
      title: agent.id,
      subtitle: agent.role,
      status: agent.state,
      tone: agent.state === "running" ? "cyan" : agent.state === "watching" ? "amber" : "slate",
      summary: agent.focus,
      thinking: [
        `${agent.id} is currently prioritizing ${agent.focus.toLowerCase()}.`,
        agent.id === "ATLAS"
          ? "I need one theory good enough to sequence action without pretending certainty."
          : agent.id === "SCOPE"
            ? "The memory delta must explain both the first crash and the later eviction wave."
            : agent.id === "MEDIC"
              ? "Rollback is ready, but I do not want to hide the cause behind new churn."
              : agent.id === "SCRIBE"
                ? "Every decision needs to land in memory while it is still fresh."
                : "Reduce noise so the rest of the brain does not spend cycles on the wrong signal.",
      ],
      logs: [
        {
          at: "T+03m",
          label: "Focus acquired",
          text: `${agent.id} locked onto ${agent.focus.toLowerCase()}.`,
        },
        {
          at: "T+08m",
          label: "Status",
          text: `${agent.id} is ${agent.state} and still contributing to INC-3117.`,
        },
        {
          at: "T+14m",
          label: "Next move",
          text:
            agent.id === "SENTRY"
              ? "Keep burn-rate and restart slope below closure thresholds."
              : agent.id === "SCRIBE"
                ? "Prepare stakeholder update with confidence and decision delta."
                : "Push the current line of reasoning to the next decision boundary.",
        },
      ],
      checks: [
        "What evidence is this agent using?",
        "Which decision does this work unblock?",
        "What would make this agent change course?",
      ],
    };
  }

  if (selection.kind === "hypothesis") {
    const hypothesis = HYPOTHESES.find((entry) => entry.id === selection.id) ?? HYPOTHESES[0];
    return {
      title: "Hypothesis",
      subtitle: hypothesis.status,
      status: `${Math.round(hypothesis.confidence * 100)}% confidence`,
      tone: hypothesis.status === "leading" ? "emerald" : hypothesis.status === "active" ? "cyan" : "slate",
      summary: hypothesis.statement,
      thinking: [
        "This hypothesis stays alive only if it explains the first failure better than its alternatives.",
        hypothesis.evidence,
        hypothesis.status === "leading"
          ? "The cortex is leaning here because the theory predicts the observed failure ordering."
          : "This remains in play, but it is not carrying the incident by itself.",
      ],
      logs: [
        { at: "T+06m", label: "Evidence joined", text: hypothesis.evidence },
        {
          at: "T+11m",
          label: "Weighting",
          text:
            hypothesis.status === "leading"
              ? "Promoted to leading theory after allocatable-memory diff matched the restart wave."
              : "Still tracked as a secondary explanation until more evidence arrives.",
        },
      ],
      checks: ["What disproves it?", "What metric confirms it?", "What fix does it imply?"],
    };
  }

  if (selection.kind === "card") {
    const card = KANBAN.flatMap((stage) => stage.cards).find((entry) => entry.id === selection.id);
    const stage = KANBAN.find((entry) => entry.cards.some((cardEntry) => cardEntry.id === selection.id));
    if (!card || !stage) return getInspectorDetail({ kind: "agent", id: "ATLAS" });
    return {
      title: card.title,
      subtitle: `${stage.label} · ${card.owner}`,
      status: stage.label,
      tone: "violet",
      summary: card.detail,
      thinking: [
        `${card.owner} owns this card because it changes the current incident decision path.`,
        "The board is not ceremony here. It is the visible execution order of the active theory.",
        "Completion means the cortex can either act or discard a branch.",
      ],
      logs: [
        { at: "T+04m", label: "Queued", text: `${card.title} entered ${stage.label.toLowerCase()}.` },
        { at: "T+12m", label: "Progress", text: card.detail },
      ],
      checks: ["What evidence is attached?", "Who is blocked on this?", "What state does completion change?"],
    };
  }

  if (selection.kind === "task") {
    const row = TIMELINE.find((entry) => entry.tasks.some((task) => task.id === selection.id));
    const task = row?.tasks.find((entry) => entry.id === selection.id);
    if (!row || !task) return getInspectorDetail({ kind: "agent", id: "ATLAS" });
    return {
      title: task.label,
      subtitle: `${row.agent} · ${row.role}`,
      status: task.state,
      tone: task.state === "live" ? "cyan" : task.state === "done" ? "emerald" : "slate",
      summary: "This task is one execution bar inside the live multi-agent incident timeline.",
      thinking: [
        `${row.agent} is running this work in parallel with other incident branches.`,
        task.state === "live"
          ? "The task is still affecting the shape of the incident response."
          : task.state === "queued"
            ? "This task waits on upstream evidence, not on attention alone."
            : "This task has already changed the incident state and now serves as context.",
      ],
      logs: [
        { at: `T+${task.start}m`, label: "Started", text: `${task.label} opened on ${row.agent}.` },
        { at: `T+${task.end}m`, label: "Boundary", text: `Planned boundary for this task is T+${task.end}m.` },
      ],
      checks: ["What depends on this bar?", "Is it still on the critical path?", "Should this stay parallel?"],
    };
  }

  if (selection.kind === "memory") {
    const entry = WORKING_MEMORY.find((item) => item.id === selection.id) ?? WORKING_MEMORY[0];
    return {
      title: entry.speaker,
      subtitle: entry.at,
      status: "Working memory",
      tone: "amber",
      summary: entry.text,
      thinking: [
        "Working memory captures the line of thought while it is still changing.",
        "These entries are intentionally raw. They are not stakeholder-safe copy.",
      ],
      logs: [
        { at: entry.at, label: "Captured", text: entry.text },
        { at: "NOW", label: "Use", text: "This thought is still shaping the next incident decision." },
      ],
      checks: ["Does this still hold?", "Should this become durable memory?", "Who needs to see this?"],
    };
  }

  if (selection.kind === "path") {
    const path = HOT_PATH.find((entry) => entry.id === selection.id) ?? HOT_PATH[0];
    return {
      title: path.label,
      subtitle: "Activity path",
      status: "Hot",
      tone: "rose",
      summary: path.summary,
      thinking: [
        "This path highlights which faculties are actually active, not merely present.",
        "A hot path should explain why the system is consuming attention right now.",
      ],
      logs: [
        { at: "T+08m", label: "Activated", text: path.summary },
        { at: "NOW", label: "Importance", text: "This remains on the live decision path." },
      ],
      checks: ["Which node is hottest?", "Does this path terminate in action?", "What evidence cools it down?"],
    };
  }

  const insight = buildNodeInsight(selection.id);
  const node = GRAPH_MODEL.nodeMap.get(selection.id);
  return {
    title: node?.label ?? "Node",
    subtitle: node?.kind ?? "graph node",
    status: insight.status,
    tone: node?.activity && node.activity > 0.82 ? "cyan" : "violet",
    summary: insight.summary,
    thinking: insight.thinking,
    logs: insight.logs,
    checks: ["What links into this?", "What does it feed next?", "Which agent is touching it now?"],
    note: insight.markdown,
  };
}

function toneClasses(tone: InspectorDetail["tone"]) {
  if (tone === "cyan") return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
  if (tone === "amber") return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  if (tone === "rose") return "border-rose-300/25 bg-rose-300/10 text-rose-100";
  if (tone === "emerald") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  if (tone === "violet") return "border-violet-300/25 bg-violet-300/10 text-violet-100";
  return "border-white/10 bg-white/[0.05] text-white/72";
}

export function BrainApp({ params, setParams }: OsAppProps) {
  const panel: Panel =
    params?.panel === "memory" || params?.panel === "cortex"
      ? (params.panel as Panel)
      : "config";

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-1 border-b border-role-border-subtle px-sm py-2">
        {PANELS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setParams({ panel: item.id })}
            className={cn(
              "rounded-xs px-2.5 py-1 text-body-sm",
              panel === item.id
                ? "bg-role-surface-component-selected text-role-content-heading"
                : "text-role-content-subtle hover:bg-role-surface-component-hover",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-md">
        {panel === "memory" && <Memory />}
        {panel === "cortex" && <Cortex />}
        {panel === "config" && <Config />}
      </div>
    </div>
  );
}

function Memory() {
  const [nodeStack, setNodeStack] = useState<string[]>([]);
  const selectedNodeId = nodeStack.at(-1) ?? null;

  function openNode(nodeId: string) {
    setNodeStack((current) => [...current, nodeId]);
  }

  function followNodeLink(nodeId: string) {
    setNodeStack((current) => (current.at(-1) === nodeId ? current : [...current, nodeId]));
  }

  function backFromNode() {
    setNodeStack((current) => current.slice(0, -1));
  }

  return (
    <div className="min-h-full bg-role-surface-page px-3 py-3">
      <div className="rounded-[28px] border border-role-border-subtle bg-role-surface-container-subtle p-3 shadow-[0_20px_80px_rgba(2,6,23,0.55)] backdrop-blur-xl">
        {selectedNodeId ? (
          <NodeDetailView
            nodeId={selectedNodeId}
            onBack={backFromNode}
            onSelectNode={followNodeLink}
            backLabel="Back to memory"
          />
        ) : (
          <KnowledgeGraphView onOpenNode={openNode} selection={null} minimal />
        )}
      </div>
    </div>
  );
}

function Cortex() {
  const [view, setView] = useState<BrainView>("timeline");
  const [selection, setSelection] = useState<InspectorSelection | null>(null);
  const activeDetail = selection;

  return (
    <div className="relative min-h-full overflow-hidden bg-role-surface-page text-role-content-body">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.06),_transparent_24%),linear-gradient(180deg,_rgba(10,10,10,0.82),_rgba(10,10,10,0.96))]" />
        <div className="brain-aurora brain-aurora-a absolute -left-28 top-14 h-72 w-72 rounded-full blur-3xl" />
        <div className="brain-aurora brain-aurora-b absolute right-[-5rem] top-24 h-80 w-80 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex min-h-full flex-col gap-4 px-4 py-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-role-content-muted">
              <span>AI SRE Brain</span>
              <span className="h-px w-8 bg-role-border-subtle" />
              <span>{INCIDENT.id}</span>
            </div>
            <h2 className="text-heading-lg font-semibold leading-tight text-role-content-heading">
              {INCIDENT.title}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-body-xs text-role-content-subtle">
              <span className="rounded-full border border-role-status-critical-border-hover bg-role-status-critical-subtle px-2 py-0.5 uppercase tracking-[0.18em] text-role-status-critical-foreground">
                {INCIDENT.severity}
              </span>
              <span className="rounded-full border border-role-info-border-hover bg-role-info-subtle px-2 py-0.5 uppercase tracking-[0.18em] text-role-info-foreground">
                {INCIDENT.status}
              </span>
              <span>{Math.round(INCIDENT.confidence * 100)}% confidence</span>
              <span>Started {formatCompactRelativeTime(INCIDENT.startedAt)}</span>
            </div>
          </div>

          <ViewModeToggle value={view} onChange={setView} />
        </div>

        <div className="rounded-[28px] border border-role-border-subtle bg-role-surface-container-subtle p-3 shadow-[0_20px_80px_rgba(2,6,23,0.55)] backdrop-blur-xl">
          {activeDetail ? (
            <MainDetailView
              detail={getInspectorDetail(activeDetail)}
              onBack={() => setSelection(null)}
            />
          ) : (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-role-border-subtle bg-role-surface-container-subtle p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-3xl">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-role-content-muted">
                      Incident summary
                    </div>
                    <p className="mt-2 text-body-sm leading-6 text-role-content-body">{INCIDENT.summary}</p>
                  </div>
                  <div className="max-w-sm rounded-2xl border border-role-border-subtle bg-role-surface-component-subtle p-3">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-role-content-muted">
                      Next decisive move
                    </div>
                    <p className="mt-2 text-body-sm text-role-content-heading">{INCIDENT.nextAction}</p>
                  </div>
                </div>
              </div>

              {view === "kanban" ? (
                <KanbanView selection={selection} onSelect={setSelection} />
              ) : (
                <TimelineView selection={selection} onSelect={setSelection} />
              )}

              <div className="grid gap-4 xl:grid-cols-2">
                <OverviewPanel icon={BrainCircuit} kicker="Hypotheses" title="Incident model">
                  <div className="space-y-3">
                    {HYPOTHESES.map((hypothesis) => (
                      <button
                        key={hypothesis.id}
                        type="button"
                        onClick={() => setSelection({ kind: "hypothesis", id: hypothesis.id })}
                        className="w-full rounded-2xl border border-white/8 bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.07]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-body-sm leading-5 text-white/84">{hypothesis.statement}</p>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]",
                              hypothesis.status === "leading"
                                ? "bg-emerald-300/12 text-emerald-200"
                                : hypothesis.status === "active"
                                  ? "bg-cyan-300/12 text-cyan-200"
                                  : "bg-white/8 text-white/58",
                            )}
                          >
                            {hypothesis.status}
                          </span>
                        </div>
                        <p className="mt-2 text-body-xs leading-5 text-white/55">{hypothesis.evidence}</p>
                      </button>
                    ))}
                  </div>
                </OverviewPanel>

                <OverviewPanel icon={Cpu} kicker="Agents" title="Running in parallel">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {AGENTS.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => setSelection({ kind: "agent", id: agent.id })}
                        className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.07]"
                      >
                        <span
                          className="mt-0.5 inline-flex h-8 min-w-8 items-center justify-center rounded-full text-[10px] font-semibold tracking-[0.18em] text-slate-950"
                          style={{ backgroundColor: agent.color }}
                        >
                          {agent.id.slice(0, 2)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-body-sm font-medium text-white">{agent.id}</span>
                            <StatusDot
                              tone={
                                agent.state === "running"
                                  ? "live"
                                  : agent.state === "watching"
                                    ? "medium"
                                    : agent.state === "done"
                                      ? "low"
                                      : "idle"
                              }
                            />
                          </div>
                          <p className="mt-1 text-body-xs uppercase tracking-[0.18em] text-white/45">
                            {agent.role}
                          </p>
                          <p className="mt-1 text-body-xs leading-5 text-white/58">{agent.focus}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </OverviewPanel>

                <OverviewPanel icon={Activity} kicker="Working memory" title="Live thought stream">
                  <div className="space-y-3">
                    {WORKING_MEMORY.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSelection({ kind: "memory", id: entry.id })}
                        className="w-full rounded-2xl border border-white/8 bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.07]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] uppercase tracking-[0.2em] text-cyan-200/85">
                            {entry.speaker}
                          </span>
                          <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                            {entry.at}
                          </span>
                        </div>
                        <p className="mt-2 text-body-sm leading-6 text-white/76">{entry.text}</p>
                      </button>
                    ))}
                  </div>
                </OverviewPanel>

                <OverviewPanel icon={Radar} kicker="Hot path" title="Current activity">
                  <div className="space-y-2">
                    {HOT_PATH.map((path) => (
                      <button
                        key={path.id}
                        type="button"
                        onClick={() => setSelection({ kind: "path", id: path.id })}
                        className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-left text-body-xs leading-5 text-white/72 transition-colors hover:bg-white/[0.07]"
                      >
                        {path.label}
                      </button>
                    ))}
                  </div>
                </OverviewPanel>
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .brain-aurora {
          opacity: 0.38;
          pointer-events: none;
        }

        .brain-aurora-a {
          background: radial-gradient(circle, rgba(103, 232, 249, 0.34), transparent 65%);
          animation: auroraFloatA 18s ease-in-out infinite;
        }

        .brain-aurora-b {
          background: radial-gradient(circle, rgba(244, 114, 182, 0.28), transparent 65%);
          animation: auroraFloatB 24s ease-in-out infinite;
        }

        .brain-depth-stage {
          perspective: 1200px;
        }

        .brain-depth-plane {
          transform-style: preserve-3d;
          transform: rotateX(16deg) rotateY(-11deg) rotateZ(-3deg);
        }

        .brain-flow {
          stroke-dasharray: 4 10;
          animation: flow 13s linear infinite;
        }

        .brain-flow-soft {
          stroke-dasharray: 3 12;
          animation: flow 16s linear infinite reverse;
        }

        @keyframes auroraFloatA {
          0%,
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(24px, -18px, 0) scale(1.08);
          }
        }

        @keyframes auroraFloatB {
          0%,
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(-18px, 22px, 0) scale(1.06);
          }
        }

        @keyframes flow {
          to {
            stroke-dashoffset: -56;
          }
        }
      `}</style>
    </div>
  );
}

function Config() {
  return (
    <>
      <SectionLabel>The contract</SectionLabel>
      <div className="flex flex-col px-2.5">
        {CONFIG_ROWS.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline gap-md border-b border-role-border-subtle px-2.5 py-2.5 last:border-b-0"
          >
            <span className="w-[120px] shrink-0 text-body-sm text-role-content-muted">
              {label}
            </span>
            <span className="text-body-md text-role-content-heading">{value}</span>
          </div>
        ))}
      </div>
      <p className="px-5 pt-md text-body-xs text-role-content-muted">
        The gate is materiality, not severity. An engineer does not report that nothing
        happened, but does report that the risk envelope changed.
      </p>
    </>
  );
}

function ViewModeToggle({
  value,
  onChange,
}: {
  value: BrainView;
  onChange: (next: BrainView) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Brain view"
      className="inline-grid grid-cols-2 gap-1 rounded-[20px] border border-role-border-subtle bg-role-surface-container-subtle p-1 backdrop-blur-md"
    >
      {BRAIN_VIEWS.map((option) => {
        const checked = value === option.id;
        return (
          <label
            key={option.id}
            className={cn(
              "relative flex cursor-pointer items-center gap-2 rounded-[16px] px-3 py-2 text-body-xs transition-colors",
              checked
                ? "border border-role-border-default bg-role-surface-component-selected text-role-content-heading"
                : "border border-transparent text-role-content-subtle hover:bg-role-surface-component-hover hover:text-role-content-heading",
            )}
          >
            <input
              type="radio"
              name="brain-view"
              value={option.id}
              checked={checked}
              onChange={() => onChange(option.id)}
              className="sr-only"
            />
            <Icon icon={option.icon} size={13} />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function OverviewPanel({
  icon,
  kicker,
  title,
  children,
}: {
  icon: typeof BrainCircuit;
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-role-border-subtle bg-role-surface-container-subtle p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-role-border-subtle bg-role-surface-component-subtle text-role-icon">
          <Icon icon={icon} size={16} />
        </span>
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-role-content-muted">{kicker}</div>
          <h3 className="mt-1 text-heading-sm font-semibold text-role-content-heading">{title}</h3>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MainDetailView({
  detail,
  onBack,
}: {
  detail: InspectorDetail;
  onBack: () => void;
}) {
  return (
    <div className="rounded-[24px] border border-role-border-subtle bg-role-surface-container-subtle p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-role-border-subtle pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-full border border-role-border-subtle bg-role-surface-component-subtle px-3 py-1.5 text-body-xs text-role-content-body transition-colors hover:bg-role-surface-component-hover hover:text-role-content-heading"
          >
            <Icon icon={ArrowLeft} size={13} />
            Back
          </button>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-role-content-muted">{detail.subtitle}</div>
            <h3 className="mt-1 text-heading-md font-semibold text-role-content-heading">{detail.title}</h3>
          </div>
        </div>

        <span
          className={cn(
            "rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]",
            toneClasses(detail.tone),
          )}
        >
          {detail.status}
        </span>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_320px]">
        <div className="rounded-[22px] border border-role-border-subtle bg-role-surface-container-subtle p-4">
          <div className="text-[10px] uppercase tracking-[0.2em] text-role-content-muted">Detail</div>
          <p className="mt-3 text-body-sm leading-6 text-role-content-body">{detail.summary}</p>

          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-[0.2em] text-role-content-muted">
              What the agent is thinking
            </div>
            <div className="mt-3 space-y-2">
              {detail.thinking.map((line) => (
                <div
                  key={line}
                  className="rounded-2xl border border-role-border-subtle bg-role-surface-component-subtle px-3 py-2.5 text-body-xs leading-5 text-role-content-body"
                >
                  {line}
                </div>
              ))}
            </div>
          </div>

          {detail.note && (
            <div className="mt-5">
              <div className="text-[10px] uppercase tracking-[0.2em] text-role-content-muted">Note</div>
              <div className="prose prose-invert mt-3 max-w-none text-body-sm leading-7 prose-headings:text-[var(--color-role-text-content-heading)] prose-p:text-[var(--color-role-text-content-body)] prose-strong:text-[var(--color-role-text-content-heading)] prose-li:text-[var(--color-role-text-content-body)] prose-code:text-[var(--color-role-info-foreground)]">
                <ReactMarkdown>{detail.note}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-[22px] border border-role-border-subtle bg-role-surface-container-subtle p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-role-content-muted">Status log</div>
            <div className="mt-3 space-y-2">
              {detail.logs.map((log) => (
                <div key={`${log.at}-${log.label}`} className="rounded-2xl border border-role-border-subtle bg-role-surface-component-subtle p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-role-content-heading">
                      {log.label}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-role-content-muted">
                      {log.at}
                    </span>
                  </div>
                  <p className="mt-2 text-body-xs leading-5 text-role-content-body">{log.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[22px] border border-role-border-subtle bg-role-surface-container-subtle p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-role-content-muted">Checks</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {detail.checks.map((check) => (
                <span
                  key={check}
                  className="rounded-full border border-role-border-subtle bg-role-surface-component-subtle px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-role-content-subtle"
                >
                  {check}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KnowledgeGraphView({
  onOpenNode,
  selection,
  minimal = false,
}: {
  onOpenNode: (nodeId: string) => void;
  selection: string | null;
  minimal?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x05050b, 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      42,
      mount.clientWidth / mount.clientHeight,
      0.1,
      200,
    );
    camera.position.set(0, 0, 19);

    const ambient = new THREE.AmbientLight(0xffffff, 0.76);
    const key = new THREE.PointLight(0xffffff, 1.35, 120);
    key.position.set(0, 0, 16);
    const rim = new THREE.PointLight(0x7a5af8, 0.55, 80);
    rim.position.set(-8, 6, 12);
    scene.add(ambient, key, rim);

    const root = new THREE.Group();
    scene.add(root);

    const starPositions = new Float32Array(STARFIELD.length * 3);
    STARFIELD.forEach((star, index) => {
      starPositions[index * 3] = (star.x - 50) * 0.26;
      starPositions[index * 3 + 1] = (50 - star.y) * 0.26;
      starPositions[index * 3 + 2] = -8 - (index % 7) * 1.2;
    });
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.08,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeometry, starMaterial);
    root.add(stars);

    const interactive: Array<{ mesh: THREE.Mesh; node: GraphNode }> = [];

    GRAPH_MODEL.edges.forEach((edge) => {
      const from = GRAPH_MODEL.nodeMap.get(edge.from);
      const to = GRAPH_MODEL.nodeMap.get(edge.to);
      if (!from || !to) return;
      const points = [worldPosition(from), worldPosition(to)];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(to.color),
        transparent: true,
        opacity: edge.kind === "association" ? 0.28 : 0.54,
      });
      const line = new THREE.Line(geometry, material);
      root.add(line);
    });

    GRAPH_MODEL.nodes.forEach((node) => {
      const position = worldPosition(node);
      const radius = nodeRadius(node);
      const geometry = new THREE.SphereGeometry(radius, 18, 18);
      const isCore = node.kind === "core";
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(isCore ? "#ffffff" : node.color),
        emissive: new THREE.Color(isCore ? "#7a5af8" : node.color),
        emissiveIntensity: isCore ? 0.5 : 0.22 + node.activity * 0.1,
        roughness: 0.34,
        metalness: 0.08,
        transparent: true,
        opacity: isCore ? 0.96 : 0.9,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.userData = { nodeId: node.id, baseScale: 1 };
      root.add(mesh);
      interactive.push({ mesh, node });

      if (isCore || node.kind === "faculty") {
        const haloGeometry = new THREE.SphereGeometry(radius * (isCore ? 2.2 : 1.7), 18, 18);
        const haloMaterial = new THREE.MeshBasicMaterial({
          color: new THREE.Color(isCore ? "#7a5af8" : node.color),
          transparent: true,
          opacity: isCore ? 0.08 : 0.05,
          depthWrite: false,
        });
        const halo = new THREE.Mesh(haloGeometry, haloMaterial);
        halo.position.copy(position);
        root.add(halo);
      }
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoveredId: string | null = null;
    let frameId = 0;
    let dragActive = false;
    let lastX = 0;
    let lastY = 0;
    let manualRotationX = 0.14;
    let manualRotationY = 0;
    let cameraDistance = 19;

    const setPointerFromEvent = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const onPointerMove = (event: PointerEvent) => {
      setPointerFromEvent(event);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(interactive.map((entry) => entry.mesh), false);
      const nextHover =
        hits.length > 0 ? String(hits[0].object.userData.nodeId ?? "") || null : null;
      hoveredId = nextHover;
      if (!dragActive) {
        renderer.domElement.style.cursor = hoveredId ? "pointer" : "grab";
      }
    };

    const onClick = () => {
      if (hoveredId) onOpenNode(hoveredId);
    };

    const onPointerDown = (event: PointerEvent) => {
      dragActive = true;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.style.cursor = "grabbing";
    };

    const onPointerUp = () => {
      dragActive = false;
      renderer.domElement.style.cursor = hoveredId ? "pointer" : "grab";
    };

    const onPointerDrag = (event: PointerEvent) => {
      if (!dragActive) return;
      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      manualRotationY += deltaX * 0.005;
      manualRotationX = THREE.MathUtils.clamp(manualRotationX + deltaY * 0.0025, -0.18, 0.42);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraDistance = THREE.MathUtils.clamp(cameraDistance + event.deltaY * 0.008, 12, 28);
      camera.position.z = cameraDistance;
    };

    const resizeObserver = new ResizeObserver(() => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(mount);

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointermove", onPointerDrag);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("click", onClick);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.style.cursor = "grab";

    const animate = (time: number) => {
      root.rotation.x = manualRotationX + Math.cos(time * 0.00012) * 0.012;
      root.rotation.y = manualRotationY + Math.sin(time * 0.00018) * 0.08;
      root.rotation.z = Math.sin(time * 0.00007) * 0.035;

      interactive.forEach(({ mesh, node }) => {
        const active = hoveredId === node.id || selection === node.id;
        const pulse = 1 + Math.sin(time * 0.0012 + node.activity * 5) * 0.06 * node.activity;
        const scale = active ? pulse * 1.2 : pulse;
        mesh.scale.setScalar(scale);
      });

      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointermove", onPointerDrag);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("wheel", onWheel);
      root.traverse((object: THREE.Object3D) => {
        const mesh = object as THREE.Mesh;
        if ("geometry" in mesh && mesh.geometry) {
          mesh.geometry.dispose();
        }
        const material = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose());
        } else {
          material?.dispose();
        }
      });
      starGeometry.dispose();
      starMaterial.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [minimal, onOpenNode, selection]);

  return (
    <div className="relative overflow-hidden rounded-[24px] border border-role-border-subtle bg-[#05050b]">
      <div ref={mountRef} className="relative aspect-[1.12/1] min-h-[560px]" />
      {!minimal && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2">
            <div className="rounded-full border border-role-border-subtle bg-role-surface-container-default px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-role-content-muted">
              Personality core
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-2">
            {FACULTIES.map((faculty) => (
              <span
                key={faculty.id}
                className="inline-flex items-center gap-2 rounded-full border border-role-border-subtle bg-role-surface-container-default px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-role-content-subtle"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: faculty.color, boxShadow: `0 0 10px ${faculty.color}` }}
                />
                {faculty.label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NodeDetailView({
  nodeId,
  onBack,
  onSelectNode,
  backLabel = "Back to brain",
}: {
  nodeId: string;
  onBack: () => void;
  onSelectNode: (nodeId: string) => void;
  backLabel?: string;
}) {
  const node = GRAPH_MODEL.nodeMap.get(nodeId);
  const insight = buildNodeInsight(nodeId);
  const inboundIds = GRAPH_MODEL.inbound.get(nodeId) ?? [];
  const outboundIds = GRAPH_MODEL.outbound.get(nodeId) ?? [];
  const inboundNodes = inboundIds
    .map((id) => GRAPH_MODEL.nodeMap.get(id))
    .filter((entry): entry is GraphNode => Boolean(entry));
  const outboundNodes = outboundIds
    .map((id) => GRAPH_MODEL.nodeMap.get(id))
    .filter((entry): entry is GraphNode => Boolean(entry));

  if (!node) return null;

  return (
    <div className="rounded-[24px] border border-role-border-subtle bg-role-surface-container-subtle p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-role-border-subtle pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-full border border-role-border-subtle bg-role-surface-component-subtle px-3 py-1.5 text-body-xs text-role-content-body transition-colors hover:bg-role-surface-component-hover hover:text-role-content-heading"
          >
            <Icon icon={ArrowLeft} size={13} />
            {backLabel}
          </button>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-role-content-muted">{node.kind}</div>
            <h3 className="mt-1 text-heading-md font-semibold text-role-content-heading">{node.label}</h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-role-content-heading"
            style={{
              borderColor: hexToRgba(node.color, 0.3),
              backgroundColor: hexToRgba(node.color, 0.12),
            }}
          >
            {insight.status}
          </span>
          <span className="rounded-full border border-role-border-subtle bg-role-surface-component-subtle px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-role-content-subtle">
            activity {Math.round(node.activity * 100)}%
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_300px]">
        <div className="rounded-[22px] border border-role-border-subtle bg-role-surface-container-subtle p-4">
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-role-content-muted">
            <span>Main note</span>
            <ChevronRight className="h-3 w-3" strokeWidth={1.6} />
            <span>{node.label}</span>
          </div>
          <div className="prose prose-invert mt-4 max-w-none text-body-sm leading-7 prose-headings:text-[var(--color-role-text-content-heading)] prose-p:text-[var(--color-role-text-content-body)] prose-strong:text-[var(--color-role-text-content-heading)] prose-li:text-[var(--color-role-text-content-body)] prose-code:text-[var(--color-role-info-foreground)]">
            <ReactMarkdown>{insight.markdown}</ReactMarkdown>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[22px] border border-role-border-subtle bg-role-surface-container-subtle p-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-role-content-muted">
              <Icon icon={Cpu} size={13} />
              Agents touching this node
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {insight.agents.map((agentId) => {
                const agent = getAgent(agentId);
                return (
                  <span
                    key={agentId}
                    className="rounded-full border border-role-border-subtle bg-role-surface-component-subtle px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-role-content-body"
                    style={agent ? { boxShadow: `0 0 18px ${hexToRgba(agent.color, 0.18)}` } : undefined}
                  >
                    {agentId}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="rounded-[22px] border border-role-border-subtle bg-role-surface-container-subtle p-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-role-content-muted">
              <Icon icon={Link2} size={13} />
              Inlinks
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {inboundNodes.length ? (
                inboundNodes.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onSelectNode(entry.id)}
                    className="rounded-full border border-role-border-subtle bg-role-surface-component-subtle px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-role-content-body transition-colors hover:bg-role-surface-component-hover hover:text-role-content-heading"
                  >
                    {entry.label}
                  </button>
                ))
              ) : (
                <span className="text-body-xs text-role-content-muted">No inbound links.</span>
              )}
            </div>
          </div>

          <div className="rounded-[22px] border border-role-border-subtle bg-role-surface-container-subtle p-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-role-content-muted">
              <Icon icon={GitBranch} size={13} />
              Outlinks
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {outboundNodes.length ? (
                outboundNodes.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onSelectNode(entry.id)}
                    className="rounded-full border border-role-border-subtle bg-role-surface-component-subtle px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-role-content-body transition-colors hover:bg-role-surface-component-hover hover:text-role-content-heading"
                  >
                    {entry.label}
                  </button>
                ))
              ) : (
                <span className="text-body-xs text-role-content-muted">No outbound links.</span>
              )}
            </div>
          </div>

          <div className="rounded-[22px] border border-role-border-subtle bg-role-surface-container-subtle p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-role-content-muted">Current logs</div>
            <div className="mt-3 space-y-2">
              {insight.logs.map((log) => (
                <div key={`${log.at}-${log.label}`} className="rounded-2xl border border-role-border-subtle bg-role-surface-component-subtle p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-role-content-heading">
                      {log.label}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-role-content-muted">
                      {log.at}
                    </span>
                  </div>
                  <p className="mt-2 text-body-xs leading-5 text-role-content-body">{log.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KanbanView({
  selection,
  onSelect,
}: {
  selection: InspectorSelection | null;
  onSelect: (selection: InspectorSelection) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-[24px] border border-white/8 bg-[#05050b] p-4">
      <div className="flex min-w-[1040px] gap-3">
        {KANBAN.map((stage) => (
          <div
            key={stage.id}
            className="min-h-[520px] min-w-[220px] flex-1 rounded-[24px] border border-white/8 bg-white/[0.03] p-3"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/42">Pipeline</div>
                <h3 className="mt-1 text-heading-sm font-semibold text-white">{stage.label}</h3>
              </div>
              <span
                className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-950"
                style={{ backgroundColor: stage.color }}
              >
                {stage.cards.length}
              </span>
            </div>

            <div className="mt-3 space-y-3">
              {stage.cards.map((card) => {
                const selected = selection?.kind === "card" && selection.id === card.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => onSelect({ kind: "card", id: card.id })}
                    className={cn(
                      "w-full rounded-[22px] border p-3 text-left shadow-[0_10px_30px_rgba(2,6,23,0.25)] transition-colors",
                      selected
                        ? "border-cyan-300/30 bg-cyan-300/10"
                        : "border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] hover:bg-white/[0.08]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/62">
                        {card.owner}
                      </span>
                      <CheckCircle2 className="h-3.5 w-3.5 text-white/35" strokeWidth={1.6} />
                    </div>
                    <h4 className="mt-3 text-body-sm font-medium leading-5 text-white">{card.title}</h4>
                    <p className="mt-2 text-body-xs leading-5 text-white/58">{card.detail}</p>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineView({
  selection,
  onSelect,
}: {
  selection: InspectorSelection | null;
  onSelect: (selection: InspectorSelection) => void;
}) {
  const ticks = Array.from({ length: TIMELINE_TOTAL / 2 + 1 }, (_, index) => index * 2);

  return (
    <div className="rounded-[24px] border border-white/8 bg-[#05050b] p-4">
      <div className="grid grid-cols-[160px_minmax(0,1fr)] items-end gap-3 border-b border-white/8 pb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/42">Timeline</div>
          <h3 className="mt-1 text-heading-sm font-semibold text-white">
            Parallel task bars from T0 to NOW
          </h3>
        </div>
        <div className="relative h-7">
          {ticks.map((tick) => (
            <div
              key={tick}
              className="absolute top-0 text-[10px] uppercase tracking-[0.18em] text-white/44"
              style={{ left: `${(tick / TIMELINE_TOTAL) * 100}%`, transform: "translateX(-50%)" }}
            >
              T+{tick}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {TIMELINE.map((row) => (
          <div
            key={row.agent}
            className="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-3 rounded-[22px] border border-white/8 bg-white/[0.03] p-3"
          >
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: row.color, boxShadow: `0 0 12px ${row.color}` }}
                />
                <span className="text-body-sm font-medium text-white">{row.agent}</span>
              </div>
              <div className="mt-1 text-body-xs uppercase tracking-[0.18em] text-white/44">
                {row.role}
              </div>
            </div>

            <div className="relative h-16 overflow-hidden rounded-2xl border border-white/6 bg-black/20">
              <div className="absolute inset-y-0 left-[72.7%] w-px bg-rose-300/80 shadow-[0_0_18px_rgba(251,113,133,0.7)]" />
              <div className="absolute right-3 top-2 text-[10px] uppercase tracking-[0.18em] text-rose-200/85">
                NOW
              </div>

              {ticks.map((tick) => (
                <div
                  key={tick}
                  className="absolute inset-y-0 w-px bg-white/5"
                  style={{ left: `${(tick / TIMELINE_TOTAL) * 100}%` }}
                />
              ))}

              {row.tasks.map((task) => {
                const left = (task.start / TIMELINE_TOTAL) * 100;
                const width = ((task.end - task.start) / TIMELINE_TOTAL) * 100;
                const selected = selection?.kind === "task" && selection.id === task.id;
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onSelect({ kind: "task", id: task.id })}
                    className={cn(
                      "absolute top-6 flex h-7 items-center rounded-full border px-3 text-body-xs transition-colors",
                      selected
                        ? "border-cyan-300/40 text-white shadow-[0_0_24px_rgba(103,232,249,0.18)]"
                        : task.state === "live"
                          ? "border-white/10 text-white"
                          : task.state === "done"
                            ? "border-white/8 text-white/72"
                            : "border-white/8 text-white/52",
                    )}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background:
                        task.state === "live"
                          ? `linear-gradient(90deg, ${hexToRgba(row.color, selected ? 0.56 : 0.42)}, rgba(255,255,255,0.08))`
                          : task.state === "done"
                            ? `linear-gradient(90deg, ${hexToRgba(row.color, selected ? 0.32 : 0.2)}, rgba(255,255,255,0.05))`
                            : "rgba(255,255,255,0.04)",
                    }}
                  >
                    <span className="truncate">{task.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
