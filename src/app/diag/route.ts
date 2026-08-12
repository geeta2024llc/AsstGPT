import { NextResponse } from 'next/server';

// Zero-dependency diagnostic route, deliberately placed OUTSIDE /api/* so it
// is never touched by the /api/:path* rewrite to Railway (next.config.ts).
// Hitting this path always answers "what is Vercel itself actually serving
// right now", independent of the Railway proxy or any other app code.
// Never exposes secret values — only booleans and non-secret Vercel Git
// metadata that Vercel injects automatically at runtime.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    runtime: {
      isVercel: process.env.VERCEL === '1',
      vercelEnv: process.env.VERCEL_ENV || null,
      gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
      nodeEnv: process.env.NODE_ENV || null,
    },
    config: {
      apiBaseUrlConfigured: Boolean(process.env.NEXT_PUBLIC_API_BASE_URL),
    },
  });
}
