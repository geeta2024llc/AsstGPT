/**
 * Next.js Server Instrumentation
 * Automatically executes once on server startup to initialize background services,
 * leader election, and volume checks.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const isBuilding = process.env.NEXT_PHASE === 'phase-production-build';
    if (!isBuilding) {
      console.log('[INSTRUMENTATION] Bootstrapping 24/7 WhatsApp Background Service, Leader Election & Watchdog...');

      const fs = await import('fs');
      const path = await import('path');

      // 1. Verify / prepare persistent storage volume for WhatsApp sessions
      const authDir = process.env.WHATSAPP_AUTH_DIR || path.join(process.cwd(), 'whatsapp_auth');
      try {
        if (!fs.existsSync(authDir)) {
          fs.mkdirSync(authDir, { recursive: true });
        }
        console.log(`[INSTRUMENTATION] WhatsApp auth volume verified at: ${authDir}`);
      } catch (volErr) {
        console.warn(`[INSTRUMENTATION] Warning: Could not verify auth directory ${authDir}:`, volErr);
      }

      // 2. Start distributed leader election loop
      try {
        const { startLeaderElection, releaseLeadership } = await import('@/lib/whatsapp-leader');
        startLeaderElection();
        console.log('[INSTRUMENTATION] WhatsApp distributed leader election active.');

        // 3. Start background proactive re-engagement scheduler (leader-gated)
        const { startReEngagementScheduler } = await import('@/lib/re-engagement-engine');
        startReEngagementScheduler();
        console.log('[INSTRUMENTATION] Proactive re-engagement scheduler active.');

        // 4. Register graceful shutdown hooks
        const handleShutdown = async (signal: string) => {
          console.log(`[INSTRUMENTATION] Received ${signal}. Starting graceful shutdown & lease release...`);
          try {
            await releaseLeadership();
          } catch (e) {
            console.error('[INSTRUMENTATION] Error releasing leadership during shutdown:', e);
          }
        };

        process.once('SIGTERM', () => handleShutdown('SIGTERM'));
        process.once('SIGINT', () => handleShutdown('SIGINT'));
      } catch (err) {
        console.error('[INSTRUMENTATION] Failed to initialize WhatsApp background leader:', err);
      }
    }
  }
}
