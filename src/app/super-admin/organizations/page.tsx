'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search } from 'lucide-react';

interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  is_active: boolean;
  memberCount: number;
  whatsappStatus: string;
  created_at: string;
}

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchOrgs = async (q?: string) => {
    setLoading(true);
    const res = await fetch(`/api/super-admin/organizations${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    setOrgs(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    fetchOrgs();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-headline">Organizations</h1>
        <p className="text-sm text-muted-foreground">All tenant workspaces on the platform.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or slug..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchOrgs(search)}
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
                  <TableHead>Name</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell>
                      <Link href={`/super-admin/organizations/${org.id}`} className="font-medium hover:underline">
                        {org.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{org.slug}</div>
                    </TableCell>
                    <TableCell className="capitalize">{org.plan}</TableCell>
                    <TableCell>
                      <Badge variant={org.is_active ? 'secondary' : 'destructive'}>{org.is_active ? 'Active' : 'Suspended'}</Badge>
                    </TableCell>
                    <TableCell>{org.memberCount}</TableCell>
                    <TableCell className="capitalize">{org.whatsappStatus}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(org.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
                {orgs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No organizations found.
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
