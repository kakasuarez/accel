import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native / WASM packages used by the KYC validator, and the Postgres driver, must not be bundled.
  serverExternalPackages: ['sharp', 'tesseract.js', '@tesseract.js-data/eng', 'postgres'],
  turbopack: { root: import.meta.dirname },
  // Vercel only ships files it sees being imported, and these are read at runtime.
  outputFileTracingIncludes: {
    '/**': ['./product_catalogue.csv', './training_leads.csv', './data/registry/*.csv', './data/price_sensitivity.csv'],
  },
};

export default nextConfig;
