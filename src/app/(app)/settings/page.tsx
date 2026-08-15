'use client';

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
import { Sun, Moon, Sparkles, ShieldAlert, Sliders, MessageSquareQuote, Webhook, MessageSquare, Users, Clock, Users2 } from 'lucide-react';
import { useSettings } from '@/hooks/use-settings';
import HandoffRulesManager from '@/components/handoff-rules-manager';
import CannedResponsesManager from '@/components/canned-responses-manager';
import WebhookManager from '@/components/webhook-manager';
import WidgetConfigManager from '@/components/widget-config-manager';
import TeamRBACManager from '@/components/team-rbac-manager';
import ReEngagementManager from '@/components/re-engagement-manager';
import ContactDedupManager from '@/components/contact-dedup-manager';

export default function SettingsPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const { autoLoadKnowledge, setAutoLoadKnowledge } = useSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline text-3xl font-bold">Settings & Integrations</h1>
        <p className="text-muted-foreground mt-1">
          Manage system preferences, AI agent behavior, team roles (RBAC), quick replies, live chat widget, outbound webhooks, proactive re-engagement, and automated human handoff rules.
        </p>
      </div>

      <Tabs defaultValue="handoff" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-8 max-w-5xl">
          <TabsTrigger value="handoff" className="flex items-center gap-1.5 text-xs">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>Handoff</span>
          </TabsTrigger>
          <TabsTrigger value="reengagement" className="flex items-center gap-1.5 text-xs">
            <Clock className="h-3.5 w-3.5" />
            <span>Re-engage</span>
          </TabsTrigger>
          <TabsTrigger value="dedup" className="flex items-center gap-1.5 text-xs">
            <Users2 className="h-3.5 w-3.5" />
            <span>Data Cleanup</span>
          </TabsTrigger>
          <TabsTrigger value="team" className="flex items-center gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" />
            <span>Team & RBAC</span>
          </TabsTrigger>
          <TabsTrigger value="canned" className="flex items-center gap-1.5 text-xs">
            <MessageSquareQuote className="h-3.5 w-3.5" />
            <span>Quick Replies</span>
          </TabsTrigger>
          <TabsTrigger value="widget" className="flex items-center gap-1.5 text-xs">
            <MessageSquare className="h-3.5 w-3.5" />
            <span>Chat Widget</span>
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="flex items-center gap-1.5 text-xs">
            <Webhook className="h-3.5 w-3.5" />
            <span>Webhooks</span>
          </TabsTrigger>
          <TabsTrigger value="general" className="flex items-center gap-1.5 text-xs">
            <Sliders className="h-3.5 w-3.5" />
            <span>Preferences</span>
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Automated Handoff & Routing Rules */}
        <TabsContent value="handoff" className="space-y-6">
          <HandoffRulesManager />
        </TabsContent>

        {/* Tab 2: Proactive Customer Re-Engagement */}
        <TabsContent value="reengagement" className="space-y-6">
          <ReEngagementManager />
        </TabsContent>

        {/* Tab 2b: Duplicate Contact Cleanup */}
        <TabsContent value="dedup" className="space-y-6">
          <ContactDedupManager />
        </TabsContent>

        {/* Tab 2: Team Members & RBAC */}
        <TabsContent value="team" className="space-y-6">
          <TeamRBACManager />
        </TabsContent>

        {/* Tab 3: Canned Responses & Quick Replies */}
        <TabsContent value="canned" className="space-y-6">
          <CannedResponsesManager />
        </TabsContent>

        {/* Tab 3: Live Web Chat Widget */}
        <TabsContent value="widget" className="space-y-6">
          <WidgetConfigManager />
        </TabsContent>

        {/* Tab 4: Outbound Webhooks & Integrations */}
        <TabsContent value="webhooks" className="space-y-6">
          <WebhookManager />
        </TabsContent>

        {/* Tab 5: General & Appearance */}
        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="ml-1">Appearance</span>
              </CardTitle>
              <CardDescription>
                Customize the look and feel of your workspace.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label htmlFor="theme-mode" className="text-base">
                    Theme
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Select between light and dark themes.
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Agent Settings
              </CardTitle>
              <CardDescription>
                Configure default behaviors for your AI agents.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-load-knowledge" className="text-base">
                    Auto-load Knowledge Base
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically select all documents as context when creating a new agent rule.
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
