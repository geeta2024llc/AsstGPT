'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Sparkles, Lock, User, ArrowRight, ShieldCheck, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';

interface InvitePreview {
  email: string;
  role: string;
  tenantName: string;
  existingAccount: boolean;
}

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isLoggedIn = typeof document !== 'undefined' && document.cookie.includes('sb-access-token=');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/invite/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'This invitation is invalid or has expired');
        if (!cancelled) setPreview(data);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!preview?.existingAccount || !isLoggedIn) return;
    setJoining(true);
    fetch('/api/team/invitations/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to join workspace');
        router.push('/inbox');
      })
      .catch((err) => {
        setError(err.message || 'Failed to join workspace');
        setJoining(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, isLoggedIn]);

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/invite/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to accept invitation');

      if (data.session) {
        document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=604800; SameSite=Lax; secure`;
        router.push('/inbox');
      } else {
        router.push('/login?message=Account created. Please log in.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to accept invitation');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0a0f1d] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-emerald-500/30">
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-blue-600/10 blur-[140px] pointer-events-none" />

      <div className="w-full max-w-md z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-[1px] shadow-lg shadow-emerald-500/20 mb-4">
            <div className="w-full h-full bg-[#0a0f1d] rounded-2xl flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-emerald-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">You've Been Invited</h1>
          <p className="text-sm text-slate-400 mt-1">
            {preview ? `Join ${preview.tenantName} on AsstGPT` : 'Checking your invitation...'}
          </p>
        </div>

        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-7 shadow-2xl shadow-black/60">
          <div className="flex items-center gap-2 mb-6 text-xs uppercase tracking-wider font-semibold text-emerald-400">
            <ShieldCheck className="w-4 h-4" /> Workspace Invitation
          </div>

          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
            </div>
          ) : !preview ? (
            <div className="text-center py-4">
              <a href="/login" className="text-emerald-400 hover:text-emerald-300 font-medium underline underline-offset-2 text-sm">
                Go to Sign In
              </a>
            </div>
          ) : preview.existingAccount ? (
            joining ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                <p className="text-sm text-slate-400">Joining {preview.tenantName}...</p>
              </div>
            ) : (
              <div className="space-y-4 text-center py-2">
                <p className="text-sm text-slate-300">
                  <span className="font-medium text-white">{preview.email}</span> already has an account. Sign in to accept this invitation.
                </p>
                <button
                  onClick={() => router.push(`/login?redirectTo=${encodeURIComponent(`/invite/${token}`)}`)}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-semibold text-sm transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Sign In to Accept</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )
          ) : (
            <form onSubmit={handleAccept} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Email</label>
                <input
                  type="email"
                  disabled
                  value={preview.email}
                  className="w-full px-4 py-2.5 bg-slate-950/40 border border-slate-800 rounded-xl text-sm text-slate-400 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Your Full Name</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Sarah Jenkins"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Set a Password</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
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

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-semibold text-sm transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? (
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Accept & Join {preview.tenantName}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
