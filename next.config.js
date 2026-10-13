/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
await import("./src/env.js");

// A private development tunnel needs its exact origin for assets and actions.
// Production never inherits this development-only allowance.
const devURL = process.env.NODE_ENV === 'development' && process.env.PUBLIC_URL
  ? new URL(process.env.PUBLIC_URL)
  : null;

/** @type {import("next").NextConfig} */
const config = {
  ...(devURL ? { allowedDevOrigins: [devURL.hostname] } : {}),
  // typescript: {
  //   ignoreBuildErrors: true,
  // },
  experimental: {
    ...(devURL ? { serverActions: { allowedOrigins: [devURL.host] } } : {}),
    // reactCompiler: true, // Temporarily disabled to test if this causes safe area issues
  },
  // Disable automatic static optimization and prefetching
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/share/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/map",
        permanent: true,
      },
      {
        source: "/stats",
        destination: "/stats/tiles",
        permanent: true,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.cloudfront.net',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'image.mux.com',
        pathname: '/**',
      },
    ],
  },
};

export default config;
