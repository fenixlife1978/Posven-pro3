import type { NextConfig } from 'next';

const isTursoServerBuild = process.env.TURSO_MIGRATION_BUILD === '1' || Boolean(process.env.VERCEL);

const nextConfig: NextConfig = {
  output: isTursoServerBuild ? undefined : 'export',
  trailingSlash: true,
  distDir: isTursoServerBuild ? '.next' : 'out',
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
