'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, ArrowLeft, ShieldOff, ShieldCheck, UserCog, Trash2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { startImpersonation } from '@/lib/impersonation-client';

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  plan: string;
  is_active: boolean;
  suspended_reason?: string;
  created_at: string;
  memberCount: number;
  agentCount: number;
  messageCount: number;
  channels: Array<{ id: string; status: string; display_name: string }>;
  aiUsage: { totalRequests: number; totalEstimatedCostUsd: number; failures: number };
  members: Array<{ userId: string; role: string; email?: string; fullName?: string; joinedAt: string }>;
}

export default function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const fetchOrg = async () => {
    const res = await fetch(`/api/super-admin/organizations/${id}`);
    if (res.ok) setOrg(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    fetchOrg();
  }, [id]);

  const handleSuspendToggle = async () => {
    if (!org) return;
    const action = org.is_active ? 'suspend' : 'reactivate';
    if (action === 'suspend' && !confirm(`Suspend "${org.name}"? All its members will immediately lose access.`)) return;

    setBusy(true);
    try {
      const reason = action === 'suspend' ? prompt('Reason for suspension (optional):') || undefined : undefined;
      const res = await fetch(`/api/super-admin/organizations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      if (!res.ok) throw new Error('Failed to update organization');
      await fetchOrg();
      toast({ title: action === 'suspend' ? 'Organization suspended' : 'Organization reactivated' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!org || deleteConfirmText !== org.slug) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/super-admin/organizations/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: deleteConfirmText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete organization');

      toast({ title: 'Organization Deleted', description: `"${org.name}" and all its data have been permanently removed.` });
      router.push('/super-admin/organizations');
    } catch (err) {
      toast({ variant: 'destructive', title: 'Delete Failed', description: (err as Error).message });
      setDeleting(false);
    }
  };

  const handleImpersonate = async (userId: string, email?: string) => {
    if (!confirm(`Impersonate ${email || userId}? You will be signed in as this user and the action will be audit-logged.`)) return;
    setBusy(true);
    try {
      await startImpersonation(userId);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Impersonation failed', description: (err as Error).message });
      setBusy(false);
    }
  };

  if (loading || !org) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/super-admin/organizations" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Organizations
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-headline flex items-center gap-2">
            {org.name}
            <Badge variant={org.is_active ? 'secondary' : 'destructive'}>{org.is_active ? 'Active' : 'Suspended'}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {org.slug} &middot; {org.plan} plan &middot; created {new Date(org.created_at).toLocaleDateString()}
          </p>
          {!org.is_active && org.suspended_reason && (
            <p className="text-sm text-destructive mt-1">Suspended: {org.suspended_reason}</p>
          )}
        </div>
        <Button variant={org.is_active ? 'destructive' : 'default'} onClick={handleSuspendToggle} disabled={busy} className="gap-1.5">
          {org.is_active ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          {org.is_active ? 'Suspend' : 'Reactivate'}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Members', value: org.memberCount },
          { label: 'Agents', value: org.agentCount },
          { label: 'Messages', value: org.messageCount.toLocaleString() },
          { label: 'AI Cost (all-time)', value: `$${org.aiUsage.totalEstimatedCostUsd.toFixed(2)}` },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>WhatsApp Channels</CardTitle>
        </CardHeader>
        <CardContent>
          {org.channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">No WhatsApp channels configured.</p>
          ) : (
            <div className="space-y-2">
              {org.channels.map((c) => (
                <div key={c.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
                  <span>{c.display_name}</span>
                  <Badge variant={c.status === 'connected' ? 'secondary' : 'outline'} className="capitalize">
                    {c.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>{m.fullName || '—'}</TableCell>
                  <TableCell>{m.email}</TableCell>
                  <TableCell className="capitalize">{m.role}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => handleImpersonate(m.userId, m.email)}>
                      <UserCog className="h-3.5 w-3.5" />
                      Impersonate
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {org.members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No members yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span>Danger Zone</span>
          </CardTitle>
          <CardDescription>
            Permanently deletes this workspace and everything in it: members, conversations, messages, agents,
            channels, invitations, webhooks, and usage history. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            className="gap-1.5"
            onClick={() => {
              setDeleteConfirmText('');
              setDeleteDialogOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete Organization
          </Button>
        </CardContent>
      </Card>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete "{org.name}"?</DialogTitle>
            <DialogDescription>
              This permanently deletes the workspace and all its data. To confirm, type the workspace slug{' '}
              <span className="font-mono font-semibold text-foreground">{org.slug}</span> below.
            </DialogDescription>
          </DialogHeader>

          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={org.slug}
            autoFocus
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting || deleteConfirmText !== org.slug}
              onClick={handleDelete}
              className="gap-1.5"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Permanently Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
