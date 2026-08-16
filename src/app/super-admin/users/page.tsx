'use client';

import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Loader2,
  Search,
  Ban,
  ShieldCheck,
  UserPlus,
  MoreHorizontal,
  Edit2,
  Trash2,
  KeyRound,
  Building2,
  Users,
  ShieldAlert,
  RefreshCw,
  Eye,
  EyeOff,
  Sparkles,
  CalendarClock,
  Clock,
  Calendar,
  AlertTriangle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ConfirmDeleteDialog from '@/components/confirm-delete-dialog';

interface Membership {
  tenantId: string;
  role: string;
  tenantName?: string;
  tenantSlug?: string;
}

interface PlatformUser {
  id: string;
  email: string;
  fullName?: string;
  createdAt: string;
  lastSignInAt?: string;
  isBanned: boolean;
  bannedUntil?: string | null;
  expiresAt?: string | null;
  isExpired?: boolean;
  primaryRole: string;
  memberships: Membership[];
}

interface Organization {
  id: string;
  name: string;
  slug: string;
}

function generateSecurePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  let pwd = 'Ad-';
  for (let i = 0; i < 12; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

export default function UsersManagementPage() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Form states - Create
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newTenantId, setNewTenantId] = useState('');
  const [newRole, setNewRole] = useState('admin');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Form states - Edit
  const [selectedUser, setSelectedUser] = useState<PlatformUser | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('admin');
  const [editTenantId, setEditTenantId] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);

  // Delete state
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Expiry state
  const [expiryDialogOpen, setExpiryDialogOpen] = useState(false);
  const [userForExpiry, setUserForExpiry] = useState<PlatformUser | null>(null);
  const [customExpiryDate, setCustomExpiryDate] = useState('');
  const [expirySubmitting, setExpirySubmitting] = useState(false);

  const openExpiryDialog = (user: PlatformUser) => {
    setUserForExpiry(user);
    if (user.expiresAt) {
      const d = new Date(user.expiresAt);
      const isoLocal = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setCustomExpiryDate(isoLocal);
    } else {
      // Default custom input to 30 days from now
      const d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const isoLocal = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setCustomExpiryDate(isoLocal);
    }
    setExpiryDialogOpen(true);
  };

  const handleApplyPreset = (days: number) => {
    const targetDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const isoLocal = new Date(targetDate.getTime() - targetDate.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setCustomExpiryDate(isoLocal);
  };

  const handleSaveExpiry = async (overrideExpiresAt?: string | null) => {
    if (!userForExpiry) return;
    setExpirySubmitting(true);
    try {
      const expiresAtValue = overrideExpiresAt !== undefined
        ? overrideExpiresAt
        : (customExpiryDate ? new Date(customExpiryDate).toISOString() : null);

      const res = await fetch(`/api/super-admin/users/${userForExpiry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_expiry',
          expiresAt: expiresAtValue,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update expiry date');
      }

      await fetchUsers();
      toast({
        title: expiresAtValue ? 'Account Expiry Updated' : 'Expiry Timer Removed',
        description: expiresAtValue
          ? `Account for ${userForExpiry.email} will expire on ${new Date(expiresAtValue).toLocaleString()}`
          : `Permanent access restored for ${userForExpiry.email}`,
      });
      setExpiryDialogOpen(false);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'Failed to save expiry settings',
      });
    } finally {
      setExpirySubmitting(false);
    }
  };

  const { toast } = useToast();

  const fetchOrganizations = async () => {
    try {
      const res = await fetch('/api/super-admin/organizations');
      if (res.ok) {
        const data = await res.json();
        setOrganizations(data || []);
      }
    } catch (e) {
      console.error('Failed to load organizations', e);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (roleFilter !== 'all') params.set('role', roleFilter);

      const res = await fetch(`/api/super-admin/users?${params.toString()}`);
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to fetch users' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchOrganizations();
  }, []);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (statusFilter === 'active' && u.isBanned) return false;
      if (statusFilter === 'disabled' && !u.isBanned) return false;
      if (roleFilter === 'admin' && u.primaryRole !== 'admin' && u.primaryRole !== 'owner') return false;
      if (roleFilter === 'operator' && u.primaryRole !== 'operator') return false;
      return true;
    });
  }, [users, statusFilter, roleFilter]);

  // Metrics summary
  const totalAdmins = useMemo(() => users.filter((u) => u.primaryRole === 'admin' || u.primaryRole === 'owner').length, [users]);
  const activeCount = useMemo(() => users.filter((u) => !u.isBanned).length, [users]);
  const disabledCount = useMemo(() => users.filter((u) => u.isBanned).length, [users]);

  // Toggle Ban / Unban
  const [userToBan, setUserToBan] = useState<PlatformUser | null>(null);

  const handleToggleBan = async (user: PlatformUser) => {
    if (!user.isBanned) {
      setUserToBan(user);
      return;
    }
    await executeToggleBan(user, 'unban');
  };

  const executeToggleBan = async (user: PlatformUser, action: 'ban' | 'unban') => {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/super-admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update user status');
      }
      await fetchUsers();
      toast({
        title: action === 'ban' ? 'Admin Access Disabled' : 'Admin Access Re-enabled',
        description: `${user.email} is now ${action === 'ban' ? 'suspended' : 'active'}.`,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setBusyId(null);
      setUserToBan(null);
    }
  };

  // Open Create Modal
  const handleOpenCreate = () => {
    setNewEmail('');
    setNewPassword(generateSecurePassword());
    setNewFullName('');
    setNewTenantId(organizations[0]?.id || '');
    setNewRole('admin');
    setCreateDialogOpen(true);
  };

  // Submit Create
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newPassword || !newTenantId) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Please fill in all required fields' });
      return;
    }

    setCreateSubmitting(true);
    try {
      const res = await fetch('/api/super-admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          fullName: newFullName,
          tenantId: newTenantId,
          role: newRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create admin user');
      }

      toast({
        title: 'Admin Created Successfully',
        description: `Created ${newEmail} as ${newRole} in ${data.tenantName || 'workspace'}.`,
      });
      setCreateDialogOpen(false);
      await fetchUsers();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Creation Failed', description: err.message });
    } finally {
      setCreateSubmitting(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (user: PlatformUser) => {
    setSelectedUser(user);
    setEditEmail(user.email);
    setEditFullName(user.fullName || '');
    setEditRole(user.memberships[0]?.role || user.primaryRole || 'admin');
    setEditTenantId(user.memberships[0]?.tenantId || organizations[0]?.id || '');
    setEditPassword('');
    setEditDialogOpen(true);
  };

  // Submit Edit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setEditSubmitting(true);
    try {
      const payload: any = {
        action: 'update',
        fullName: editFullName,
        role: editRole,
        tenantId: editTenantId,
      };

      if (editEmail && editEmail !== selectedUser.email) {
        payload.email = editEmail;
      }
      if (editPassword.trim()) {
        if (editPassword.trim().length < 8) {
          throw new Error('New password must be at least 8 characters long');
        }
        payload.password = editPassword.trim();
      }

      const res = await fetch(`/api/super-admin/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update user');
      }

      toast({
        title: 'Admin Updated',
        description: `Successfully updated settings for ${selectedUser.email}.`,
      });
      setEditDialogOpen(false);
      await fetchUsers();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Update Failed', description: err.message });
    } finally {
      setEditSubmitting(false);
    }
  };

  // Open Delete Modal
  const handleOpenDelete = (user: PlatformUser) => {
    setSelectedUser(user);
    setDeleteConfirmEmail('');
    setDeleteDialogOpen(true);
  };

  // Submit Delete
  const handleDeleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    if (deleteConfirmEmail.trim().toLowerCase() !== selectedUser.email.toLowerCase()) {
      toast({ variant: 'destructive', title: 'Verification Failed', description: 'Email confirmation does not match.' });
      return;
    }

    setDeleteSubmitting(true);
    try {
      const res = await fetch(`/api/super-admin/users/${selectedUser.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete user');
      }

      toast({
        title: 'Admin User Deleted',
        description: `Permanently removed account for ${selectedUser.email}.`,
      });
      setDeleteDialogOpen(false);
      await fetchUsers();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Deletion Failed', description: err.message });
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-headline tracking-tight">Admin & User Management</h1>
          <p className="text-sm text-muted-foreground">
            Create, edit, provision, and enable or disable workspace administrators across all organizations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchUsers}
            disabled={loading}
            className="gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>
          <Button
            onClick={handleOpenCreate}
            size="sm"
            className="gap-2 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-bold shadow-lg shadow-amber-500/20 cursor-pointer"
          >
            <UserPlus className="h-4 w-4" />
            <span>Create New Admin</span>
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.length}</div>
            <p className="text-xs text-muted-foreground">Platform-wide accounts</p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workspace Admins</CardTitle>
            <ShieldCheck className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-500">{totalAdmins}</div>
            <p className="text-xs text-muted-foreground">Admins & Owners</p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Accounts</CardTitle>
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">{activeCount}</div>
            <p className="text-xs text-muted-foreground">Enabled for sign-in</p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Disabled Accounts</CardTitle>
            <Ban className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-500">{disabledCount}</div>
            <p className="text-xs text-muted-foreground">Suspended / Inactive</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by email, name, or workspace..."
                className="pl-9 bg-background/80"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchUsers()}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="w-36">
                <Select value={roleFilter} onValueChange={(val) => setRoleFilter(val)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    <SelectItem value="super_admin">Super Admins</SelectItem>
                    <SelectItem value="admin">Admins Only</SelectItem>
                    <SelectItem value="operator">Operators</SelectItem>
                    <SelectItem value="owner">Owners</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="w-36">
                <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="active">Active Only</SelectItem>
                    <SelectItem value="disabled">Disabled Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center p-16 space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              <span className="text-xs text-muted-foreground">Loading admin accounts...</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead className="font-semibold text-xs">Admin / User</TableHead>
                    <TableHead className="font-semibold text-xs">Organization / Workspace</TableHead>
                    <TableHead className="font-semibold text-xs">Role</TableHead>
                    <TableHead className="font-semibold text-xs">Status</TableHead>
                    <TableHead className="font-semibold text-xs">Last Sign-in</TableHead>
                    <TableHead className="font-semibold text-xs">Created</TableHead>
                    <TableHead className="text-right font-semibold text-xs pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => {
                    const initials = (u.fullName || u.email || 'U')
                      .split('@')[0]
                      .slice(0, 2)
                      .toUpperCase();

                    const primaryOrg = u.memberships[0]?.tenantName || u.memberships[0]?.tenantSlug || 'None';
                    const isPlatformAdminRole = u.primaryRole === 'super_admin' || u.primaryRole === 'auditor';
                    const isSuperAdminRole = u.primaryRole === 'admin' || u.primaryRole === 'owner';

                    return (
                      <TableRow key={u.id} className="border-border/50 hover:bg-muted/40 transition-colors">
                        {/* User Identity */}
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500/20 to-teal-500/20 border border-border/80 text-xs font-bold text-foreground">
                              {initials}
                            </div>
                            <div className="flex flex-col">
                              <span className="font-medium text-sm text-foreground flex items-center gap-1.5">
                                {u.email}
                              </span>
                              {u.fullName ? (
                                <span className="text-xs text-muted-foreground">{u.fullName}</span>
                              ) : (
                                <span className="text-[11px] text-muted-foreground/60 italic">No name provided</span>
                              )}
                            </div>
                          </div>
                        </TableCell>

                        {/* Organization */}
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium">{primaryOrg}</span>
                            {u.memberships.length > 1 && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0">
                                +{u.memberships.length - 1}
                              </Badge>
                            )}
                          </div>
                        </TableCell>

                        {/* Role */}
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`capitalize text-xs font-semibold ${
                              u.primaryRole === 'super_admin'
                                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-xs'
                                : u.primaryRole === 'admin'
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : u.primaryRole === 'owner'
                                ? 'bg-teal-500/15 text-teal-400 border-teal-500/30'
                                : u.primaryRole === 'operator'
                                ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                                : 'bg-slate-500/10 text-slate-400 border-slate-500/30'
                            }`}
                          >
                            {u.primaryRole === 'super_admin' ? 'Super Admin' : u.primaryRole.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>

                        {/* Status (Active / Expired / Disabled) */}
                        <TableCell>
                          <div className="flex flex-col gap-1 items-start">
                            {u.isExpired ? (
                              <Badge variant="destructive" className="gap-1 font-semibold text-xs bg-rose-500/15 text-rose-300 border-rose-500/30">
                                <Clock className="h-3 w-3" /> Expired & Disabled
                              </Badge>
                            ) : u.isBanned ? (
                              <Badge variant="destructive" className="gap-1 font-semibold text-xs bg-rose-500/15 text-rose-400 border-rose-500/30">
                                <Ban className="h-3 w-3" /> Disabled
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="gap-1 font-semibold text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
                              </Badge>
                            )}

                            {/* Active Expiry Countdown Pill */}
                            {!u.isExpired && u.expiresAt && (
                              <Badge
                                variant="outline"
                                className="gap-1 text-[10px] px-1.5 py-0 font-medium bg-amber-500/10 text-amber-300 border-amber-500/30"
                                title={`Expires at ${new Date(u.expiresAt).toLocaleString()}`}
                              >
                                <CalendarClock className="h-2.5 w-2.5 text-amber-400" />
                                {(() => {
                                  const diffMs = new Date(u.expiresAt).getTime() - Date.now();
                                  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                                  const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
                                  if (diffDays > 30) return `Exp: ${new Date(u.expiresAt).toLocaleDateString()}`;
                                  if (diffDays > 1) return `Exp in ${diffDays}d`;
                                  if (diffHours > 0) return `Exp in ${diffHours}h`;
                                  return 'Expiring soon';
                                })()}
                              </Badge>
                            )}
                          </div>
                        </TableCell>

                        {/* Last Sign-in */}
                        <TableCell className="text-xs text-muted-foreground">
                          {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString() : 'Never'}
                        </TableCell>

                        {/* Created At */}
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </TableCell>

                        {/* Action Buttons */}
                        <TableCell className="text-right pr-6">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Fast Expiry Timer Button */}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openExpiryDialog(u)}
                              className="h-8 px-2.5 text-xs gap-1.5 cursor-pointer text-teal-400 hover:text-teal-300 hover:bg-teal-500/10 border-teal-500/30"
                              title="Set Account Expiry Timer"
                            >
                              <CalendarClock className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Expiry</span>
                            </Button>

                            {/* Fast Enable / Disable Toggle */}
                            <Button
                              size="sm"
                              variant={u.isBanned ? 'default' : 'outline'}
                              disabled={busyId === u.id}
                              onClick={() => handleToggleBan(u)}
                              className={`h-8 px-2.5 text-xs gap-1.5 cursor-pointer ${
                                u.isBanned
                                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                  : 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border-amber-500/30'
                              }`}
                              title={u.isBanned ? 'Re-enable account' : 'Disable account login'}
                            >
                              {u.isBanned ? <ShieldCheck className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                              <span>{u.isBanned ? 'Enable' : 'Disable'}</span>
                            </Button>

                            {/* Dropdown Menu for Edit, Expiry & Delete */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 cursor-pointer">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuLabel className="text-xs">Manage Admin</DropdownMenuLabel>
                                <DropdownMenuItem onClick={() => openExpiryDialog(u)} className="gap-2 cursor-pointer">
                                  <CalendarClock className="h-3.5 w-3.5 text-teal-400" />
                                  <span>Set Expiry Timer</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleOpenEdit(u)} className="gap-2 cursor-pointer">
                                  <Edit2 className="h-3.5 w-3.5 text-sky-400" />
                                  <span>Edit Admin Details</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleToggleBan(u)} className="gap-2 cursor-pointer">
                                  {u.isBanned ? (
                                    <>
                                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                                      <span>Enable Login</span>
                                    </>
                                  ) : (
                                    <>
                                      <Ban className="h-3.5 w-3.5 text-amber-400" />
                                      <span>Disable Login</span>
                                    </>
                                  )}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleOpenDelete(u)}
                                  className="gap-2 text-rose-400 focus:text-rose-300 focus:bg-rose-500/10 cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>Delete Admin</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {filteredUsers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        No admin or user accounts matched your search.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ========================================================================= */}
      {/* 1. CREATE ADMIN DIALOG                                                   */}
      {/* ========================================================================= */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <UserPlus className="h-5 w-5 text-amber-400" />
              Provision New Workspace Admin
            </DialogTitle>
            <DialogDescription className="text-xs">
              Create a new administrator account with instant credentials and assign them to an organization.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Admin Email *</label>
              <Input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="admin@workspace.com"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-300">Initial Password *</label>
                <button
                  type="button"
                  onClick={() => setNewPassword(generateSecurePassword())}
                  className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles className="h-3 w-3" /> Auto-Generate
                </button>
              </div>
              <div className="relative">
                <Input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Full Name (Optional)</label>
              <Input
                type="text"
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                placeholder="e.g. Alex Henderson"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Target Organization *</label>
                <Select value={newTenantId} onValueChange={setNewTenantId}>
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name} ({org.slug})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Role *</label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin (Full Workspace Access)</SelectItem>
                    <SelectItem value="operator">Operator (Agent & Inbox)</SelectItem>
                    <SelectItem value="owner">Owner (Organization Owner)</SelectItem>
                    <SelectItem value="viewer">Viewer (Read-only)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                disabled={createSubmitting}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createSubmitting}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold gap-2 cursor-pointer"
              >
                {createSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Create Admin Account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* 2. EDIT ADMIN DIALOG                                                     */}
      {/* ========================================================================= */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Edit2 className="h-5 w-5 text-sky-400" />
              Edit Admin Settings
            </DialogTitle>
            <DialogDescription className="text-xs">
              Update email, full name, role, workspace assignment, or reset password for {selectedUser?.email}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Admin Email</label>
              <Input
                type="email"
                required
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
              <Input
                type="text"
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                placeholder="Full Name"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Organization</label>
                <Select value={editTenantId} onValueChange={setEditTenantId}>
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name} ({org.slug})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Role</label>
                <Select value={editRole} onValueChange={setEditRole}>
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="operator">Operator</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="pt-2 border-t border-border/60">
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Reset Password <span className="text-muted-foreground font-normal">(Leave blank to keep unchanged)</span>
              </label>
              <div className="relative">
                <Input
                  type={showEditPassword ? 'text' : 'password'}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Enter new password (min. 8 chars)"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowEditPassword(!showEditPassword)}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {showEditPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <DialogFooter className="pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditDialogOpen(false)}
                disabled={editSubmitting}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={editSubmitting}
                className="bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold gap-2 cursor-pointer"
              >
                {editSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* 3. DELETE ADMIN CONFIRMATION DIALOG                                      */}
      {/* ========================================================================= */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg text-rose-500">
              <ShieldAlert className="h-5 w-5 text-rose-500" />
              Permanently Delete Admin
            </DialogTitle>
            <DialogDescription className="text-xs">
              This action is destructive and permanent. It will completely delete the user account, terminate all sessions, and remove access across all workspaces.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleDeleteSubmit} className="space-y-4 py-2">
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300">
              To confirm deletion of <strong>{selectedUser?.email}</strong>, type their email address below:
            </div>

            <div>
              <Input
                type="text"
                required
                value={deleteConfirmEmail}
                onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                placeholder={selectedUser?.email || 'admin email'}
                className="border-rose-500/40 focus:border-rose-500"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteDialogOpen(false)}
                disabled={deleteSubmitting}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={
                  deleteSubmitting ||
                  deleteConfirmEmail.trim().toLowerCase() !== (selectedUser?.email || '').toLowerCase()
                }
                className="gap-2 cursor-pointer"
              >
                {deleteSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Permanently Delete User
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* 4. SET EXPIRY DATE DIALOG                                                */}
      {/* ========================================================================= */}
      <Dialog open={expiryDialogOpen} onOpenChange={setExpiryDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <CalendarClock className="h-5 w-5 text-teal-400" />
              Manage Account Expiry Timer
            </DialogTitle>
            <DialogDescription className="text-xs">
              Configure an automatic expiration timer for <span className="font-semibold text-foreground">{userForExpiry?.email}</span>. When the expiry date is reached, this account is automatically disabled.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Current Status Banner */}
            <div className="p-3 bg-muted/40 border border-border/70 rounded-xl text-xs flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground font-medium">Current Expiry Status:</span>
                <span className="font-semibold text-foreground">
                  {userForExpiry?.isExpired ? (
                    <span className="text-rose-400 flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> Expired & Disabled
                    </span>
                  ) : userForExpiry?.expiresAt ? (
                    <span className="text-amber-300 flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5" /> Expires on {new Date(userForExpiry.expiresAt).toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5" /> Permanent Access (No Expiry)
                    </span>
                  )}
                </span>
              </div>
              {userForExpiry?.expiresAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={expirySubmitting}
                  onClick={() => handleSaveExpiry(null)}
                  className="h-7 text-xs text-muted-foreground hover:text-rose-400 cursor-pointer"
                >
                  Remove Expiry
                </Button>
              )}
            </div>

            {/* Quick 1-Click Presets */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Quick Expiry Presets
              </label>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleApplyPreset(30)}
                  className="h-9 text-xs font-semibold text-teal-300 bg-teal-500/10 border-teal-500/30 hover:bg-teal-500/20 hover:border-teal-500/50 cursor-pointer col-span-3 sm:col-span-1"
                >
                  <Calendar className="h-3.5 w-3.5 mr-1" />
                  1 Month (+30d)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleApplyPreset(7)}
                  className="h-9 text-xs border-border/80 hover:bg-muted cursor-pointer"
                >
                  7 Days
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleApplyPreset(90)}
                  className="h-9 text-xs border-border/80 hover:bg-muted cursor-pointer"
                >
                  3 Months
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleApplyPreset(180)}
                  className="h-9 text-xs border-border/80 hover:bg-muted cursor-pointer"
                >
                  6 Months
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleApplyPreset(365)}
                  className="h-9 text-xs border-border/80 hover:bg-muted cursor-pointer"
                >
                  1 Year
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleSaveExpiry(null)}
                  className="h-9 text-xs border-rose-500/30 text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                >
                  Clear (Never)
                </Button>
              </div>
            </div>

            {/* Custom Expiration Date & Time Picker */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Custom Expiration Date & Time
              </label>
              <Input
                type="datetime-local"
                value={customExpiryDate}
                onChange={(e) => setCustomExpiryDate(e.target.value)}
                className="text-xs bg-muted/20 border-border/80"
              />
              {customExpiryDate && (
                <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                  <CalendarClock className="h-3 w-3 text-teal-400" />
                  Target: {new Date(customExpiryDate).toLocaleString()}
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setExpiryDialogOpen(false)}
              disabled={expirySubmitting}
              className="cursor-pointer text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => handleSaveExpiry()}
              disabled={expirySubmitting || !customExpiryDate}
              className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold gap-2 cursor-pointer text-xs"
            >
              {expirySubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
              Save Expiry Timer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Ban / Suspend Admin Dialog */}
      <ConfirmDeleteDialog
        isOpen={!!userToBan}
        onOpenChange={(open) => !open && setUserToBan(null)}
        title="Suspend Platform User Access?"
        itemName={userToBan?.email}
        itemType="user account"
        description={
          userToBan ? (
            <>
              Are you sure you want to disable login for{' '}
              <span className="font-semibold text-foreground">"{userToBan.email}"</span>? They will be immediately
              signed out and unable to access any workspaces until re-enabled by a Super Admin.
            </>
          ) : undefined
        }
        confirmLabel="Yes, Suspend User"
        cancelLabel="No, Cancel"
        onConfirm={() => {
          if (userToBan) return executeToggleBan(userToBan, 'ban');
        }}
      />
    </div>
  );
}
