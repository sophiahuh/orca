import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The server reads uploaded PDFs with pdf.js, which loads its own worker module; bundling breaks that.
  serverExternalPackages: ["pdfjs-dist"],
  // The browser tests also reach the dev server as 127.0.0.1 (e2e/auth.spec.ts); only affects `next dev`.
  allowedDevOrigins: ["127.0.0.1"],
  // The reader starts pdf.js's worker module on a thread by its package name (src/lib/material/read-pdf.ts),
  // which file tracing can't see; make sure the deployed function has the file. The key is a glob
  // over route paths: written as `/api/materials/[id]/process`, the brackets read as a character
  // class and never match, and the deployed function lacked the file ("Setting up fake worker failed").
  outputFileTracingIncludes: {
    "/api/materials/*/process": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;
