'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ShieldCheck, Lock, Mail, ArrowRight, AlertCircle, Eye, EyeOff, ShieldAlert } from 'lucide-react';

function SuperAdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') || '/super-admin';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // 1. Authenticate against Supabase Auth
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError) {
        throw authError;
      }

      if (!data?.session) {
        throw new Error('Failed to retrieve authentication session');
      }

      // 2. Set cryptographic session cookie for middleware
      document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=604800; SameSite=Lax; secure`;

      // 3. Verify server-side platform admin authority
      const meRes = await fetch('/api/super-admin/me', {
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
        },
      });

      if (!meRes.ok) {
        // User has valid auth credentials but is NOT registered as a platform admin
        await supabase.auth.signOut();
        document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax; secure';
        setError('Access Denied: This account is not authorized for platform-level Super Admin access. Please use the workspace login.');
        setLoading(false);
        return;
      }

      // 4. Authorized Super Admin -> Direct redirect to super-admin dashboard
      const targetDestination = redirectTo.startsWith('/super-admin') ? redirectTo : '/super-admin';
      router.push(targetDestination);
      router.refresh();
    } catch (err: any) {
      console.error('Super Admin login error:', err);
      setError(err.message || 'Invalid super admin credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      {error && (
        <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
          <span className="leading-tight">{error}</span>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-amber-200/90 mb-1.5">Super Admin Email</label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-amber-500/60">
            <Mail className="w-4 h-4" />
          </div>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="superadmin@domain.com"
            className="w-full pl-10 pr-4 py-2.5 bg-slate-950/70 border border-amber-500/30 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-amber-200/90 mb-1.5">Master Password</label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-amber-500/60">
            <Lock className="w-4 h-4" />
          </div>
          <input
            type={showPassword ? 'text' : 'password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            className="w-full pl-10 pr-11 py-2.5 bg-slate-950/70 border border-amber-500/30 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 focus:outline-none transition-colors"
            title={showPassword ? 'Hide password' : 'Show password'}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full mt-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {loading ? (
          <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            <span>Authenticate Platform Session</span>
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
    </form>
  );
}

export default function SuperAdminLoginPage() {
  return (
    <div className="min-h-screen w-full bg-[#080c14] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-amber-500/30">
      {/* Dynamic ambient background glow */}
      <div className="absolute top-[-20%] left-[-10%] w-[550px] h-[550px] rounded-full bg-amber-500/10 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-rose-600/10 blur-[150px] pointer-events-none" />

      <div className="w-full max-w-md z-10">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-400 p-[1px] shadow-lg shadow-amber-500/25 mb-4">
            <div className="w-full h-full bg-[#080c14] rounded-2xl flex items-center justify-center">
              <ShieldCheck className="w-7 h-7 text-amber-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">SuperAdmin Control Center</h1>
          <p className="text-sm text-slate-400 mt-1">Platform Governance, Tenant & Admin Management</p>
        </div>

        {/* Glassmorphic Login Card */}
        <div className="bg-slate-900/70 backdrop-blur-xl border border-amber-500/20 rounded-2xl p-7 shadow-2xl shadow-black/80">
          <div className="flex items-center gap-2 mb-6 text-xs uppercase tracking-wider font-semibold text-amber-400">
            <ShieldAlert className="w-4 h-4 text-amber-400" /> Super Admin Credentials Only
          </div>

          <Suspense fallback={<div className="py-8 text-center text-xs text-slate-500">Loading sign in...</div>}>
            <SuperAdminLoginForm />
          </Suspense>

          <div className="mt-6 pt-5 border-t border-slate-800/80 text-center">
            <p className="text-xs text-slate-400">
              Not a platform super admin?{' '}
              <Link href="/login" className="text-emerald-400 hover:text-emerald-300 font-medium underline underline-offset-2">
                Workspace Admin Login
              </Link>
            </p>
          </div>
        </div>

        {/* Footer info */}
        <p className="text-center text-[11px] text-slate-600 mt-6">
          Platform-level access &mdash; all actions are cryptographically audited & logged
        </p>
      </div>
    </div>
  );
}
