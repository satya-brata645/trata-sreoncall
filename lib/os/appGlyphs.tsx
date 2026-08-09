import {
  Boxes,
  ClipboardCheck,
  Cloud,
  Fingerprint,
  Handshake,
  KeyRound,
  Network,
  Radio,
  ScrollText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

/**
 * The glyph and tint each app is drawn with.
 *
 * A tint per app, on the glyph's stroke and nowhere else. The system reserves
 * colour for meaning and "which app am I looking at" is meaning — but the tile
 * behind it stays on the white-alpha ladder, so a grid of apps still reads as
 * one surface rather than a row of coloured buttons.
 *
 * Returns a component *reference* rather than an element, because resolving one
 * inside a parent's `map` reads to lint as building a component during render.
 */
export interface AppGlyph {
  icon: LucideIcon;
  tint: string;
}

const EXPLICIT: Record<string, AppGlyph> = {
  dpflo: { icon: Fingerprint, tint: "#7A5AF8" },
  sreoncall: { icon: Radio, tint: "#E5484D" },
  kodeshield: { icon: ShieldCheck, tint: "#4DA3E5" },
  auditiseasy: { icon: ClipboardCheck, tint: "#4DC58A" },
  netmap: { icon: Network, tint: "#E2A03F" },
  identityledger: { icon: KeyRound, tint: "#C77DFF" },
  vendorwatch: { icon: Handshake, tint: "#E5A0C4" },
};

/**
 * Keyword fallbacks, so an app added to the library after this file was written
 * still gets a symbol that says what it does.
 *
 * Ordered: the first match wins, so the more specific terms come first. Without
 * this an unknown app is a grey box, and a workspace that installs something new
 * would show it as less real than the ones we happened to hardcode.
 */
const FALLBACKS: Array<{ match: readonly string[]; glyph: AppGlyph }> = [
  { match: ["privacy", "dpia", "gdpr", "pii"], glyph: { icon: Fingerprint, tint: "#7A5AF8" } },
  { match: ["incident", "reliability", "oncall", "pager", "slo"], glyph: { icon: Radio, tint: "#E5484D" } },
  { match: ["vuln", "cve", "appsec", "supply", "shield", "patch"], glyph: { icon: ShieldCheck, tint: "#4DA3E5" } },
  { match: ["compliance", "soc2", "iso", "audit", "evidence", "control"], glyph: { icon: ClipboardCheck, tint: "#4DC58A" } },
  { match: ["network", "segment", "topology", "firewall"], glyph: { icon: Network, tint: "#E2A03F" } },
  { match: ["identity", "iam", "access", "credential", "okta"], glyph: { icon: KeyRound, tint: "#C77DFF" } },
  { match: ["vendor", "third-party", "trust", "supplier"], glyph: { icon: Handshake, tint: "#E5A0C4" } },
  { match: ["cloud", "aws", "azure", "gcp", "cspm"], glyph: { icon: Cloud, tint: "#4DA3E5" } },
  { match: ["report", "digest", "log"], glyph: { icon: ScrollText, tint: "rgba(255,255,255,0.75)" } },
];

const DEFAULT_GLYPH: AppGlyph = { icon: Boxes, tint: "rgba(255,255,255,0.75)" };

/**
 * The glyph for an app.
 *
 * `name`, `description` and `tags` are optional and only consulted for apps not
 * in the explicit table — an id alone is often not enough to guess from, and the
 * catalog carries the rest anyway.
 */
export function appGlyph(
  appId: string,
  meta?: { name?: string; description?: string | null; tags?: readonly string[] },
): AppGlyph {
  const explicit = EXPLICIT[appId];
  if (explicit) return explicit;

  const haystack = [appId, meta?.name ?? "", meta?.description ?? "", ...(meta?.tags ?? [])]
    .join(" ")
    .toLowerCase();

  for (const { match, glyph } of FALLBACKS) {
    if (match.some((term) => haystack.includes(term))) return glyph;
  }
  return DEFAULT_GLYPH;
}
