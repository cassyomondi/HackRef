import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep local development from generating or rewriting repository guidance.
  agentRules: false,
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
};

export default nextConfig;
