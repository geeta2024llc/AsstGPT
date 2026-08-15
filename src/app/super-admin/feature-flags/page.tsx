'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Flag {
  key: string;
  enabled: boolean;
  description?: string;
}

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  const fetchFlags = async () => {
    const res = await fetch('/api/super-admin/feature-flags');
    setFlags(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    fetchFlags();
  }, []);

  const handleToggle = async (flag: Flag) => {
    setFlags((prev) => prev.map((f) => (f.key === flag.key ? { ...f, enabled: !f.enabled } : f)));
    const res = await fetch('/api/super-admin/feature-flags', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: flag.key, enabled: !flag.enabled }),
    });
    if (!res.ok) {
      setFlags((prev) => prev.map((f) => (f.key === flag.key ? { ...f, enabled: flag.enabled } : f)));
      toast({ variant: 'destructive', title: 'Failed to toggle flag' });
    }
  };

  const handleCreate = async () => {
    if (!newKey.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/super-admin/feature-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey.trim(), description: newDescription.trim() || undefined, enabled: false }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create flag');
      setNewKey('');
      setNewDescription('');
      await fetchFlags();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-headline">Feature Flags</h1>
        <p className="text-sm text-muted-foreground">Global toggles. Per-tenant overrides can be set from an organization's detail page in a future pass.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add Flag</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-2">
          <Input placeholder="flag_key" value={newKey} onChange={(e) => setNewKey(e.target.value)} className="sm:max-w-xs" />
          <Input placeholder="Description (optional)" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
          <Button onClick={handleCreate} disabled={creating || !newKey.trim()} className="gap-1.5 shrink-0">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-1">
              {flags.map((flag) => (
                <div key={flag.key} className="flex items-center justify-between border-b py-3 last:border-0">
                  <div>
                    <div className="font-medium">{flag.key}</div>
                    {flag.description && <div className="text-sm text-muted-foreground">{flag.description}</div>}
                  </div>
                  <Switch checked={flag.enabled} onCheckedChange={() => handleToggle(flag)} />
                </div>
              ))}
              {flags.length === 0 && <p className="text-sm text-muted-foreground">No feature flags yet.</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
