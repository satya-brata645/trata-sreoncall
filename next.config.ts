import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack configuration (Next.js 16 default)
  turbopack: {},

  // Keep prefetched route segments in the client router cache so re-visiting a
  // tab skips a fresh RSC round-trip and feels instant. Default dynamic
  // staleTime is 0, which evicts payloads immediately. Data freshness is owned
  // by React Query (revalidates independently of the router cache), so a short
  // router-cache window here is safe.
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
