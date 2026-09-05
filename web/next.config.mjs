/** @type {import('next').NextConfig} */
const nextConfig = {
  // grc-program is never imported into the web bundle. Each run happens in a
  // separate Node ESM process (scripts/run-grc.mjs) that imports the tool's
  // modules natively and opens its own DuckDB warehouse, so there is nothing
  // here to externalize and no ESM/CJS interop for the bundler to get wrong
  // under `next start` — and the duckdb native addon is loaded by the child,
  // never by Next.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
