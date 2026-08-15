'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Building2, MessageSquare, Cpu, AlertTriangle } from 'lucide-react';

interface Overview {
  tenants: { total: number; active: number };
  signups: { today: number; week: number; month: number };
  whatsapp: { connected: number; total: number };
  messages: { total: number };
  ai: { requests30d: number; failures30d: number; failureRatePct: number };
  recentAuditLogs: Array<{ id: string; actor_email: string; action: string; target_type: string; target_id: string; result: string; created_at: string }>;
}

export default function SuperAdminDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/super-admin/overview')
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const tiles = [
    { label: 'Tenants', value: data.tenants.total, sub: `${data.tenants.active} active`, icon: Building2 },
    { label: 'New Signups (30d)', value: data.signups.month, sub: `${data.signups.today} today`, icon: Building2 },
    { label: 'WhatsApp Connected', value: data.whatsapp.connected, sub: `of ${data.whatsapp.total} channels`, icon: MessageSquare },
    { label: 'Total Messages', value: data.messages.total.toLocaleString(), sub: 'all time', icon: MessageSquare },
    { label: 'AI Requests (30d)', value: data.ai.requests30d, sub: `${data.ai.failures30d} failures`, icon: Cpu },
    { label: 'AI Failure Rate', value: `${data.ai.failureRatePct}%`, sub: 'last 30 days', icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-headline">Super Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">Platform-wide overview across every tenant.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
              <t.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{t.value}</div>
              <p className="text-xs text-muted-foreground">{t.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Platform Activity</CardTitle>
          <Link href="/super-admin/audit-logs" className="text-xs text-primary hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.recentAuditLogs.length === 0 && <p className="text-sm text-muted-foreground">No admin actions recorded yet.</p>}
          {data.recentAuditLogs.map((log) => (
            <div key={log.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
              <div>
                <span className="font-medium">{log.actor_email}</span>
                <span className="text-muted-foreground"> &middot; {log.action}</span>
                {log.target_id && <span className="text-muted-foreground"> &middot; {log.target_type} {log.target_id.slice(0, 8)}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={log.result === 'success' ? 'secondary' : 'destructive'}>{log.result}</Badge>
                <span className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
