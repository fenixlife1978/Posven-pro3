import type { NextConfig } from 'next';

const isDesktopServerBuild = process.env.POSVEN_DESKTOP_BUILD === '1';

const nextConfig: NextConfig = {
  output: isDesktopServerBuild ? undefined : 'export',
  trailingSlash: true,
  distDir: isDesktopServerBuild ? '.next' : 'out',
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
