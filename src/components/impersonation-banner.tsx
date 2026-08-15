'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getActiveImpersonation, stopImpersonation, type ImpersonationState } from '@/lib/impersonation-client';

export default function ImpersonationBanner() {
  const [state, setState] = useState<ImpersonationState | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    setState(getActiveImpersonation());
  }, []);

  if (!state) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4" />
        <span>
          Super Admin Mode &mdash; viewing as <strong>{state.tenantName || state.targetEmail}</strong>
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 border-amber-950/30 bg-amber-500 text-amber-950 hover:bg-amber-400"
        disabled={exiting}
        onClick={async () => {
          setExiting(true);
          await stopImpersonation();
        }}
      >
        <LogOut className="h-3.5 w-3.5" />
        <span>Exit</span>
      </Button>
    </div>
  );
}
