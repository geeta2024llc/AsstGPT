/**
 * Next.js Server Instrumentation
 * Automatically executes once on server startup to initialize background services.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const isBuilding = process.env.NEXT_PHASE === 'phase-production-build';
    if (!isBuilding) {
      console.log('[INSTRUMENTATION] Bootstrapping 24/7 WhatsApp Background Service & Watchdog...');
      try {
        await import('@/lib/whatsapp-client');
        console.log('[INSTRUMENTATION] WhatsApp Background Service initialized successfully.');
      } catch (err) {
        console.error('[INSTRUMENTATION] Failed to initialize WhatsApp background client:', err);
      }
    }
  }
}
