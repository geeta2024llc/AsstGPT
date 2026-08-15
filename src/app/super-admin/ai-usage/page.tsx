'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2 } from 'lucide-react';

interface UsageRow {
  tenantId: string | null;
  tenantName?: string;
  provider: string;
  requests: number;
  failures: number;
  failureRatePct: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  avgLatencyMs: number;
}

export default function AIUsagePage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/super-admin/ai-usage?days=30')
      .then((r) => r.json())
      .then((d) => setRows(d.rows || []))
      .finally(() => setLoading(false));
  }, []);

  const totalCost = rows.reduce((s, r) => s + r.estimatedCostUsd, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-headline">AI Usage & Cost</h1>
        <p className="text-sm text-muted-foreground">Last 30 days, per tenant and provider. Costs are approximate estimates, not billing-grade.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>${totalCost.toFixed(2)} estimated spend</CardTitle>
          <CardDescription>Across {rows.length} tenant/provider combinations</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Requests</TableHead>
                  <TableHead>Failure Rate</TableHead>
                  <TableHead>Tokens (in/out)</TableHead>
                  <TableHead>Avg Latency</TableHead>
                  <TableHead className="text-right">Est. Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.tenantId}-${r.provider}`}>
                    <TableCell>{r.tenantName || r.tenantId?.slice(0, 8) || 'Unknown'}</TableCell>
                    <TableCell className="capitalize">{r.provider}</TableCell>
                    <TableCell>{r.requests}</TableCell>
                    <TableCell>{r.failureRatePct}%</TableCell>
                    <TableCell>
                      {r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}
                    </TableCell>
                    <TableCell>{r.avgLatencyMs}ms</TableCell>
                    <TableCell className="text-right font-medium">${r.estimatedCostUsd.toFixed(4)}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No AI usage recorded in this window yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
