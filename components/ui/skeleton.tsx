import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-[var(--color-role-surface-component-subtle)]", className)}
      {...props}
    />
  );
}

export { Skeleton };
