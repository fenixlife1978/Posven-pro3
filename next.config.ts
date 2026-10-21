import type { NextConfig } from 'next';

const isDesktopServerBuild = process.env.POSVEN_DESKTOP_BUILD === '1' || Boolean(process.env.VERCEL);

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
  env: {
    NEXT_PUBLIC_POSVEN_DEMO_BUILD: process.env.POSVEN_DEMO_BUILD === '1' ? '1' : '0',
    POSVEN_DEMO_BUILD: process.env.POSVEN_DEMO_BUILD === '1' ? '1' : '0',
  },
};

export default nextConfig;
