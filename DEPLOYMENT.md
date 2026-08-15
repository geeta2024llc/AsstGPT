# AsstGPT Production Deployment Guide

## Deployment Architecture

```
                    ┌─────────────────────────┐
                    │      Vercel (UI)        │
                    │  https://your-ui.vercel │
                    └────────────┬────────────┘
                                 │
                                 │ HTTPS Rewrites / CORS API Requests
                                 ▼
                    ┌─────────────────────────┐
                    │   Railway (Backend)     │
                    │ Node.js Server Process  │
                    │ Baileys WASocket        │
                    │ Gemini AI Engine        │
                    │ RAG Knowledge Engine    │
                    │ Volume: /app/whatsapp-auth│
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │    Supabase Cloud DB    │
                    │  PostgreSQL + RLS       │
                    └─────────────────────────┘
```

---

## 1. Railway Backend Deployment (Persistent Node + Baileys)

### Step 1: Create New Project on Railway
1. Go to [railway.app](https://railway.app) and create a project.
2. Select **Deploy from GitHub repo** and select `AIWhisper`.

### Step 2: Configure Persistent Volume
1. In your Railway service settings, go to **Volumes**.
2. Click **Add Volume**.
3. Set **Mount Path** to `/app/whatsapp-auth`.
4. This ensures your WhatsApp login session survives app restarts, redeployments, and host restarts without requiring a new QR scan!

### Step 3: Configure Railway Environment Variables
In Railway **Variables**, add the following:

```env
DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000001
NEXT_PUBLIC_SUPABASE_URL=YOUR_NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
ALLOWED_ORIGIN=https://YOUR_VERCEL_APP_DOMAIN.vercel.app
NODE_ENV=production
```

> [!NOTE]
> Railway automatically assigns a dynamic `$PORT` variable (e.g. `PORT=8080`). AsstGPT's [Dockerfile](file:///h:/Antigravity/Ai%20Automation/AIWhisper/Dockerfile) automatically binds to dynamic `$PORT`.

### Step 4: Generate Domain & Check Health
1. Go to **Settings** -> **Networking** -> **Generate Domain**.
2. Copy your backend domain e.g. `https://aiwhisper-backend.up.railway.app`.
3. Verify health in browser: `https://aiwhisper-backend.up.railway.app/api/health`.

---

## 2. Vercel Frontend Deployment

### Step 1: Import Project on Vercel
1. Go to [vercel.com](https://vercel.com) and click **Add New Project**.
2. Import `AIWhisper` from GitHub.

### Step 2: Configure Vercel Environment Variables
Add the following in Vercel **Environment Variables**:

```env
NEXT_PUBLIC_SUPABASE_URL=YOUR_NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_API_BASE_URL=https://YOUR_RAILWAY_DOMAIN.up.railway.app
```

> [!SECURITY]
> **Do NOT add** `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, or `GEMINI_API_KEY` to Vercel! Server secrets belong exclusively on Railway.

---

## 3. Alternative: VPS Deployment (Ubuntu + Docker + Caddy)

If deploying to your own Ubuntu VPS:

### Step 1: Install Docker & Docker Compose
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin caddy
sudo systemctl enable --now docker
```

### Step 2: Clone & Configure
```bash
git clone https://github.com/YOUR_USER/AIWhisper.git /opt/aiwhisper
cd /opt/aiwhisper
cp .env.example .env
nano .env # Populate secrets
```

### Step 3: Build & Start Containers
```bash
docker compose up -d --build
```

### Step 4: Configure Automatic HTTPS with Caddy
Edit `/etc/caddy/Caddyfile`:
```caddy
aiwhisper.yourdomain.com {
    reverse_proxy 127.0.0.1:9002
}
```
Reload Caddy:
```bash
sudo systemctl reload caddy
```

---

## 4. Operational Commands & Maintenance

### Check Health & Auth Storage Endpoint
```bash
curl -s https://YOUR_RAILWAY_DOMAIN.up.railway.app/api/health
```
Example healthy response payload:
```json
{
  "status": "ok",
  "checks": {
    "database": "connected",
    "whatsApp": "connected",
    "whatsappStorage": {
      "writable": true,
      "exists": true,
      "hasCredentials": true,
      "error": null
    }
  }
}
```

### Backup WhatsApp Session Storage
```bash
# On VPS or container volume
tar -czvf whatsapp-auth-backup-$(date +%F).tar.gz whatsapp-auth/
```

### Troubleshooting WhatsApp Reconnects & Session Storage
If WhatsApp client gets stuck or fails to save credentials:
1. Verify Railway Volume Mount Path is strictly `/app/whatsapp-auth`.
2. Inspect `checks.whatsappStorage` in `/api/health`. If `writable: false`, verify that `docker-entrypoint.sh` ran successfully as root before dropping privileges.
3. Visit `/dashboard` -> Connection Status and click **Reset Connection / Rescan QR** if session was revoked on phone.

