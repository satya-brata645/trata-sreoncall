/**
 * DestructiveButton — used for irreversible / dangerous actions (delete,
 * remove, discard). Same API shape as <Button> but rendered with the
 * semantic critical/red tokens so users are visually warned.
 *
 * Reach for this in place of <Button> when the action:
 *   - permanently removes data
 *   - cannot be undone
 *   - has consequences a user might regret
 *
 * API:
 *   variant: "filled" | "outline" | "transparent"
 *   size:    "lg" | "md" | "sm"
 *
 * States (default / hover / focus / disabled) are baked in.
 */

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const destructiveButtonVariants = cva(
  [
    "inline-flex items-center justify-center whitespace-nowrap",
    "font-medium",
    "transition-colors",
    "ring-offset-[var(--color-role-surface-page-default)]",
    "focus-visible:outline-none focus-visible:ring-[var(--color-role-status-critical-border-focus)] focus-visible:ring-offset-4",
    "disabled:pointer-events-none",
  ].join(" "),
  {
    variants: {
      variant: {
        filled: [
          "bg-[var(--color-role-status-critical-default)]",
          "text-[var(--color-role-foreground-on-color)]",
          "hover:bg-[var(--color-role-status-critical-hover)]",
          "disabled:bg-[var(--color-role-surface-action-disabled)]",
          "disabled:text-[var(--color-role-foreground-disabled)]",
        ].join(" "),
        outline: [
          "border border-[var(--color-role-status-critical-default)] bg-transparent",
          "text-[var(--color-role-status-critical-foreground)]",
          "hover:bg-[var(--color-role-status-critical-subtle)]",
          "disabled:border-[var(--color-role-border-disabled)]",
          "disabled:text-[var(--color-role-foreground-disabled)]",
          "disabled:bg-transparent",
        ].join(" "),
        transparent: [
          "bg-transparent",
          "text-[var(--color-role-status-critical-foreground)]",
          "hover:bg-[var(--color-role-status-critical-subtle)]",
          "disabled:text-[var(--color-role-foreground-disabled)]",
        ].join(" "),
      },
      // Sizes mirror Button so a destructive action lines up with its
      // neighbouring buttons (e.g. Cancel/Confirm in confirm-dialog).
      size: {
        lg: "h-16 gap-2 px-6 py-4 text-xl leading-8 rounded-xl focus-visible:ring-2",
        md: "h-12 gap-2 px-4 py-3 text-base leading-6 rounded-xl focus-visible:ring-1",
        sm: "h-9 gap-2 px-3 py-2 text-sm leading-5 rounded-lg focus-visible:ring-1",
      },
    },
    defaultVariants: {
      variant: "filled",
      size: "sm",
    },
  }
);

export type DestructiveButtonVariant = "filled" | "outline" | "transparent";
export type DestructiveButtonSize = "lg" | "md" | "sm";

export interface DestructiveButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: DestructiveButtonVariant;
  size?: DestructiveButtonSize;
  asChild?: boolean;
}

const DestructiveButton = React.forwardRef<
  HTMLButtonElement,
  DestructiveButtonProps
>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(destructiveButtonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  );
});
DestructiveButton.displayName = "DestructiveButton";

export { DestructiveButton, destructiveButtonVariants };
