import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["postgres"],
  turbopack: { root: import.meta.dirname },
  // Vercel only ships files it sees being imported, and these two are read at runtime.
  outputFileTracingIncludes: { "/**": ["./product_catalogue.csv", "./training_leads.csv"] },
};

export default config;
