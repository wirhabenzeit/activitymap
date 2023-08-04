/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  output: "export",
  basePath: "/stravamap",
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
