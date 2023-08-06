/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASEPATH,
  assetPrefix: process.env.NEXT_PUBLIC_BASEPATH + "/",
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
