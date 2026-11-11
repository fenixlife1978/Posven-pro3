import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // POSVEN3 is a desktop application whose local Node server hosts the UI/API.
  // Static export would remove the server routes required by the LAN host.
  output: undefined,
  trailingSlash: true,
  distDir: '.next',
  serverExternalPackages: ['better-sqlite3'],
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'placehold.co', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'images.unsplash.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'picsum.photos', port: '', pathname: '/**' },
    ],
  },
  compress: true,
};

export default nextConfig;
