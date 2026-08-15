'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Users,
  Shield,
  Trash2,
  Edit2,
  Check,
  Loader2,
  Layers,
  Crown,
  UserCheck,
  Eye,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { TeamMember, UserRole, UserStatus } from '@/types';

const ROLE_CONFIG: Record<UserRole, { label: string; badgeClass: string; icon: any }> = {
  owner: {
    label: 'Owner (Full Access)',
    badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-bold',
    icon: Crown,
  },
  admin: {
    label: 'Admin (Full Access)',
    badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 font-semibold',
    icon: Shield,
  },
  operator: {
    label: 'Operator (Inbox & CRM)',
    badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 font-medium',
    icon: UserCheck,
  },
  viewer: {
    label: 'Viewer (Read-Only)',
    badgeClass: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20 font-normal',
    icon: Eye,
  },
};

const STATUS_CONFIG: Record<UserStatus, { label: string; dotClass: string }> = {
  online: { label: 'Online', dotClass: 'bg-emerald-500 animate-pulse' },
  away: { label: 'Away', dotClass: 'bg-amber-500' },
  offline: { label: 'Offline', dotClass: 'bg-slate-400' },
};

export default function TeamRBACManager() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);

  const { toast } = useToast();

  const [formData, setFormData] = useState({
    role: 'operator' as UserRole,
    status: 'online' as UserStatus,
    assignedQueues: 'general, support',
  });

  const fetchMembers = async () => {
    try {
      const res = await fetch('/api/team');
      if (!res.ok) throw new Error('Failed to load team members');
      const data = await res.json();
      setMembers(data);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const handleOpenEdit = (m: TeamMember) => {
    setEditingMember(m);
    setFormData({
      role: m.role,
      status: m.status || 'online',
      assignedQueues: (m.assignedQueues || []).join(', '),
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editingMember) return;

    setIsSaving(true);
    try {
      const queues = formData.assignedQueues
        .split(',')
        .map(q => q.trim())
        .filter(Boolean);

      const res = await fetch(`/api/team/${editingMember.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: formData.role,
          status: formData.status,
          assignedQueues: queues,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to save member');
      }

      toast({
        title: 'Member Updated',
        description: `${editingMember.fullName}'s access was updated.`,
      });

      setIsDialogOpen(false);
      fetchMembers();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save Failed', description: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}" from this workspace? They will immediately lose access.`)) return;

    try {
      const res = await fetch(`/api/team/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to remove member');
      }
      setMembers(prev => prev.filter(m => m.id !== id));
      toast({ title: 'Member Removed' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold font-headline flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <span>Workspace Members</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Everyone with real login access to this workspace, and their role, availability, and queue assignments.
          New members join via an invitation above.
        </p>
      </div>

      {/* Member Cards List */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No workspace members yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((m) => {
            const roleCfg = ROLE_CONFIG[m.role] || ROLE_CONFIG.operator;
            const statusCfg = STATUS_CONFIG[m.status || 'online'] || STATUS_CONFIG.online;
            const Icon = roleCfg.icon;
            const isOwner = m.role === 'owner';

            return (
              <Card key={m.id} className="transition-all hover:shadow-sm">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative shrink-0">
                        <Avatar className="h-10 w-10 border">
                          <AvatarImage src={m.avatarUrl} alt={m.fullName} />
                          <AvatarFallback>{m.fullName.charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-background ${statusCfg.dotClass}`}
                          title={`Status: ${statusCfg.label}`}
                        />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-semibold text-sm truncate">{m.fullName}</h4>
                        <p className="text-xs text-muted-foreground truncate">{m.email || 'No email on file'}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEdit(m)}
                        disabled={isOwner}
                        className="h-7 w-7"
                        title={isOwner ? "The workspace owner's role can't be changed here" : 'Edit member'}
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(m.id, m.fullName)}
                        disabled={isOwner}
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title={isOwner ? 'The workspace owner cannot be removed' : 'Remove member'}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-4 pt-2 space-y-3">
                  <div className="flex items-center justify-between gap-2 pt-1 border-t">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${roleCfg.badgeClass}`}>
                      <Icon className="h-3 w-3" />
                      <span>{roleCfg.label.split(' ')[0]}</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground capitalize">
                      {statusCfg.label}
                    </span>
                  </div>

                  {/* Assigned Queues */}
                  {m.assignedQueues && m.assignedQueues.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Layers className="h-3 w-3" />
                        <span>Queues:</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {m.assignedQueues.map(q => (
                          <Badge key={q} variant="secondary" className="text-[10px] font-normal bg-muted">
                            {q}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {editingMember?.fullName}</DialogTitle>
            <DialogDescription>
              Set role permissions, availability status, and queue responsibilities.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="member-role">Access Role</Label>
                <Select
                  value={formData.role}
                  onValueChange={(val: UserRole) => setFormData(p => ({ ...p, role: val }))}
                >
                  <SelectTrigger id="member-role">
                    <SelectValue placeholder="Select Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin (Full Access)</SelectItem>
                    <SelectItem value="operator">Operator (Inbox & CRM)</SelectItem>
                    <SelectItem value="viewer">Viewer (Read-Only)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="member-status">Availability</Label>
                <Select
                  value={formData.status}
                  onValueChange={(val: UserStatus) => setFormData(p => ({ ...p, status: val }))}
                >
                  <SelectTrigger id="member-status">
                    <SelectValue placeholder="Select Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="away">Away</SelectItem>
                    <SelectItem value="offline">Offline</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="member-queues">Assigned Queues (Comma separated)</Label>
              <Input
                id="member-queues"
                value={formData.assignedQueues}
                onChange={(e) => setFormData(p => ({ ...p, assignedQueues: e.target.value }))}
                placeholder="billing, technical, vip, general"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="gap-1.5">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              <span>Save Changes</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
