import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native / WASM packages used by the KYC validator, and the Postgres driver, must not be bundled.
  serverExternalPackages: ['sharp', 'tesseract.js', '@tesseract.js-data/eng', 'postgres'],
  turbopack: { root: import.meta.dirname },
  // Vercel only ships files it sees being imported, and these are read at runtime.
  outputFileTracingIncludes: {
    '/**': [
      './product_catalogue.csv',
      './training_leads.csv',
      './data/registry/*.csv',
      './data/price_sensitivity.csv',
      // tesseract.js spawns its worker from a file path (worker_threads), so the tracer never follows the
      // worker's own requires (`require('..')`, getCore's dynamic core pick, etc.) — ship them explicitly.
      './node_modules/tesseract.js/package.json',
      './node_modules/tesseract.js/src/**/*',
      './node_modules/tesseract.js-core/package.json',
      // getCore picks the build at runtime (SIMD support × OEM); it doesn't always pick the -lstm one, so ship all of them.
      './node_modules/tesseract.js-core/*.js',
      './node_modules/tesseract.js-core/*.wasm',
      './node_modules/regenerator-runtime/**/*',
      './node_modules/is-url/**/*',
      './node_modules/bmp-js/**/*',
      './node_modules/idb-keyval/**/*',
      './node_modules/wasm-feature-detect/**/*',
      './node_modules/zlibjs/**/*',
      './node_modules/@tesseract.js-data/eng/package.json',
      './node_modules/@tesseract.js-data/eng/index.js',
      './node_modules/@tesseract.js-data/eng/4.0.0/**/*',
    ],
  },
};

export default nextConfig;
