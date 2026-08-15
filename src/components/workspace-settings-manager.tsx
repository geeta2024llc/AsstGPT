'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Building2, Bell, CreditCard, Loader2, Check, MessageSquare, Bot, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { TenantProfile } from '@/types';

const FALLBACK_TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Karachi',
  'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Shanghai',
  'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland',
];

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
};

export default function WorkspaceSettingsManager() {
  const [profile, setProfile] = useState<TenantProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [businessDescription, setBusinessDescription] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [notifyEmail, setNotifyEmail] = useState('');
  const [emailOnNewConversation, setEmailOnNewConversation] = useState(false);
  const [emailOnHandoffRequested, setEmailOnHandoffRequested] = useState(true);
  const [emailDailyDigest, setEmailDailyDigest] = useState(false);

  const { toast } = useToast();

  const timezones = useMemo(() => {
    try {
      const supported = (Intl as any).supportedValuesOf?.('timeZone');
      return Array.isArray(supported) && supported.length > 0 ? supported : FALLBACK_TIMEZONES;
    } catch {
      return FALLBACK_TIMEZONES;
    }
  }, []);

  const applyProfile = (p: TenantProfile) => {
    setProfile(p);
    setName(p.name);
    setLogoUrl(p.logoUrl || '');
    setTimezone(p.timezone || 'UTC');
    setBusinessDescription(p.businessDescription || '');
    setSupportEmail(p.supportEmail || '');
    setNotifyEmail(p.notificationSettings?.notifyEmail || '');
    setEmailOnNewConversation(!!p.notificationSettings?.emailOnNewConversation);
    setEmailOnHandoffRequested(p.notificationSettings?.emailOnHandoffRequested !== false);
    setEmailDailyDigest(!!p.notificationSettings?.emailDailyDigest);
  };

  useEffect(() => {
    fetch('/api/tenant')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to load workspace');
        applyProfile(data);
      })
      .catch((err) => toast({ variant: 'destructive', title: 'Error', description: err.message }))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Workspace name cannot be empty' });
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          logoUrl: logoUrl.trim() || null,
          timezone,
          businessDescription: businessDescription.trim() || null,
          supportEmail: supportEmail.trim() || null,
          notificationSettings: {
            notifyEmail: notifyEmail.trim() || undefined,
            emailOnNewConversation,
            emailOnHandoffRequested,
            emailDailyDigest,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to save workspace settings');

      applyProfile(data);
      toast({ title: 'Workspace Updated', description: 'Your changes have been saved.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save Failed', description: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Company Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-primary" />
            <span>Company Profile</span>
          </CardTitle>
          <CardDescription>How your workspace is identified across AIWhisper.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14 border">
              <AvatarImage src={logoUrl || undefined} alt={name} />
              <AvatarFallback>{(name || 'W').charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="ws-logo">Logo URL</Label>
              <Input
                id="ws-logo"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://yourcompany.com/logo.png"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ws-name">Workspace Name</Label>
              <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme International" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-slug">Workspace URL Slug</Label>
              <Input id="ws-slug" value={profile?.slug || ''} disabled className="cursor-not-allowed text-muted-foreground" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ws-timezone">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="ws-timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {timezones.map((tz: string) => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Used for scheduling, digests, and displaying timestamps.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ws-description">Business Description</Label>
            <Textarea
              id="ws-description"
              value={businessDescription}
              onChange={(e) => setBusinessDescription(e.target.value)}
              placeholder="What does your business do? This helps your AI agents give better-grounded answers."
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ws-support-email">Support Email</Label>
            <Input
              id="ws-support-email"
              type="email"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              placeholder="support@yourcompany.com"
            />
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bell className="h-5 w-5 text-primary" />
            <span>Notifications</span>
          </CardTitle>
          <CardDescription>Where and when this workspace gets emailed about activity.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ws-notify-email">Notification Email</Label>
            <Input
              id="ws-notify-email"
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="alerts@yourcompany.com (defaults to support email if blank)"
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="text-sm font-medium">New Conversation Alerts</p>
              <p className="text-xs text-muted-foreground">Email when a new customer conversation starts.</p>
            </div>
            <Switch checked={emailOnNewConversation} onCheckedChange={setEmailOnNewConversation} />
          </div>

          <div className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="text-sm font-medium">Handoff Requested Alerts</p>
              <p className="text-xs text-muted-foreground">Email when the AI hands a conversation off to a human.</p>
            </div>
            <Switch checked={emailOnHandoffRequested} onCheckedChange={setEmailOnHandoffRequested} />
          </div>

          <div className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="text-sm font-medium">Daily Digest</p>
              <p className="text-xs text-muted-foreground">A daily summary of conversations, resolutions, and sentiment.</p>
            </div>
            <Switch checked={emailDailyDigest} onCheckedChange={setEmailDailyDigest} />
          </div>
        </CardContent>
      </Card>

      {/* Plan & Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CreditCard className="h-5 w-5 text-primary" />
            <span>Plan & Billing</span>
          </CardTitle>
          <CardDescription>Self-serve plan changes are coming soon -- this is a read-only summary for now.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-xl border p-4">
            <div>
              <p className="text-sm font-medium">
                {PLAN_LABELS[profile?.plan || 'free'] || profile?.plan} Plan
              </p>
              <p className="text-xs text-muted-foreground">
                Workspace created {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : '--'}
              </p>
            </div>
            {profile?.isActive ? (
              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">Active</Badge>
            ) : (
              <Badge variant="destructive">
                Suspended{profile?.suspendedReason ? `: ${profile.suspendedReason}` : ''}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cross-links to related settings that already have their own screens */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Also in this Workspace</CardTitle>
          <CardDescription>Managed on their own dedicated screens.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a href="/inbox" className="flex items-center justify-between rounded-xl border p-3 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">WhatsApp Connection</span>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </a>
          <a href="/agents" className="flex items-center justify-between rounded-xl border p-3 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">AI Agents & Instructions</span>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </a>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving} className="gap-1.5">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          <span>Save Workspace Settings</span>
        </Button>
      </div>
    </div>
  );
}
