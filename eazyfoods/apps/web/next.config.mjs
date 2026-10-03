/** @type {import('next').NextConfig} */
const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
export default {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    // Browsers talk to one origin. The API stays a separate service that can be deployed on its own.
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
      ],
    }];
  },
};
