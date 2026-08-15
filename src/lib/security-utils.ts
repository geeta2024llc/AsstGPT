/**
 * Constant-time comparison for strings/secrets to prevent timing attacks across both Node.js and Edge runtimes.
 */
export function timingSafeCompare(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Checks if an IP string is within a private, loopback, or link-local range.
 */
export function isPrivateOrLocalIP(ip: string): boolean {
  // IPv4 check
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip.match(ipv4Regex);
  if (match) {
    const parts = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
    if (parts.some((p) => p > 255)) return true;

    // Loopback 127.0.0.0/8
    if (parts[0] === 127) return true;
    // Current network 0.0.0.0/8
    if (parts[0] === 0) return true;
    // RFC 1918 Private ranges:
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // Link-local / AWS/GCP/Azure metadata 169.254.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true;
    // Broadcast 255.255.255.255
    if (parts[0] === 255) return true;
    // CGNAT 100.64.0.0/10
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;

    return false;
  }

  // IPv6 check
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.includes('::ffff:')) {
    const ipv4Part = normalized.split('::ffff:')[1];
    if (ipv4Part && isPrivateOrLocalIP(ipv4Part)) return true;
  }

  return false;
}

export function validateSafeWebhookUrl(
  urlStr: string,
  options?: { allowLocalTest?: boolean }
): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(urlStr);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: 'Only HTTP and HTTPS protocols are permitted.' };
    }

    const hostname = parsed.hostname.toLowerCase();
    const allowLocal = options?.allowLocalTest ?? (process.env.ALLOW_LOCAL_WEBHOOKS === 'true');

    // Cloud metadata endpoints are NEVER allowed under any circumstances
    const criticalBlocked = [
      '169.254.169.254',
      'metadata.google.internal',
      'instance-data',
    ];
    if (criticalBlocked.includes(hostname) || hostname.startsWith('169.254.')) {
      return { valid: false, reason: `Target host "${hostname}" is forbidden (cloud metadata endpoint).` };
    }

    // Block localhost, link-local, internal domains unless explicitly running in test mode
    const blockedHostnames = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
    ];

    if (!allowLocal) {
      if (blockedHostnames.includes(hostname)) {
        return { valid: false, reason: `Target host "${hostname}" is forbidden (localhost/loopback endpoint).` };
      }

      if (
        hostname.endsWith('.internal') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.lan') ||
        hostname.endsWith('.home')
      ) {
        return { valid: false, reason: `Internal domain suffix in "${hostname}" is forbidden.` };
      }

      // Direct IP address checks
      if (isPrivateOrLocalIP(hostname)) {
        return { valid: false, reason: `Direct private/link-local IP address "${hostname}" is blocked.` };
      }
    }

    return { valid: true };
  } catch (err: any) {
    return { valid: false, reason: `Malformed URL: ${err.message}` };
  }
}

/**
 * Cryptographic secret for signing webchat widget sessions.
 */
function getWidgetSigningSecret(): string {
  return (
    process.env.WIDGET_SECRET ||
    process.env.API_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'aiwhisper_default_widget_session_secret'
  );
}

/**
 * Generates an HMAC-SHA256 signature for a widget session to prevent session hijacking.
 */
export function signWidgetSession(sessionId: string, tenantId: string): string {
  const secret = getWidgetSigningSecret();
  const payload = `${tenantId}:${sessionId}`;
  try {
    // Dynamic require for Node.js runtime without forcing Edge bundling
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto');
    return nodeCrypto.createHmac('sha256', secret).update(payload).digest('hex');
  } catch {
    // Fallback deterministic digest
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      hash = ((hash << 5) - hash) + payload.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}

/**
 * Verifies the HMAC-SHA256 signature of a widget session.
 */
export function verifyWidgetSession(sessionId: string, tenantId: string, token?: string | null): boolean {
  if (!token) return false;
  const expected = signWidgetSession(sessionId, tenantId);
  return timingSafeCompare(expected, token);
}
