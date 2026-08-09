/**
 * Badge Component
 * Used for status indicators, tags, and labels
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-role-border-focus)] focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[var(--color-role-surface-action-default)] text-[var(--color-role-foreground-on-color)] hover:bg-[var(--color-role-surface-action-hover)]',
        secondary:
          'border-transparent bg-[var(--color-role-surface-component-subtle)] text-[var(--color-role-text-content-heading)] hover:bg-[var(--color-role-surface-component-hover)]',
        destructive:
          'border-transparent bg-[var(--color-role-status-critical-default)] text-[var(--color-role-foreground-on-color)] hover:bg-[var(--color-role-status-critical-default)]/90',
        outline: 'text-[var(--color-role-text-content-body)]',

        // Status variants
        success: 'border-transparent bg-[var(--color-role-status-low-subtle)] text-[var(--color-role-status-low-foreground)]',
        warning: 'border-transparent bg-[var(--color-role-status-medium-subtle)] text-[var(--color-role-status-medium-foreground)]',
        error: 'border-transparent bg-[var(--color-role-status-critical-subtle)] text-[var(--color-role-status-critical-foreground)]',
        info: 'border-transparent bg-[var(--color-role-info-subtle)] text-[var(--color-role-info-foreground)]',

        // Priority variants
        critical: 'border-transparent bg-[var(--color-role-status-critical-subtle)] text-[var(--color-role-status-critical-foreground)]',
        high: 'border-transparent bg-[var(--color-role-status-medium-subtle)] text-[var(--color-role-status-medium-foreground)]',
        medium: 'border-transparent bg-[var(--color-role-status-medium-subtle)] text-[var(--color-role-status-medium-foreground)]',
        low: 'border-transparent bg-[var(--color-role-info-subtle)] text-[var(--color-role-info-foreground)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
