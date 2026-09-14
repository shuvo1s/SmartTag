import type { NextConfig } from 'next';

/**
 * The browser talks only to this origin. `/api/v1/*` is proxied to the NestJS API so session
 * cookies stay first-party and no CORS is required. Business logic never runs in Next.js.
 *
 * API_INTERNAL_URL is read when the Next.js server builds its routing table (build/start).
 */
const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@smarttag/ui'],
  rewrites() {
    return Promise.resolve([{ source: '/api/v1/:path*', destination: `${apiInternalUrl}/api/v1/:path*` }]);
  },
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]);
  },
};

export default nextConfig;
