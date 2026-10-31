/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['sharp'],
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
};

module.exports = nextConfig;
