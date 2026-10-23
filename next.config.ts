import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules must stay external to the server bundle: better-sqlite3 always, node-pty is
  // the Windows attended-session launcher (optional dependency, required lazily).
  serverExternalPackages: ["better-sqlite3", "node-pty"],
  // Nothing of the App may be framed by another site (the résumé preview frames our own PDF, so
  // SAMEORIGIN), sniffed into another type, or leak its paths in a Referer (2026-10-22 review).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  experimental: {
    // Middleware (src/middleware.ts) runs on every API request, and Next caps the body it passes
    // on at 10 MB by default: documents up to the advertised 15 MB (DOCUMENT_MAX_BYTES) arrived
    // truncated and failed to parse.
    middlewareClientMaxBodySize: "16mb",
  },
};

export default nextConfig;
