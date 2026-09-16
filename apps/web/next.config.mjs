/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The app is a pure client of the /v1 API; it holds no server secrets and no database access of its own.
  poweredByHeader: false,
};

export default nextConfig;
