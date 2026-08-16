'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  Sparkles,
  Lock,
  Mail,
  Building2,
  User,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  Eye,
  EyeOff,
  CheckCircle2,
  Phone,
  ChevronDown,
} from 'lucide-react';

const COUNTRY_CODES = [
  { code: 'NP', dialCode: '+977', name: 'Nepal', flag: '🇳🇵' },
  { code: 'IN', dialCode: '+91', name: 'India', flag: '🇮🇳' },
  { code: 'US', dialCode: '+1', name: 'United States', flag: '🇺🇸' },
  { code: 'GB', dialCode: '+44', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'AE', dialCode: '+971', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: 'AU', dialCode: '+61', name: 'Australia', flag: '🇦🇺' },
  { code: 'CA', dialCode: '+1', name: 'Canada', flag: '🇨🇦' },
  { code: 'SG', dialCode: '+65', name: 'Singapore', flag: '🇸🇬' },
  { code: 'BD', dialCode: '+880', name: 'Bangladesh', flag: '🇧🇩' },
  { code: 'PK', dialCode: '+92', name: 'Pakistan', flag: '🇵🇰' },
  { code: 'LK', dialCode: '+94', name: 'Sri Lanka', flag: '🇱🇰' },
  { code: 'MY', dialCode: '+60', name: 'Malaysia', flag: '🇲🇾' },
  { code: 'PH', dialCode: '+63', name: 'Philippines', flag: '🇵🇭' },
  { code: 'QA', dialCode: '+974', name: 'Qatar', flag: '🇶🇦' },
  { code: 'SA', dialCode: '+966', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'KW', dialCode: '+965', name: 'Kuwait', flag: '🇰🇼' },
  { code: 'OM', dialCode: '+968', name: 'Oman', flag: '🇴🇲' },
  { code: 'BH', dialCode: '+973', name: 'Bahrain', flag: '🇧🇭' },
  { code: 'JP', dialCode: '+81', name: 'Japan', flag: '🇯🇵' },
  { code: 'KR', dialCode: '+82', name: 'South Korea', flag: '🇰🇷' },
  { code: 'CN', dialCode: '+86', name: 'China', flag: '🇨🇳' },
  { code: 'DE', dialCode: '+49', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', dialCode: '+33', name: 'France', flag: '🇫🇷' },
  { code: 'IT', dialCode: '+39', name: 'Italy', flag: '🇮🇹' },
  { code: 'ES', dialCode: '+34', name: 'Spain', flag: '🇪🇸' },
  { code: 'NL', dialCode: '+31', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'CH', dialCode: '+41', name: 'Switzerland', flag: '🇨🇭' },
  { code: 'SE', dialCode: '+46', name: 'Sweden', flag: '🇸🇪' },
  { code: 'NO', dialCode: '+47', name: 'Norway', flag: '🇳🇴' },
  { code: 'DK', dialCode: '+45', name: 'Denmark', flag: '🇩🇰' },
  { code: 'FI', dialCode: '+358', name: 'Finland', flag: '🇫🇮' },
  { code: 'NZ', dialCode: '+64', name: 'New Zealand', flag: '🇳🇿' },
  { code: 'ZA', dialCode: '+27', name: 'South Africa', flag: '🇿🇦' },
  { code: 'BR', dialCode: '+55', name: 'Brazil', flag: '🇧🇷' },
  { code: 'MX', dialCode: '+52', name: 'Mexico', flag: '🇲🇽' },
  { code: 'TR', dialCode: '+90', name: 'Turkey', flag: '🇹🇷' },
  { code: 'TH', dialCode: '+66', name: 'Thailand', flag: '🇹🇭' },
  { code: 'VN', dialCode: '+84', name: 'Vietnam', flag: '🇻🇳' },
  { code: 'ID', dialCode: '+62', name: 'Indonesia', flag: '🇮🇩' },
  { code: 'EG', dialCode: '+20', name: 'Egypt', flag: '🇪🇬' },
  { code: 'NG', dialCode: '+234', name: 'Nigeria', flag: '🇳🇬' },
  { code: 'KE', dialCode: '+254', name: 'Kenya', flag: '🇰🇪' },
  { code: 'IE', dialCode: '+353', name: 'Ireland', flag: '🇮🇪' },
  { code: 'PT', dialCode: '+351', name: 'Portugal', flag: '🇵🇹' },
  { code: 'PL', dialCode: '+48', name: 'Poland', flag: '🇵🇱' },
  { code: 'AT', dialCode: '+43', name: 'Austria', flag: '🇦🇹' },
  { code: 'BE', dialCode: '+32', name: 'Belgium', flag: '🇧🇪' },
];

interface SlidingAuthProps {
  initialMode?: 'login' | 'signup';
}

function SlidingAuthForm({ initialMode = 'login' }: SlidingAuthProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') || '/inbox';
  const isUnassigned = searchParams.get('unassigned') === '1';
  const isSuspended = searchParams.get('suspended') === '1';
  const isExpired = searchParams.get('expired') === '1';
  const urlMessage = searchParams.get('message');
  const urlMode = searchParams.get('mode');

  const [mode, setMode] = useState<'login' | 'signup'>(
    urlMode === 'signup' || initialMode === 'signup' ? 'signup' : 'login'
  );

  // Sign In State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(
    isExpired
      ? 'Your account access has expired and been disabled. Please contact your platform administrator.'
      : isSuspended
      ? 'This workspace has been suspended. Please contact platform support.'
      : isUnassigned
      ? 'Your account is not assigned to any workspace yet. Please create a workspace or ask an administrator to invite you.'
      : urlMessage || null
  );

  // Sign Up State
  const [signupFullName, setSignupFullName] = useState('');
  const [signupCompanyName, setSignupCompanyName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupCountryCode, setSignupCountryCode] = useState('+977');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupSuccessMessage, setSignupSuccessMessage] = useState<string | null>(null);

  // Load remembered email on mount
  useEffect(() => {
    try {
      const savedRemember = localStorage.getItem('asstgpt_remember_me');
      const savedEmail = localStorage.getItem('asstgpt_remembered_email');
      if (savedRemember === 'true' && savedEmail) {
        setLoginEmail(savedEmail);
        setRememberMe(true);
      } else if (savedRemember === 'false') {
        setRememberMe(false);
      }
    } catch (_) {}
  }, []);

  // Sync mode if query param changes
  useEffect(() => {
    if (urlMode === 'signup') {
      setMode('signup');
    } else if (urlMode === 'login') {
      setMode('login');
    }
  }, [urlMode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);

    try {
      const cleanEmail = loginEmail.trim().toLowerCase();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: loginPassword,
      });

      if (authError) {
        throw authError;
      }

      if (data?.session) {
        try {
          if (rememberMe) {
            localStorage.setItem('asstgpt_remember_me', 'true');
            localStorage.setItem('asstgpt_remembered_email', cleanEmail);
          } else {
            localStorage.setItem('asstgpt_remember_me', 'false');
            localStorage.removeItem('asstgpt_remembered_email');
          }
        } catch (_) {}

        const cookieMaxAge = rememberMe ? 2592000 : 86400;
        document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=${cookieMaxAge}; SameSite=Lax; secure`;

        // 1. Check if user is platform super admin
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
        } catch (_) {}

        // 2. Check JWT tenant claim
        const userAppMeta = data.user?.app_metadata;
        const tenantId = userAppMeta?.tenant_id;
        if (tenantId) {
          router.push(redirectTo);
          return;
        }

        // 3. Auto-activate workspace if available
        try {
          const wsRes = await fetch('/api/tenant/switch', {
            headers: { Authorization: `Bearer ${data.session.access_token}` },
          });
          if (wsRes.ok) {
            const wsData = await wsRes.json();
            if (wsData?.workspaces && wsData.workspaces.length > 0) {
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

        // 4. Authenticated with no workspace -> switch to signup/workspace creation
        setLoginError('Your account is authenticated but not assigned to any workspace yet. Please create a new workspace using the Create Account tab.');
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setLoginError(err.message || 'Invalid email or password');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupLoading(true);
    setSignupError(null);
    setSignupSuccessMessage(null);

    const cleanPhone = signupPhone.trim();
    if (!cleanPhone) {
      setSignupError('WhatsApp / Contact mobile number is compulsory.');
      setSignupLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: signupFullName,
          companyName: signupCompanyName,
          email: signupEmail,
          countryCode: signupCountryCode,
          phone: cleanPhone,
          password: signupPassword,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create workspace');
      }

      if (data?.session) {
        document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=604800; SameSite=Lax; secure`;
        router.push('/inbox');
      } else {
        // Switch to login tab and prefill email
        setLoginEmail(signupEmail);
        setSignupSuccessMessage('Workspace created successfully! Please sign in with your credentials.');
        setMode('login');
      }
    } catch (err: any) {
      console.error('Signup error:', err);
      setSignupError(err.message || 'Failed to create workspace');
    } finally {
      setSignupLoading(false);
    }
  };

  return (
    <div className="w-full">
      {/* Sliding Segmented Tab Navigation */}
      <div className="relative grid grid-cols-2 p-1.5 bg-slate-950/80 border border-slate-800/90 rounded-2xl mb-6 select-none shadow-inner">
        {/* Animated Sliding Pill Highlight */}
        <div
          className={`absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] rounded-xl bg-gradient-to-r from-emerald-500/20 to-teal-500/15 border border-emerald-500/40 shadow-md shadow-emerald-500/10 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            mode === 'login' ? 'left-1.5' : 'left-[calc(50%+3px)]'
          }`}
        />
        <button
          type="button"
          onClick={() => setMode('login')}
          className={`relative z-10 py-2.5 text-xs font-semibold rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
            mode === 'login'
              ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.35)]'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Sign In</span>
        </button>
        <button
          type="button"
          onClick={() => setMode('signup')}
          className={`relative z-10 py-2.5 text-xs font-semibold rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
            mode === 'signup'
              ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.35)]'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Create Account</span>
        </button>
      </div>

      {/* Global Success / Notice Message */}
      {signupSuccessMessage && (
        <div className="mb-5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{signupSuccessMessage}</span>
        </div>
      )}

      {/* Sliding Form Container */}
      <div className="relative w-full">
        {/* ===================== SLIDE 1: SIGN IN (LOGIN) ===================== */}
        <div
          className={`w-full transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            mode === 'login'
              ? 'opacity-100 translate-x-0 pointer-events-auto relative z-10'
              : 'opacity-0 -translate-x-12 pointer-events-none absolute top-0 left-0 right-0 z-0'
          }`}
        >
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-5">
            <ShieldCheck className="w-4 h-4" /> Secure Workspace Sign In
          </div>

          {loginError && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-2.5 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="loginEmail" className="block text-xs font-medium text-slate-300 mb-1.5">
                Work Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="loginEmail"
                  name="email"
                  type="email"
                  required={mode === 'login'}
                  autoComplete="username email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label htmlFor="loginPassword" className="block text-xs font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="loginPassword"
                  name="password"
                  type={showLoginPassword ? 'text' : 'password'}
                  required={mode === 'login'}
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-10 pr-11 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 focus:outline-none transition-colors cursor-pointer"
                  title={showLoginPassword ? 'Hide password' : 'Show password'}
                  aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                >
                  {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

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
              disabled={loginLoading}
              className="w-full mt-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-semibold text-sm transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loginLoading ? (
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800/80 text-center">
            <p className="text-xs text-slate-400">
              Need to set up a new organization?{' '}
              <button
                type="button"
                onClick={() => setMode('signup')}
                className="text-emerald-400 hover:text-emerald-300 font-medium underline underline-offset-2 transition-colors cursor-pointer"
              >
                Create Workspace
              </button>
            </p>
          </div>
        </div>

        {/* ===================== SLIDE 2: SIGN UP (CREATE WORKSPACE) ===================== */}
        <div
          className={`w-full transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            mode === 'signup'
              ? 'opacity-100 translate-x-0 pointer-events-auto relative z-10'
              : 'opacity-0 translate-x-12 pointer-events-none absolute top-0 left-0 right-0 z-0'
          }`}
        >
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-5">
            <ShieldCheck className="w-4 h-4" /> Multi-Tenant Organization Setup
          </div>

          {signupError && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-2.5 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{signupError}</span>
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Your Full Name</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required={mode === 'signup'}
                  value={signupFullName}
                  onChange={(e) => setSignupFullName(e.target.value)}
                  placeholder="Sarah Jenkins"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Company / Workspace Name</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Building2 className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required={mode === 'signup'}
                  value={signupCompanyName}
                  onChange={(e) => setSignupCompanyName(e.target.value)}
                  placeholder="Acme International"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Work Email</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  required={mode === 'signup'}
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="sarah@acme.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
              </div>
            </div>

            {/* Compulsory WhatsApp / Contact Mobile Number with Country Code Dropdown */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  WhatsApp / Mobile Number <span className="text-emerald-400 font-bold">*</span>
                </span>
                <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  Compulsory
                </span>
              </label>
              <div className="flex gap-2">
                {/* Country Code Select */}
                <div className="relative w-36 shrink-0">
                  <select
                    value={signupCountryCode}
                    onChange={(e) => setSignupCountryCode(e.target.value)}
                    className="w-full h-[42px] pl-2.5 pr-7 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-white appearance-none focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors cursor-pointer"
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={`${c.code}-${c.dialCode}`} value={c.dialCode} className="bg-slate-900 text-white text-xs">
                        {c.flag} {c.code} ({c.dialCode})
                      </option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none text-slate-500">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* Phone Number Input */}
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Phone className="w-4 h-4 text-slate-500" />
                  </div>
                  <input
                    type="tel"
                    required={mode === 'signup'}
                    value={signupPhone}
                    onChange={(e) => setSignupPhone(e.target.value.replace(/[^0-9\s-]/g, ''))}
                    placeholder="98XXXXXXXX"
                    className="w-full h-[42px] pl-10 pr-4 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showSignupPassword ? 'text' : 'password'}
                  required={mode === 'signup'}
                  minLength={8}
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full pl-10 pr-11 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowSignupPassword(!showSignupPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 focus:outline-none transition-colors cursor-pointer"
                  title={showSignupPassword ? 'Hide password' : 'Show password'}
                  aria-label={showSignupPassword ? 'Hide password' : 'Show password'}
                >
                  {showSignupPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={signupLoading}
              className="w-full mt-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-semibold text-sm transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {signupLoading ? (
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Create Account & Workspace</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800/80 text-center">
            <p className="text-xs text-slate-400">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => setMode('login')}
                className="text-emerald-400 hover:text-emerald-300 font-medium underline underline-offset-2 transition-colors cursor-pointer"
              >
                Sign In
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SlidingAuthPage({ initialMode = 'login' }: SlidingAuthProps) {
  return (
    <div className="min-h-screen w-full bg-[#0a0f1d] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-emerald-500/30">
      {/* Dynamic ambient background luminous glow */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-500/10 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-blue-600/10 blur-[150px] pointer-events-none" />

      <div className="w-full max-w-md z-10">
        {/* Brand Header */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-[1px] shadow-lg shadow-emerald-500/20 mb-4">
            <div className="w-full h-full bg-[#0a0f1d] rounded-2xl flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-emerald-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">AsstGPT Platform</h1>
          <p className="text-sm text-slate-400 mt-1">Autonomous WhatsApp & Omnichannel AI Agent</p>
        </div>

        {/* Glassmorphic Sliding Auth Card */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-6 sm:p-7 shadow-2xl shadow-black/70">
          <Suspense fallback={<div className="py-12 text-center text-xs text-slate-500">Loading authentication...</div>}>
            <SlidingAuthForm initialMode={initialMode} />
          </Suspense>
        </div>

        {/* Footer info */}
        <p className="text-center text-[11px] text-slate-600 mt-6">
          Protected by End-to-End Database Isolation & RBAC Security
        </p>
      </div>
    </div>
  );
}
