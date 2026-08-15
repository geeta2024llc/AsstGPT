'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Sparkles, Lock, Mail, ArrowRight, ShieldCheck, AlertCircle, Eye, EyeOff } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') || '/inbox';
  const isUnassigned = searchParams.get('unassigned') === '1';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    isUnassigned
      ? 'Your account is not assigned to any workspace yet. Please create a workspace or ask an administrator to invite you.'
      : null
  );

  useEffect(() => {
    if (isUnassigned) {
      setError('Your account is not assigned to any workspace yet. Please create a workspace or ask an administrator to invite you.');
    }
  }, [isUnassigned]);

  useEffect(() => {
    try {
      const savedRemember = localStorage.getItem('asstgpt_remember_me');
      const savedEmail = localStorage.getItem('asstgpt_remembered_email');
      if (savedRemember === 'true' && savedEmail) {
        setEmail(savedEmail);
        setRememberMe(true);
      } else if (savedRemember === 'false') {
        setRememberMe(false);
      }
    } catch (_) {}
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const cleanEmail = email.trim().toLowerCase();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (authError) {
        throw authError;
      }

      if (data?.session) {
        // Save or clear remembered email in localStorage
        try {
          if (rememberMe) {
            localStorage.setItem('asstgpt_remember_me', 'true');
            localStorage.setItem('asstgpt_remembered_email', cleanEmail);
          } else {
            localStorage.setItem('asstgpt_remember_me', 'false');
            localStorage.removeItem('asstgpt_remembered_email');
          }
        } catch (_) {}

        // Set session cookie for middleware (30 days if rememberMe, 1 day if not)
        const cookieMaxAge = rememberMe ? 2592000 : 86400;
        document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=${cookieMaxAge}; SameSite=Lax; secure`;

        // 1. Smart role detection: Check if this user is a platform super admin
        try {
          const meRes = await fetch('/api/super-admin/me', {
            headers: { Authorization: `Bearer ${data.session.access_token}` },
          });
          if (meRes.ok) {
            const meData = await meRes.json();
            if (meData?.platformRole) {
              router.push('/super-admin');
              return;
            }
          }
        } catch (_) {
          // Continue to workspace routing check
        }

        // 2. Check if user already has an active workspace claim in JWT
        const userAppMeta = data.user?.app_metadata;
        const tenantId = userAppMeta?.tenant_id;

        if (tenantId) {
          router.push(redirectTo);
          return;
        }

        // 3. If no active workspace claim in token, check if user has memberships via /api/tenant/switch
        try {
          const wsRes = await fetch('/api/tenant/switch', {
            headers: { Authorization: `Bearer ${data.session.access_token}` },
          });
          if (wsRes.ok) {
            const wsData = await wsRes.json();
            if (wsData?.workspaces && wsData.workspaces.length > 0) {
              // Auto-activate the first accessible workspace
              const switchRes = await fetch('/api/tenant/switch', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${data.session.access_token}`,
                },
                body: JSON.stringify({ targetTenantId: wsData.workspaces[0].tenantId }),
              });
              if (switchRes.ok) {
                router.push(redirectTo);
                return;
              }
            }
          }
        } catch (_) {}

        // 4. Authenticated user with no workspace and not a super admin
        setError('Your account is authenticated but not assigned to any workspace yet. Please create a new workspace below.');
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      {error && (
        <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-xs font-medium text-slate-300 mb-1.5">Work Email</label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
            <Mail className="w-4 h-4" />
          </div>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            className="w-full pl-10 pr-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
          />
        </div>
      </div>

      <div>
        <label htmlFor="password" className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
            <Lock className="w-4 h-4" />
          </div>
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            className="w-full pl-10 pr-11 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
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

      {/* Remember Me Checkbox */}
      <div className="flex items-center justify-between pt-0.5 pb-1">
        <label htmlFor="rememberMe" className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none group">
          <input
            id="rememberMe"
            name="rememberMe"
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="w-4 h-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500 focus:ring-emerald-500/20 focus:ring-offset-0 focus:ring-2 cursor-pointer accent-emerald-500 transition-all"
          />
          <span className="group-hover:text-slate-200 transition-colors">Remember me</span>
        </label>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full mt-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-semibold text-sm transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {loading ? (
          <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            <span>Sign In</span>
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full bg-[#0a0f1d] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-emerald-500/30">
      {/* Dynamic ambient background glow */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-blue-600/10 blur-[140px] pointer-events-none" />

      <div className="w-full max-w-md z-10">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-[1px] shadow-lg shadow-emerald-500/20 mb-4">
            <div className="w-full h-full bg-[#0a0f1d] rounded-2xl flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-emerald-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">AsstGPT Platform</h1>
          <p className="text-sm text-slate-400 mt-1">Autonomous WhatsApp & Omnichannel AI Agent</p>
        </div>

        {/* Glassmorphic Login Card */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-7 shadow-2xl shadow-black/60">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-6">
            <ShieldCheck className="w-4 h-4" /> Secure Access
          </div>

          <Suspense fallback={<div className="py-8 text-center text-xs text-slate-500">Loading sign in...</div>}>
            <LoginForm />
          </Suspense>

          <div className="mt-6 pt-5 border-t border-slate-800/80 text-center space-y-2">
            <p className="text-xs text-slate-400">
              Need to set up a new organization?{' '}
              <a href="/signup" className="text-emerald-400 hover:text-emerald-300 font-medium underline underline-offset-2">
                Create Workspace
              </a>
            </p>
          </div>
        </div>

        {/* Footer info */}
        <p className="text-center text-[11px] text-slate-600 mt-6">
          Protected by End-to-End Database Isolation & RBAC Security
        </p>
      </div>
    </div>
  );
}
