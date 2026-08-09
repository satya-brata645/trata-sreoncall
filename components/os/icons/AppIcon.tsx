"use client";

import { appGlyph } from "@/lib/os/appGlyphs";
import { cn } from "@/lib/utils";

/**
 * An app's icon, by id.
 *
 * Every surface that shows an app — the dock, the Launchpad, the store, a
 * window's own chrome — renders this and nothing else, so an app is one object
 * with one face wherever it turns up. The alternative, which this replaced, was
 * four call sites each building their own tinted square around a stroke glyph:
 * the same app looked subtly different in each, and any new one had to
 * rediscover the recipe.
 *
 * Resolving the artwork here also keeps the lookup out of the callers' `map`
 * bodies — `appGlyph` returns a component *reference*, and calling it inside a
 * loop reads to lint as building a component during render.
 */
export function AppIcon({
  appId,
  name,
  description,
  tags,
  size = 32,
  className,
}: {
  appId: string;
  /** Consulted only for apps with no entry in the glyph table. */
  name?: string;
  description?: string | null;
  tags?: readonly string[];
  size?: number;
  className?: string;
}) {
  const { artwork: Artwork } = appGlyph(appId, { name, description, tags });
  return (
    <Artwork
      size={size}
      // The same contact shadow the dock uses, so a tile in a list still sits
      // *on* the row rather than being stamped into it.
      className={cn("shrink-0 drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)]", className)}
    />
  );
}
