import type { ComponentType } from "react";
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

import {
  type AppArtworkProps,
  AuditIsEasyArtwork,
  CloudArtwork,
  DpfloArtwork,
  GenericAppArtwork,
  IdentityLedgerArtwork,
  KodeShieldArtwork,
  NetMapArtwork,
  PagerArtwork,
  ReportArtwork,
  SreOnCallArtwork,
  VendorWatchArtwork,
} from "@/components/os/icons/AppArtwork";

/**
 * How each app is drawn — one table, three answers.
 *
 * `artwork` is the app's icon: a full-bleed coloured tile, drawn per app, and
 * the thing every launcher surface shows. It is what makes an app recognisable
 * before it is read, which is the entire job of an icon and something a stroke
 * glyph in a grey square has never done well.
 *
 * `icon` and `tint` are the same app reduced to one monochrome symbol and one
 * hue, for the places that are *not* a launcher — a menu row, a dense list, a
 * line of text — where a painted tile would shout.
 *
 * Components are returned as *references* rather than elements, because
 * resolving one inside a parent's `map` reads to lint as building a component
 * during render.
 */
export interface AppGlyph {
  /** The app icon. Use this anywhere the app is being *presented*. */
  artwork: ComponentType<AppArtworkProps>;
  /** The app reduced to a stroke symbol, for dense or textual contexts. */
  icon: LucideIcon;
  /** The app's hue, for the stroke symbol. Never for a filled surface. */
  tint: string;
}

const EXPLICIT: Record<string, AppGlyph> = {
  dpflo: { artwork: DpfloArtwork, icon: Fingerprint, tint: "#7A5AF8" },
  sreoncall: { artwork: SreOnCallArtwork, icon: Radio, tint: "#FF7A33" },
  kodeshield: { artwork: KodeShieldArtwork, icon: ShieldCheck, tint: "#4DA3E5" },
  auditiseasy: { artwork: AuditIsEasyArtwork, icon: ClipboardCheck, tint: "#4DC58A" },
  netmap: { artwork: NetMapArtwork, icon: Network, tint: "#E2A03F" },
  identityledger: { artwork: IdentityLedgerArtwork, icon: KeyRound, tint: "#C77DFF" },
  vendorwatch: { artwork: VendorWatchArtwork, icon: Handshake, tint: "#E5A0C4" },
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
  {
    match: ["privacy", "dpia", "gdpr", "pii"],
    glyph: { artwork: DpfloArtwork, icon: Fingerprint, tint: "#7A5AF8" },
  },
  {
    match: ["incident", "reliability", "oncall", "pager", "slo"],
    glyph: { artwork: PagerArtwork, icon: Radio, tint: "#E5484D" },
  },
  {
    match: ["vuln", "cve", "appsec", "supply", "shield", "patch"],
    glyph: { artwork: KodeShieldArtwork, icon: ShieldCheck, tint: "#4DA3E5" },
  },
  {
    match: ["compliance", "soc2", "iso", "audit", "evidence", "control"],
    glyph: { artwork: AuditIsEasyArtwork, icon: ClipboardCheck, tint: "#4DC58A" },
  },
  {
    match: ["network", "segment", "topology", "firewall"],
    glyph: { artwork: NetMapArtwork, icon: Network, tint: "#E2A03F" },
  },
  {
    match: ["identity", "iam", "access", "credential", "okta"],
    glyph: { artwork: IdentityLedgerArtwork, icon: KeyRound, tint: "#C77DFF" },
  },
  {
    match: ["vendor", "third-party", "trust", "supplier"],
    glyph: { artwork: VendorWatchArtwork, icon: Handshake, tint: "#E5A0C4" },
  },
  {
    match: ["cloud", "aws", "azure", "gcp", "cspm"],
    glyph: { artwork: CloudArtwork, icon: Cloud, tint: "#4DA3E5" },
  },
  {
    match: ["report", "digest", "log"],
    glyph: { artwork: ReportArtwork, icon: ScrollText, tint: "rgba(255,255,255,0.75)" },
  },
];

const DEFAULT_GLYPH: AppGlyph = {
  artwork: GenericAppArtwork,
  icon: Boxes,
  tint: "rgba(255,255,255,0.75)",
};

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
