import type { NextConfig } from 'next';

const isTursoServerBuild = Boolean(process.env.VERCEL || process.env.TURSO_MIGRATION_BUILD === '1');

const nextConfig: NextConfig = {
  // Turso migration uses a server build because /api/* requires a Next.js runtime.
  // The legacy/main branch keeps the static Electron export.
  output: isTursoServerBuild ? undefined : 'export',
  trailingSlash: true, // Crucial para que Electron resuelva las rutas de archivos correctamente
  // The legacy Electron build uses ./out; Vercel/Next server builds must use the default .next.
  distDir: isTursoServerBuild ? '.next' : 'out',
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true, // Requerido para exportación estática
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },

  compress: true,
};

export default nextConfig;
