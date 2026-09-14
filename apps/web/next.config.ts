import type { NextConfig } from 'next';

/**
 * The browser talks only to this origin. `/api/v1/*` is forwarded to the NestJS API by the
 * streaming route handler in src/app/api/v1/[...path]/route.ts, which reads API_INTERNAL_URL at
 * runtime. Session cookies stay first-party and no CORS is required. Business logic never runs
 * in Next.js.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@smarttag/ui'],
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
