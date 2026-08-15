'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function AgentsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/knowledge-base?tab=personality');
  }, [router]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm font-medium">Opening AI Personality...</p>
    </div>
  );
}
