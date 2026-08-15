'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SuperAdminLoginPage() {
  const router = useRouter();

  useEffect(() => {
    // Single unified login portal: redirect to /login
    router.replace('/login');
  }, [router]);

  return (
    <div className="min-h-screen w-full bg-[#0a0f1d] flex items-center justify-center p-4">
      <div className="text-slate-400 text-sm flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
        <span>Redirecting to secure login...</span>
      </div>
    </div>
  );
}
