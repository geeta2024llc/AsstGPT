'use client';

import { supabase } from '@/lib/supabase';

const STASH_KEY = 'aiwhisper_super_admin_stash';
const ACTIVE_KEY = 'aiwhisper_impersonation_active';

export interface ImpersonationState {
  tenantId: string | null;
  tenantName: string | null;
  targetUserId: string;
  targetEmail: string;
}

function setAuthCookie(accessToken: string) {
  document.cookie = `sb-access-token=${accessToken}; path=/; max-age=604800; SameSite=Lax; secure`;
}

function getAuthCookie(): string | undefined {
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith('sb-access-token='))
    ?.split('=')[1];
}

export function getActiveImpersonation(): ImpersonationState | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(ACTIVE_KEY);
  return raw ? JSON.parse(raw) : null;
}

/**
 * Starts full session impersonation: stashes the super admin's current
 * access token, exchanges the server-issued magic-link token for a real
 * session as the target user via Supabase's own verifyOtp flow, and swaps
 * the sb-access-token cookie middleware.ts reads for tenant resolution.
 */
export async function startImpersonation(targetUserId: string, reason?: string): Promise<void> {
  const currentToken = getAuthCookie();
  if (!currentToken) throw new Error('No active super admin session to stash');

  const res = await fetch('/api/super-admin/impersonate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUserId, reason }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start impersonation');
  }
  const { email, hashedToken, tenantId, tenantName } = await res.json();

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: hashedToken,
    type: 'magiclink',
  });
  if (error || !data.session) {
    throw new Error(error?.message || 'Failed to establish impersonated session');
  }

  sessionStorage.setItem(STASH_KEY, currentToken);
  sessionStorage.setItem(
    ACTIVE_KEY,
    JSON.stringify({ tenantId, tenantName, targetUserId, targetEmail: email } satisfies ImpersonationState)
  );

  setAuthCookie(data.session.access_token);
  window.location.href = '/dashboard';
}

/** Restores the super admin's own session and logs the stop event. */
export async function stopImpersonation(): Promise<void> {
  const stashedToken = sessionStorage.getItem(STASH_KEY);
  const active = getActiveImpersonation();
  if (!stashedToken) {
    sessionStorage.removeItem(ACTIVE_KEY);
    window.location.href = '/super-admin';
    return;
  }

  // Purge the impersonated user's tokens from this browser's local storage
  // before restoring the admin's own session. scope: 'local' only clears
  // client-side state -- it does not revoke the target user's refresh token,
  // so their real sessions elsewhere are unaffected.
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Best-effort; proceed to restore the admin's cookie regardless.
  }

  setAuthCookie(stashedToken);
  sessionStorage.removeItem(STASH_KEY);
  sessionStorage.removeItem(ACTIVE_KEY);

  try {
    await fetch('/api/super-admin/impersonate/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: active?.targetUserId, tenantId: active?.tenantId }),
    });
  } catch {
    // Best-effort audit log; the session swap already happened.
  }

  window.location.href = '/super-admin';
}
