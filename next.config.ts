import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The server reads uploaded PDFs with pdf.js, which loads its own worker module; bundling breaks that.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
