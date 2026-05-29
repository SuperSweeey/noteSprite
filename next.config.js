/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "cos-nodejs-sdk-v5"],
  },
};

module.exports = nextConfig;
