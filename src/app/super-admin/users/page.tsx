'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search, Ban, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface PlatformUser {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt?: string;
  isBanned: boolean;
  memberships: Array<{ tenantId: string; role: string; tenantName?: string }>;
}

export default function UsersPage() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchUsers = async (q?: string) => {
    setLoading(true);
    const res = await fetch(`/api/super-admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    const data = await res.json();
    setUsers(data.users || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleToggleBan = async (user: PlatformUser) => {
    const action = user.isBanned ? 'unban' : 'ban';
    if (action === 'ban' && !confirm(`Disable login for ${user.email}? They will be signed out and unable to sign in again until reactivated.`)) return;

    setBusyId(user.id);
    try {
      const res = await fetch(`/api/super-admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error('Failed to update user');
      await fetchUsers(search);
      toast({ title: action === 'ban' ? 'User disabled' : 'User re-enabled' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-headline">Users</h1>
        <p className="text-sm text-muted-foreground">Every platform account, across every tenant. Disabling a user blocks sign-in everywhere.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by email..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchUsers(search)}
            />
          </div>
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
                  <TableHead>Email</TableHead>
                  <TableHead>Organizations</TableHead>
                  <TableHead>Last Sign-in</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell>
                      {u.memberships.length === 0
                        ? '—'
                        : u.memberships.map((m) => `${m.tenantName || m.tenantId.slice(0, 8)} (${m.role})`).join(', ')}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString() : 'Never'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.isBanned ? 'destructive' : 'secondary'}>{u.isBanned ? 'Disabled' : 'Active'}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={u.isBanned ? 'default' : 'outline'}
                        className="gap-1.5"
                        disabled={busyId === u.id}
                        onClick={() => handleToggleBan(u)}
                      >
                        {u.isBanned ? <ShieldCheck className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                        {u.isBanned ? 'Enable' : 'Disable'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No users found.
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
