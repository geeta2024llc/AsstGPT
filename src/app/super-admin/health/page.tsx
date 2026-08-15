'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

interface Health {
  database: { reachable: boolean };
  whatsapp: { connected: number; disconnected: number };
  outboundQueue: { pending: number; failed: number };
  aiProviders: Record<string, boolean>;
  serverUptimeSeconds: number;
  checkedAt: string;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function HealthPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/super-admin/health')
      .then((r) => r.json())
      .then(setHealth)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !health) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-headline">System Health</h1>
        <p className="text-sm text-muted-foreground">Checked {new Date(health.checkedAt).toLocaleString()} &middot; server uptime {formatUptime(health.serverUptimeSeconds)}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Database</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            {health.database.reachable ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <XCircle className="h-5 w-5 text-destructive" />}
            <span>{health.database.reachable ? 'Reachable' : 'Unreachable'}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">WhatsApp Channels</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>Connected: <span className="font-medium">{health.whatsapp.connected}</span></div>
            <div>Disconnected: <span className="font-medium">{health.whatsapp.disconnected}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Outbound Queue</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>Pending: <span className="font-medium">{health.outboundQueue.pending}</span></div>
            <div>Failed: <span className="font-medium">{health.outboundQueue.failed}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">AI Providers Configured</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Object.entries(health.aiProviders).map(([provider, configured]) => (
              <Badge key={provider} variant={configured ? 'secondary' : 'outline'} className="capitalize">
                {provider}: {configured ? 'Configured' : 'Missing key'}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
