#!/bin/sh
set -e

# Railway mounts the persistent volume at /app/whatsapp-auth *after* the image
# is built, and the mount overlays whatever ownership/permissions the
# Dockerfile baked into that path at build time. A freshly created Railway
# volume is root-owned, so the container's unprivileged `nextjs` user gets
# EACCES on every write (creds.json, key files) even though the image build
# already ran `chown nextjs:nodejs` on that same path — that chown only ever
# applied to the image layer, never to the actual mounted volume. Fix
# ownership here, now that the real volume is mounted, then drop from root
# to the unprivileged user for the actual server process.
mkdir -p /app/whatsapp-auth
chown -R nextjs:nodejs /app/whatsapp-auth
chmod -R 777 /app/whatsapp-auth

exec su-exec nextjs:nodejs "$@"
