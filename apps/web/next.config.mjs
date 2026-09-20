/**
 * The browser always calls `/v1`; Next forwards that path server-side to the API.
 * Keep the target server-only so provider credentials and internal API addresses never enter the bundle.
 */
import process from 'node:process';

export const API_PROXY_ORIGIN = (process.env.YEONJAE_API_ORIGIN || 'http://localhost:8080').replace(
  /\/$/,
  '',
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${API_PROXY_ORIGIN}/v1/:path*` }];
  },
  // The app is a pure client of the /v1 API; it holds no server secrets and no database access of its own.
  poweredByHeader: false,
};

export default nextConfig;
