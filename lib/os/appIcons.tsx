import {
  Activity,
  BadgeCheck,
  Bell,
  Boxes,
  Brain,
  Bug,
  ClipboardCheck,
  Cloud,
  Crosshair,
  FileSearch,
  FileText,
  Flame,
  GitBranch,
  Globe,
  KeyRound,
  LayoutDashboard,
  Network,
  Radar,
  Radio,
  ScrollText,
  Server,
  Share2,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Target,
  Terminal,
  UserCheck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * Tile tone. Deliberately drawn from the semantic status ramp rather than raw
 * hues, so every symbol is theme-aware and reads as part of the product palette
 * instead of a second, competing colour system.
 */
export type AppIconTone =
  | "brand"
  | "info"
  | "critical"
  | "high"
  | "medium"
  | "low";

/**
 * Explicit symbols for the apps that exist today, keyed by project id.
 *
 * Chosen so the icon says what the app *does* — posture checks get a shield,
 * anything that hunts gets a crosshair or radar, anything that produces a
 * document gets a page. Tone groups by kind: red for threat/incident, orange
 * for vulnerability and remediation, green for compliance and attestation,
 * blue for inventory and discovery, purple for the reasoning/graph tools.
 */
const EXPLICIT_SYMBOLS: Record<string, AppSymbol> = {
  advisories_app: { icon: Bell, tone: "critical" },
  "asset-inventory": { icon: Boxes, tone: "info" },
  "aws-cspm-basic": { icon: Cloud, tone: "info" },
  "aws-vulnerability-prioritizer": { icon: Flame, tone: "high" },
  board: { icon: LayoutDashboard, tone: "brand" },
  "brand-monitoring-app": { icon: Globe, tone: "info" },
  "client-onboarding": { icon: UserCheck, tone: "low" },
  "custom-task": { icon: Terminal, tone: "brand" },
  "demo-app": { icon: SlidersHorizontal, tone: "brand" },
  "devops-security-remediation": { icon: Wrench, tone: "high" },
  "evidence-reviewer": { icon: FileSearch, tone: "low" },
  "firewall-review": { icon: ShieldCheck, tone: "info" },
  "gcp-cspm-basic": { icon: Cloud, tone: "info" },
  generate_all_inventory: { icon: Server, tone: "info" },
  ioc_extractor: { icon: Crosshair, tone: "critical" },
  "network-diagram-curator": { icon: Network, tone: "info" },
  "pci-compliance-analysis": { icon: BadgeCheck, tone: "low" },
  pentest: { icon: Bug, tone: "critical" },
  "policy-engine": { icon: ScrollText, tone: "medium" },
  "quick-summary-demo": { icon: FileText, tone: "brand" },
  radar_generation: { icon: Radar, tone: "high" },
  "scoping-and-network-diagram": { icon: Share2, tone: "info" },
  "soc2-readiness": { icon: ClipboardCheck, tone: "low" },
  threat_relationships_graph: { icon: Brain, tone: "brand" },
  "threat-intel-advisories": { icon: Siren, tone: "critical" },
  "threat-radar-generation": { icon: Radar, tone: "high" },
  trace: { icon: Activity, tone: "brand" },
  "user-access-review": { icon: Users, tone: "medium" },
};

/**
 * Keyword fallback, in priority order. Applied to an app's id, name, description
 * and tags when it has no explicit symbol — so an app added to the backend
 * tomorrow still gets a meaningful icon rather than a generic placeholder, and
 * nobody has to remember to edit this file.
 */
const KEYWORD_FALLBACKS: ReadonlyArray<{
  match: readonly string[];
  symbol: AppSymbol;
}> = [
  { match: ["threat", "intel", "ioc", "adversary"], symbol: { icon: Siren, tone: "critical" } },
  { match: ["vuln", "cve", "exploit", "patch"], symbol: { icon: Flame, tone: "high" } },
  { match: ["pentest", "attack", "red team"], symbol: { icon: Bug, tone: "critical" } },
  { match: ["incident", "alert", "detect"], symbol: { icon: Bell, tone: "critical" } },
  { match: ["remediat", "fix", "devops"], symbol: { icon: Wrench, tone: "high" } },
  { match: ["compliance", "soc2", "pci", "hipaa", "iso", "audit"], symbol: { icon: ClipboardCheck, tone: "low" } },
  { match: ["evidence", "attest", "review"], symbol: { icon: FileSearch, tone: "low" } },
  { match: ["policy", "control", "governance"], symbol: { icon: ScrollText, tone: "medium" } },
  { match: ["access", "identity", "iam", "user", "permission"], symbol: { icon: KeyRound, tone: "medium" } },
  { match: ["network", "firewall", "vpc", "subnet"], symbol: { icon: Network, tone: "info" } },
  { match: ["inventory", "asset", "resource"], symbol: { icon: Boxes, tone: "info" } },
  { match: ["cloud", "aws", "gcp", "azure", "cspm"], symbol: { icon: Cloud, tone: "info" } },
  { match: ["graph", "relationship", "correlat"], symbol: { icon: Share2, tone: "brand" } },
  { match: ["radar", "trend", "landscape"], symbol: { icon: Radar, tone: "high" } },
  { match: ["report", "summary", "digest", "brief"], symbol: { icon: FileText, tone: "brand" } },
  { match: ["monitor", "watch", "track"], symbol: { icon: Radio, tone: "info" } },
  { match: ["dashboard", "board", "overview"], symbol: { icon: LayoutDashboard, tone: "brand" } },
  { match: ["scope", "diagram", "map"], symbol: { icon: GitBranch, tone: "info" } },
  { match: ["onboard", "client", "customer"], symbol: { icon: UserCheck, tone: "low" } },
  { match: ["target", "priorit"], symbol: { icon: Target, tone: "high" } },
];

/** Last resort, so a symbol is always returned. */
const DEFAULT_SYMBOL: AppSymbol = { icon: Terminal, tone: "brand" };

/** What `getAppSymbol` returns. Wrapped in an object rather than returned bare
 *  so consumers destructure a component reference instead of deriving one
 *  directly from a call — which lint (correctly) reads as building a component
 *  during render. */
export interface AppSymbol {
  icon: LucideIcon;
  tone: AppIconTone;
}

/**
 * Resolve the symbol for an app: explicit mapping first, then keyword match
 * over its own metadata, then a neutral default.
 */
export function getAppSymbol(app: {
  id: string;
  name?: string;
  description?: string | null;
  tags?: string[];
}): AppSymbol {
  const explicit = EXPLICIT_SYMBOLS[app.id];
  if (explicit) return explicit;

  const haystack = [app.id, app.name ?? "", app.description ?? "", ...(app.tags ?? [])]
    .join(" ")
    .toLowerCase();

  for (const { match, symbol } of KEYWORD_FALLBACKS) {
    if (match.some((term) => haystack.includes(term))) return symbol;
  }
  return DEFAULT_SYMBOL;
}

/**
 * Tile surface + icon classes per tone. Tailwind needs literal class strings to
 * generate utilities, so these are spelled out rather than built by template.
 */
export const APP_TONE_CLASSES: Record<AppIconTone, string> = {
  brand:
    "bg-role-surface-action-hover-subtle text-role-foreground-accent border-role-border-brand",
  info: "bg-role-info-subtle text-role-info-foreground border-role-info-border-hover",
  critical:
    "bg-role-status-critical-subtle text-role-status-critical-foreground border-role-status-critical-border-hover",
  high: "bg-role-status-high-subtle text-role-status-high-foreground border-role-status-high-border-hover",
  medium:
    "bg-role-status-medium-subtle text-role-status-medium-foreground border-role-status-medium-border-hover",
  low: "bg-role-status-low-subtle text-role-status-low-foreground border-role-status-low-border-hover",
};
