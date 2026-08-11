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

ENV NEXT_TELEMETRY_DISABLED 1
ENV NODE_ENV production
ENV NEXT_PHASE phase-production-build

RUN npm run build

# 3. Production runner image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV PORT 9002
ENV HOSTNAME "0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Create whatsapp-auth directory with wide write permissions so mounted Railway volume is writable
RUN mkdir -p /app/whatsapp-auth && chown -R nextjs:nodejs /app/whatsapp-auth && chmod 777 /app/whatsapp-auth

# Copy standalone build assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 9002

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9002/api/health || exit 1

CMD ["node", "server.js"]
