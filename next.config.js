/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
await import("./src/env.js");

/** @type {import("next").NextConfig} */
const config = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    reactCompiler: true,
  },
  reactStrictMode: true,
  async redirects() {
    return [
      {source: "/", destination: "/map", permanent: true},
      {
        source: "/stats",
        destination: "/stats/calendar",
        permanent: true,
      },
    ];
  },
};

export default config;
