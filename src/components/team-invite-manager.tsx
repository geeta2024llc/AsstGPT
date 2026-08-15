'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Mail, Send, Loader2, Copy, Check, Trash2, Clock, ShieldCheck, XCircle } from 'lucide-react';
import ConfirmDeleteDialog from '@/components/confirm-delete-dialog';
import { useToast } from '@/hooks/use-toast';
import type { InvitationRole, TenantInvitation } from '@/types';

const ROLE_LABELS: Record<InvitationRole, string> = {
  admin: 'Admin (Full Access)',
  operator: 'Operator (Inbox & CRM)',
  viewer: 'Viewer (Read-Only)',
};

const STATUS_BADGE: Record<string, { label: string; className: string; icon: any }> = {
  pending: { label: 'Pending', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', icon: Clock },
  accepted: { label: 'Accepted', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', icon: ShieldCheck },
  revoked: { label: 'Revoked', className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20', icon: XCircle },
  expired: { label: 'Expired', className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20', icon: XCircle },
};

export default function TeamInviteManager() {
  const [invitations, setInvitations] = useState<TenantInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitationRole>('operator');
  const [isSending, setIsSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { toast } = useToast();

  const fetchInvitations = async () => {
    try {
      const res = await fetch('/api/team/invitations');
      if (!res.ok) throw new Error('Failed to load invitations');
      setInvitations(await res.json());
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInvitations();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSending(true);
    try {
      const res = await fetch('/api/team/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to send invitation');

      setEmail('');
      await fetchInvitations();

      if (data.inviteUrl) {
        await navigator.clipboard.writeText(data.inviteUrl).catch(() => {});
        toast({
          title: 'Invitation Created',
          description: `Link for ${data.email} copied to clipboard. Share it with them to grant access.`,
        });
      } else {
        toast({ title: 'Invitation Created' });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Invite Failed', description: (err as Error).message });
    } finally {
      setIsSending(false);
    }
  };

  const [inviteToRevoke, setInviteToRevoke] = useState<{ id: string; email: string } | null>(null);

  const confirmRevokeInvite = async () => {
    if (!inviteToRevoke) return;
    try {
      const res = await fetch(`/api/team/invitations/${inviteToRevoke.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to revoke invitation');
      await fetchInvitations();
      toast({ title: 'Invitation Revoked', description: `Pending invitation for "${inviteToRevoke.email}" was revoked.` });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    } finally {
      setInviteToRevoke(null);
    }
  };

  const copyLink = async (inv: TenantInvitation) => {
    if (!inv.inviteUrl) return;
    await navigator.clipboard.writeText(inv.inviteUrl);
    setCopiedId(inv.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Mail className="h-5 w-5 text-primary" />
          <span>Invite Teammates</span>
        </CardTitle>
        <CardDescription>
          Invitations grant real login access to this workspace (unlike the roster below). The invitee sets their own password when they accept.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-2 items-end">
          <div className="flex-1 w-full space-y-1.5">
            <Label htmlFor="invite-email">Email Address</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
            />
          </div>
          <div className="w-full sm:w-48 space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v: InvitationRole) => setRole(v)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="operator">Operator</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={isSending} className="gap-1.5 shrink-0">
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span>Send Invite</span>
          </Button>
        </form>

        <div className="space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No invitations sent yet.</p>
          ) : (
            invitations.map((inv) => {
              const statusCfg = STATUS_BADGE[inv.status] || STATUS_BADGE.pending;
              const StatusIcon = statusCfg.icon;
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border bg-muted/30"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">{ROLE_LABELS[inv.role]}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${statusCfg.className}`}>
                      <StatusIcon className="h-3 w-3" />
                      <span>{statusCfg.label}</span>
                    </span>
                    {inv.inviteUrl && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyLink(inv)} title="Copy invite link">
                        {copiedId === inv.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                    {inv.status === 'pending' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive cursor-pointer"
                        onClick={() => setInviteToRevoke({ id: inv.id, email: inv.email })}
                        title="Revoke invitation"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>

      {/* Confirm Revoke Invite Dialog */}
      <ConfirmDeleteDialog
        isOpen={!!inviteToRevoke}
        onOpenChange={(open) => !open && setInviteToRevoke(null)}
        title="Revoke Workspace Invitation?"
        itemName={inviteToRevoke?.email}
        itemType="invitation"
        description={
          inviteToRevoke ? (
            <>
              Are you sure you want to revoke the pending invitation for{' '}
              <span className="font-semibold text-foreground">"{inviteToRevoke.email}"</span>? The invite link will
              be invalidated immediately.
            </>
          ) : undefined
        }
        confirmLabel="Yes, Revoke"
        cancelLabel="No, Cancel"
        onConfirm={confirmRevokeInvite}
      />
    </Card>
  );
}
