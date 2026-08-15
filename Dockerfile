# ============================================================================
# Production Dockerfile for AIWhisper (Next.js + Baileys + Supabase + Gemini)
# Maintains persistent WhatsApp session storage via mounted volume at /app/whatsapp-auth
# ============================================================================

FROM node:20-alpine AS base

# 1. Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# 2. Rebuild source code
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NEXT_PHASE=phase-production-build

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN npm run build

# 3. Production runner image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=9002
ENV HOSTNAME="0.0.0.0"

# su-exec: tiny Alpine-native way to drop from root to an unprivileged user
# after the entrypoint's runtime chown (see docker-entrypoint.sh).
RUN apk add --no-cache su-exec

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Build-time chown/chmod here only ever applies to this image layer. Railway's
# persistent volume is mounted at this exact path at container start and
# overlays it, replacing this ownership with whatever the volume actually has
# (root, on first creation) — which is why creds.json writes were failing
# with EACCES despite this line. Kept as a harmless fallback for non-volume
# runs (e.g. local `docker run` without a mount); the real fix is the
# runtime chown in docker-entrypoint.sh, which runs after the volume exists.
RUN mkdir -p /app/whatsapp-auth && chown -R nextjs:nodejs /app/whatsapp-auth && chmod 777 /app/whatsapp-auth

# Copy standalone build assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Container starts as root so the entrypoint can chown the just-mounted
# volume; it immediately drops to the unprivileged `nextjs` user via
# su-exec before running the actual server process.
EXPOSE 9002

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9002/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
