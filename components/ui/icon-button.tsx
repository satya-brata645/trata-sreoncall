/**
 * IconButton — 1:1 with Figma design system (Buttons / icon button/Large·Medium·Small).
 *
 * Circular pill, icon-only.
 *
 * API matches Figma:
 *   variant: "filled" | "outline" | "transparent"
 *   size:    "lg" | "md" | "sm"
 *
 * Sizes (square):
 *   lg → 56×56, icon 24
 *   md → 44×44, icon 20
 *   sm → 32×32, icon 16
 *
 * Children should be a single icon (Lucide or otherwise). The component
 * sets icon size via `[&_svg]:size-*` so consumers don't need to size
 * the icon manually.
 */

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const iconButtonVariants = cva(
  [
    "inline-flex items-center justify-center rounded-full",
    "transition-colors",
    "ring-offset-[var(--color-role-surface-page-default)]",
    "focus-visible:outline-none focus-visible:ring-[var(--color-role-border-focus)] focus-visible:ring-offset-4",
    "disabled:pointer-events-none",
  ].join(" "),
  {
    variants: {
      variant: {
        filled: [
          "bg-[var(--color-role-surface-action-default)]",
          "text-[var(--color-role-foreground-on-color)]",
          "hover:bg-[var(--color-role-surface-action-hover)]",
          "disabled:bg-[var(--color-role-surface-action-disabled)]",
          "disabled:text-[var(--color-role-foreground-disabled)]",
        ].join(" "),
        outline: [
          "border border-[var(--color-role-border-brand)] bg-transparent",
          "text-[var(--color-role-foreground-accent)]",
          "hover:bg-[var(--color-role-surface-action-hover-subtle)]",
          "disabled:border-[var(--color-role-border-disabled)]",
          "disabled:text-[var(--color-role-foreground-disabled)]",
          "disabled:bg-transparent",
        ].join(" "),
        transparent: [
          "bg-transparent",
          "text-[var(--color-role-foreground-accent)]",
          "hover:bg-[var(--color-role-surface-action-hover-subtle)]",
          "disabled:text-[var(--color-role-foreground-disabled)]",
        ].join(" "),
      },
      size: {
        lg: "p-4 [&_svg]:size-6 focus-visible:ring-2",
        md: "p-3 [&_svg]:size-5 focus-visible:ring-1",
        sm: "p-2 [&_svg]:size-4 focus-visible:ring-1",
      },
    },
    defaultVariants: {
      variant: "filled",
      size: "md",
    },
  }
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  asChild?: boolean;
  /** Required for accessibility — icon-only buttons need a label. */
  "aria-label": string;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(iconButtonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
IconButton.displayName = "IconButton";

export { IconButton, iconButtonVariants };
