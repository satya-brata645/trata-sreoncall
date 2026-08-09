import { cn } from "@/lib/utils";

/**
 * The A mark.
 *
 * Line-art built from circles and rounded strokes, animating through a
 * collapse-and-rebuild loop. Shipped as an alpha WebP — white strokes on
 * transparency — so it composites over glass, the dock and the boot ground
 * without carrying a tile of its own. The source GIF (`/a-logo.gif`) is kept
 * beside it as provenance.
 *
 * `animated={false}` swaps in the still first frame: use it anywhere the mark
 * is smaller than ~24px or repeats in a list, where a moving glyph is noise.
 */
export function ALogo({
  size = 26,
  animated = true,
  className,
}: {
  size?: number;
  animated?: boolean;
  className?: string;
}) {
  const src = animated
    ? size > 64
      ? "/a-logo.webp"
      : "/a-mark.webp"
    : "/a-mark.png";

  return (
    // eslint-disable-next-line @next/next/no-img-element -- animated WebP; next/image would freeze it
    <img
      src={src}
      alt="DOS"
      width={size}
      height={size}
      draggable={false}
      className={cn("select-none", className)}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The mark plus the wordmark — the lockup in the menu bar.
 *
 * Still, deliberately. The menu bar is permanent chrome, and the design system
 * allows exactly one looping thing on screen: the status pulse that means the
 * agent is working. A logo animating beside it would compete with the only
 * signal up there that carries information. The mark plays at the boot splash
 * and nowhere else.
 */
export function ALockup({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <ALogo size={size} animated={false} />
      <span className="text-heading-sm font-semibold tracking-[0.16em] text-role-content-heading">
        DOS
      </span>
    </div>
  );
}
