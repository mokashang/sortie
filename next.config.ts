import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules must stay external to the server bundle: better-sqlite3 always, node-pty is
  // the Windows attended-session launcher (optional dependency, required lazily).
  serverExternalPackages: ["better-sqlite3", "node-pty"],
};

export default nextConfig;
