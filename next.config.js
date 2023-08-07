/** @type {import('next').NextConfig} */

//const { default: next } = require("next/types");

const nextConfig = {
  reactStrictMode: false,
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASEPATH,
  assetPrefix: process.env.NEXT_PUBLIC_BASEPATH + "/",
  images: {
    unoptimized: true,
  },
};

//module.exports= nextConfig;
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});
module.exports = withBundleAnalyzer(nextConfig);
