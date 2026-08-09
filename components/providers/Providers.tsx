"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

/**
 * Dark is the only theme. The light half of the palette does not exist — the
 * design system is a near-black base with a white-alpha ladder, and a light
 * inversion of that is a different product, not a mode.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Mock resolvers are instant and deterministic; refetching on focus
            // only produces flicker. The real backend can turn this back on
            // per-resource when it lands.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--dos-elevated)",
            border: "1px solid var(--color-role-border-subtle)",
            color: "var(--color-role-text-content-body)",
            fontSize: "var(--body-sm-font-size)",
            borderRadius: "var(--radius-sm)",
          },
        }}
      />
    </QueryClientProvider>
  );
}
