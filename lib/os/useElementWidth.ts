"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Track an element's own width.
 *
 * OS apps live inside resizable windows, so "small screen" is meaningless to
 * them — what matters is how much room *this window* has. Viewport breakpoints
 * would leave a 300px-wide window rendering a desktop layout on a large
 * monitor. Measuring the element instead makes an app's responsiveness a
 * property of the window, which is what the user actually resizes.
 *
 * Returns `null` until the first measurement, so callers can avoid rendering a
 * layout chosen from a wrong assumed width on the first paint.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Seed synchronously so the first painted layout is already correct.
    setWidth(el.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // `borderBoxSize` is cheaper than re-reading layout, and avoids the
        // forced reflow a getBoundingClientRect() per frame would cause while
        // a window is being dragged.
        const next = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        setWidth(next);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
