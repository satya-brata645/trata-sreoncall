import {
  Boxes,
  ClipboardCheck,
  Fingerprint,
  Network,
  Radio,
  ShieldCheck,
  Handshake,
  type LucideIcon,
} from "lucide-react";

/**
 * The glyph and tint each security app is drawn with.
 *
 * A tint per app, and only ever on the glyph's stroke — the design system
 * reserves colour for meaning, and "which app am I looking at" is meaning. The
 * fill stays the white-alpha ladder so a grid of apps still reads as one
 * surface rather than as a row of buttons.
 */
export interface AppGlyph {
  icon: LucideIcon;
  tint: string;
}

const GLYPHS: Record<string, AppGlyph> = {
  dpflo: { icon: Fingerprint, tint: "#7A5AF8" },
  sreoncall: { icon: Radio, tint: "#E5484D" },
  kodeshield: { icon: ShieldCheck, tint: "#4DA3E5" },
  auditiseasy: { icon: ClipboardCheck, tint: "#4DC58A" },
  netmap: { icon: Network, tint: "#E2A03F" },
  identityledger: { icon: Fingerprint, tint: "#C77DFF" },
  vendorwatch: { icon: Handshake, tint: "#E5A0C4" },
};

const FALLBACK: AppGlyph = { icon: Boxes, tint: "rgba(255,255,255,0.75)" };

export function appGlyph(appId: string): AppGlyph {
  return GLYPHS[appId] ?? FALLBACK;
}
