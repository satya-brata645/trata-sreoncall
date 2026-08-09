/**
 * Button — 1:1 with Figma design system (Buttons / button/Large·Medium·Small).
 *
 * Canonical API (matches Figma):
 *   variant: "filled" | "outline" | "transparent"
 *   size:    "lg" | "md" | "sm"
 *
 * States (default / hover / focus / disabled) are baked into Tailwind
 * pseudo-classes so consumers don't pass a state prop.
 *
 * Legacy aliases (kept so pre-DS call sites continue to compile — prefer
 * the canonical names for new code):
 *   variant: "default" → "filled"
 *           "secondary"|"ghost"|"link" → "transparent"
 *           "outline" → "outline"
 *   size:    "default" → "md"
 *           "icon" → "md"  (for icon-only buttons, prefer <IconButton>)
 *
 * For destructive/dangerous actions (delete, remove, discard), use
 * <DestructiveButton> from "@/components/ui/destructive-button" — it uses
 * the semantic critical/red tokens so users get a visual warning.
 *
 * For icon-only circular buttons, use <IconButton> from
 * "@/components/ui/icon-button" (sizes 32 / 48 / 64).
 */

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center whitespace-nowrap",
    "font-medium",
    "transition-colors",
    "ring-offset-[var(--color-role-surface-page-default)]",
    "focus-visible:outline-none",
    "disabled:pointer-events-none",
  ].join(" "),
  {
    variants: {
      variant: {
        filled: [
          "bg-[var(--color-role-surface-action-default)]",
          "text-[var(--color-role-foreground-on-color)]",
          "hover:bg-[var(--color-role-surface-action-hover)]",
          "focus-visible:bg-[var(--color-role-surface-action-hover)]",
          "focus-visible:ring-2 focus-visible:ring-[var(--color-role-border-focus)] focus-visible:ring-offset-4",
          "disabled:bg-[var(--color-role-surface-action-disabled)]",
          "disabled:text-[var(--color-role-foreground-disabled)]",
        ].join(" "),
        outline: [
          "border border-[var(--color-role-border-brand)] bg-transparent",
          "text-[var(--color-role-foreground-accent)]",
          "hover:bg-[var(--color-role-surface-action-hover-subtle)]",
          "focus-visible:bg-[var(--color-role-surface-action-hover-subtle)]",
          "focus-visible:ring-2 focus-visible:ring-[var(--color-role-border-focus)] focus-visible:ring-offset-4",
          "disabled:bg-[var(--color-role-surface-action-disabled)]",
          "disabled:border-[var(--color-role-border-disabled)]",
          "disabled:text-[var(--color-role-foreground-disabled)]",
        ].join(" "),
        transparent: [
          "border border-transparent bg-transparent",
          "text-[var(--color-role-foreground-accent)]",
          "hover:bg-[var(--color-role-surface-action-hover-subtle)]",
          "focus-visible:bg-[var(--color-role-surface-container-hover)]",
          "focus-visible:border-[var(--color-role-border-hover)]",
          "disabled:text-[var(--color-role-foreground-disabled)]",
        ].join(" "),
      },
      size: {
        // Large: p-md (16), gap-xs (8), rounded-sm (12), body/lg (20/32), icon 20
        lg: "gap-xs p-md rounded-sm text-body-lg [&_svg]:size-5 [&_svg]:shrink-0",
        // Medium: p-sm (12), gap-xs (8), rounded-sm (12), body/md (16/24), icon 16
        md: "gap-xs p-sm rounded-sm text-body-md [&_svg]:size-4 [&_svg]:shrink-0",
        // Small: p-xs (8), gap-2xs (4), rounded-xs (8), body/sm (14/20), icon 12
        sm: "gap-2xs p-xs rounded-xs text-body-sm [&_svg]:size-3 [&_svg]:shrink-0",
      },
    },
    defaultVariants: {
      variant: "filled",
      size: "sm",
    },
  }
);

type CanonicalVariant = "filled" | "outline" | "transparent";
type CanonicalSize = "lg" | "md" | "sm";

type LegacyVariant = "default" | "secondary" | "ghost" | "link";
type LegacySize = "default" | "icon";

type ButtonVariant = CanonicalVariant | LegacyVariant;
type ButtonSize = CanonicalSize | LegacySize;

const VARIANT_ALIAS: Record<LegacyVariant, CanonicalVariant> = {
  default: "filled",
  secondary: "transparent",
  ghost: "transparent",
  link: "transparent",
};

const SIZE_ALIAS: Record<LegacySize, CanonicalSize> = {
  default: "sm",
  icon: "sm",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const resolvedVariant: CanonicalVariant = variant
      ? (variant in VARIANT_ALIAS
          ? VARIANT_ALIAS[variant as LegacyVariant]
          : (variant as CanonicalVariant))
      : "filled";
    const resolvedSize: CanonicalSize = size
      ? (size in SIZE_ALIAS
          ? SIZE_ALIAS[size as LegacySize]
          : (size as CanonicalSize))
      : "sm";
    return (
      <Comp
        className={cn(
          buttonVariants({
            variant: resolvedVariant,
            size: resolvedSize,
            className,
          })
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
