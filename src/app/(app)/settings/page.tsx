'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sun,
  Moon,
  Sparkles,
  ShieldAlert,
  Sliders,
  MessageSquareQuote,
  Webhook,
  MessageSquare,
  Users,
  Clock,
  Users2,
  Building2,
  UserCircle,
  QrCode,
  Layers,
  Radio,
} from 'lucide-react';
import { useSettings } from '@/hooks/use-settings';
import WorkspaceSettingsManager from '@/components/workspace-settings-manager';
import AccountSettingsManager from '@/components/account-settings-manager';
import HandoffRulesManager from '@/components/handoff-rules-manager';
import CannedResponsesManager from '@/components/canned-responses-manager';
import WebhookManager from '@/components/webhook-manager';
import WidgetConfigManager from '@/components/widget-config-manager';
import TeamRBACManager from '@/components/team-rbac-manager';
import TeamInviteManager from '@/components/team-invite-manager';
import ReEngagementManager from '@/components/re-engagement-manager';
import ContactDedupManager from '@/components/contact-dedup-manager';
import ChannelsIntegrationCard from '@/components/channels-integration-card';

function SettingsContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'workspace';
  const [activeTab, setActiveTab] = useState(initialTab);

  const { resolvedTheme, setTheme } = useTheme();
  const { autoLoadKnowledge, setAutoLoadKnowledge } = useSettings();

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
          <h1 className="font-headline text-2xl sm:text-3xl font-bold tracking-tight">
            Settings & Integrations
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Manage workspace profile, team roles (RBAC), multi-device WhatsApp channel, automated human handoff rules, proactive re-engagement, canned replies, and outbound webhooks.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 sm:space-y-6">
        {/* Navigation Tabs Bar */}
        <div className="overflow-x-auto pb-1.5 custom-scrollbar">
          <TabsList className="flex w-max min-w-full sm:min-w-0 p-1 bg-muted/60 border border-border/60 rounded-xl gap-0.5">
            <TabsTrigger value="workspace" className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 cursor-pointer shrink-0">
              <Building2 className="h-3.5 w-3.5" />
              <span>Workspace</span>
            </TabsTrigger>

            <TabsTrigger value="account" className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 cursor-pointer shrink-0">
              <UserCircle className="h-3.5 w-3.5" />
              <span>Account</span>
            </TabsTrigger>

            <TabsTrigger value="channels" className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 cursor-pointer shrink-0">
              <QrCode className="h-3.5 w-3.5 text-emerald-500" />
              <span>Channels</span>
            </TabsTrigger>

            <TabsTrigger value="handoff" className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 cursor-pointer shrink-0">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
              <span>Handoff</span>
            </TabsTrigger>

            <TabsTrigger value="reengagement" className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 cursor-pointer shrink-0">
              <Clock className="h-3.5 w-3.5 text-blue-500" />
              <span>Re-engage</span>
            </TabsTrigger>

            <TabsTrigger value="dedup" className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 cursor-pointer shrink-0">
              <Users2 className="h-3.5 w-3.5 text-indigo-500" />
              <span>Data Cleanup</span>
            </TabsTrigger>

            <TabsTrigger value="team" className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 cursor-pointer shrink-0">
              <Users className="h-3.5 w-3.5" />
              <span>Team & RBAC</span>
            </TabsTrigger>

            <TabsTrigger value="canned" className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 cursor-pointer shrink-0">
              <MessageSquareQuote className="h-3.5 w-3.5" />
              <span>Quick Replies</span>
            </TabsTrigger>

            <TabsTrigger value="widget" className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 cursor-pointer shrink-0">
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Chat Widget</span>
            </TabsTrigger>

            <TabsTrigger value="webhooks" className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 cursor-pointer shrink-0">
              <Webhook className="h-3.5 w-3.5 text-purple-500" />
              <span>Webhooks</span>
            </TabsTrigger>

            <TabsTrigger value="general" className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 cursor-pointer shrink-0">
              <Sliders className="h-3.5 w-3.5" />
              <span>Preferences</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: Workspace Profile, Notifications, Plan */}
        <TabsContent value="workspace" className="space-y-6">
          <WorkspaceSettingsManager />
        </TabsContent>

        {/* Tab 2: Personal Account, Logout & Delete Account */}
        <TabsContent value="account" className="space-y-6">
          <AccountSettingsManager />
        </TabsContent>

        {/* Tab 3: Multi-Channel Gateways & Live Status */}
        <TabsContent value="channels" className="space-y-6">
          <ChannelsIntegrationCard onSwitchTab={setActiveTab} />
        </TabsContent>

        {/* Tab 4: Automated Handoff & Routing Rules */}
        <TabsContent value="handoff" className="space-y-6">
          <HandoffRulesManager />
        </TabsContent>

        {/* Tab 5: Proactive Customer Re-Engagement */}
        <TabsContent value="reengagement" className="space-y-6">
          <ReEngagementManager />
        </TabsContent>

        {/* Tab 6: Duplicate Contact Cleanup */}
        <TabsContent value="dedup" className="space-y-6">
          <ContactDedupManager />
        </TabsContent>

        {/* Tab 7: Team Members & RBAC */}
        <TabsContent value="team" className="space-y-6">
          <TeamInviteManager />
          <TeamRBACManager />
        </TabsContent>

        {/* Tab 8: Canned Responses & Quick Replies */}
        <TabsContent value="canned" className="space-y-6">
          <CannedResponsesManager />
        </TabsContent>

        {/* Tab 9: Live Web Chat Widget */}
        <TabsContent value="widget" className="space-y-6">
          <WidgetConfigManager />
        </TabsContent>

        {/* Tab 10: Outbound Webhooks & Integrations */}
        <TabsContent value="webhooks" className="space-y-6">
          <WebhookManager />
        </TabsContent>

        {/* Tab 11: General & Appearance */}
        <TabsContent value="general" className="space-y-6">
          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-bold">
                <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-amber-500" />
                <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-indigo-400" />
                <span className="ml-1">Theme & Appearance</span>
              </CardTitle>
              <CardDescription>
                Customize the look and feel of your AsstGPT workspace interface.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/20">
                <div className="space-y-0.5">
                  <Label htmlFor="theme-mode" className="text-sm font-semibold">
                    Dark Mode
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Switch between dark and light themes for optimal visibility.
                  </p>
                </div>
                <Switch
                  id="theme-mode"
                  checked={resolvedTheme === 'dark'}
                  onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-bold">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>AI Memory Preferences</span>
              </CardTitle>
              <CardDescription>
                Configure default retrieval behaviors for your AI agents.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/20">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-load-knowledge" className="text-sm font-semibold">
                    Auto-load AI Memory Sources
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically index all knowledge documents as grounding context for conversational generation.
                  </p>
                </div>
                <Switch
                  id="auto-load-knowledge"
                  checked={autoLoadKnowledge}
                  onCheckedChange={setAutoLoadKnowledge}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading Settings...</div>}>
      <SettingsContent />
    </Suspense>
  );
}
