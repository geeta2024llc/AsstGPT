'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search } from 'lucide-react';

interface AuditLog {
  id: string;
  actor_email: string;
  action: string;
  target_type?: string;
  target_id?: string;
  tenant_id?: string;
  result: string;
  created_at: string;
}

export default function AuditLogsPage() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actorFilter, setActorFilter] = useState('');

  const fetchLogs = async (p = page, actor = actorFilter) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p) });
    if (actor) params.set('actor', actor);
    const res = await fetch(`/api/super-admin/audit-logs?${params}`);
    const data = await res.json();
    setRows(data.rows || []);
    setTotal(data.total || 0);
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs(1, '');
  }, []);

  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-headline">Platform Audit Logs</h1>
        <p className="text-sm text-muted-foreground">Every privileged super-admin action, append-only.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by actor email..."
              className="pl-8"
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchLogs(1, actorFilter)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>{log.actor_email}</TableCell>
                      <TableCell className="font-mono text-xs">{log.action}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {log.target_type ? `${log.target_type} ${log.target_id?.slice(0, 8) || ''}` : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={log.result === 'success' ? 'secondary' : 'destructive'}>{log.result}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{new Date(log.created_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No audit log entries yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between pt-4">
                <span className="text-xs text-muted-foreground">
                  Page {page} of {totalPages} &middot; {total} total
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => { const p = page - 1; setPage(p); fetchLogs(p); }}>
                    Previous
                  </Button>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => { const p = page + 1; setPage(p); fetchLogs(p); }}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
