import type {NextConfig} from 'next';

// Vercel sets VERCEL=1 automatically on every build it runs. Its builder
// produces its own optimized serverless-function output and does not consume
// `.next/standalone` — leaving `output: 'standalone'` enabled there has been
// observed to interfere with Vercel's route/function detection, silently
// dropping API routes (404) even on an otherwise "successful" build. Railway
// (no VERCEL env var) still needs it: the Dockerfile copies
// `.next/standalone` directly.
const isVercelBuild = !!process.env.VERCEL;

// Safe build-time diagnostic: confirms whether the backend proxy target is
// configured, without ever printing its value.
console.log(`[next.config] NEXT_PUBLIC_API_BASE_URL present at build: ${!!process.env.NEXT_PUBLIC_API_BASE_URL}`);

const nextConfig: NextConfig = {
  output: isVercelBuild ? undefined : 'standalone',
  compress: true,
  serverExternalPackages: [
    '@whiskeysockets/baileys',
    'pino',
    'pdfjs-dist',
    'mammoth',
    'jimp',
    'ws',
    'bufferutil',
    'utf-8-validate',
    '@hapi/boom',
    'pg',
  ],
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'date-fns',
      '@radix-ui/react-dialog',
      '@radix-ui/react-select',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-avatar',
      '@radix-ui/react-tabs',
      '@radix-ui/react-toast',
      '@radix-ui/react-switch',
      '@radix-ui/react-slider',
      '@radix-ui/react-scroll-area',
    ],
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
  async headers() {
    const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: allowedOrigin },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PATCH, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, X-Requested-With' },
        ],
      },
    ];
  },
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!backendUrl) return { beforeFiles: [] };
    const target = backendUrl.startsWith('http') ? backendUrl : `https://${backendUrl}`;
    // Must run as `beforeFiles`: this codebase's own build also contains local
    // /api/* route handlers, which would otherwise shadow the proxy to the
    // Railway backend (default array-form rewrites only run `afterFiles`,
    // i.e. after local filesystem routes are already checked and matched).
    return {
      beforeFiles: [
        {
          source: '/api/:path*',
          destination: `${target}/api/:path*`,
        },
      ],
    };
  },
  webpack: (config, {isServer}) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
      };
    }
    return config;
  },
};

export default nextConfig;
