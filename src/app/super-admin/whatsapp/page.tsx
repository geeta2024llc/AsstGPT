'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ConfirmDeleteDialog from '@/components/confirm-delete-dialog';

interface WhatsappData {
  liveConnection: {
    status: string;
    account: any;
    lastDisconnect: any;
    leaderHolderId: string | null;
    leaseExpiresAt: string | null;
    updatedAt: string | null;
  };
  tenantChannels: Array<{ id: string; tenantId: string; tenantName?: string; status: string; displayName: string; updatedAt: string }>;
  tenantChannelsTotal: number;
  page: number;
  pageSize: number;
  outboundQueuePending: number;
}

export default function WhatsappMonitorPage() {
  const [data, setData] = useState<WhatsappData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [page, setPage] = useState(1);
  const { toast } = useToast();

  const fetchData = async (p = page) => {
    setTableLoading(true);
    const res = await fetch(`/api/super-admin/whatsapp?page=${p}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
    setTableLoading(false);
  };

  useEffect(() => {
    fetchData(1);
  }, []);

  const goToPage = (p: number) => {
    setPage(p);
    fetchData(p);
  };

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const executeReset = async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/super-admin/whatsapp/default/reset', { method: 'POST' });
      if (!res.ok) throw new Error('Reset failed');
      await fetchData();
      toast({ title: 'WhatsApp session reset', description: 'A fresh QR pairing will be required.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    } finally {
      setResetting(false);
      setConfirmResetOpen(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-headline">WhatsApp Connections</h1>
        <p className="text-sm text-muted-foreground">The platform currently runs one shared WhatsApp session per deployment.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Live Connection</CardTitle>
            <CardDescription>Leader-elected shared session (src/lib/whatsapp-leader.ts)</CardDescription>
          </div>
          <Button variant="destructive" size="sm" className="gap-1.5 cursor-pointer" disabled={resetting} onClick={() => setConfirmResetOpen(true)}>
            <RotateCcw className="h-3.5 w-3.5" />
            Force Reset
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Status</div>
            <Badge variant={data.liveConnection.status === 'connected' ? 'secondary' : 'outline'} className="capitalize mt-1">
              {data.liveConnection.status}
            </Badge>
          </div>
          <div>
            <div className="text-muted-foreground">Current Leader</div>
            <div className="font-medium">{data.liveConnection.leaderHolderId || '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Lease Expires</div>
            <div className="font-medium">{data.liveConnection.leaseExpiresAt ? new Date(data.liveConnection.leaseExpiresAt).toLocaleTimeString() : '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Outbound Queue (pending)</div>
            <div className="font-medium">{data.outboundQueuePending}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenant Channels</CardTitle>
          <CardDescription>Per-tenant channel records (configured status, not necessarily live).</CardDescription>
        </CardHeader>
        <CardContent>
          {tableLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.tenantChannels.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.tenantName || c.tenantId.slice(0, 8)}</TableCell>
                      <TableCell>{c.displayName}</TableCell>
                      <TableCell>
                        <Badge variant={c.status === 'connected' ? 'secondary' : 'outline'} className="capitalize">
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{new Date(c.updatedAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {data.tenantChannels.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No WhatsApp channels configured.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between pt-4">
                <span className="text-xs text-muted-foreground">
                  Page {data.page} of {Math.max(1, Math.ceil(data.tenantChannelsTotal / data.pageSize))} &middot; {data.tenantChannelsTotal} total
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= Math.ceil(data.tenantChannelsTotal / data.pageSize)}
                    onClick={() => goToPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Confirm WhatsApp Session Reset Dialog */}
      <ConfirmDeleteDialog
        isOpen={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        title="Force-Reset WhatsApp Session?"
        description="Are you sure you want to force-reset the shared WhatsApp connection? This logs it out and clears the authentication credentials. A fresh QR scan will immediately be required to reconnect."
        confirmLabel="Yes, Reset Session"
        cancelLabel="No, Cancel"
        onConfirm={executeReset}
      />
    </div>
  );
}
