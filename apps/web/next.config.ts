import type { NextConfig } from 'next';
import { validatePublicSupabaseKey } from './lib/public-config';
validatePublicSupabaseKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  // Ringside is one live game; earlier boxing pages point to it so old links keep working.
  async redirects() {
    return ['/game/boxing', '/live/boxing', '/live/ringside-v2', '/live/ringside-v3', '/live/ringside-v4', '/lab/ringside', '/lab/ringside/:path*'].map(source => ({ source, destination: '/live/ringside', permanent: false }));
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }];
  },
};
export default config;
