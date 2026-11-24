import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter(({ family }) => family === "IPv4")
    .map(({ address }) => address),
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
