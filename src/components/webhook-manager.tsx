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
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Webhook,
  Plus,
  Trash2,
  Edit2,
  Send,
  Check,
  Copy,
  RefreshCw,
  Loader2,
  ExternalLink,
  Shield,
  Activity,
  CheckCircle,
  AlertTriangle,
  Zap,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import ConfirmDeleteDialog from '@/components/confirm-delete-dialog';
import { useToast } from '@/hooks/use-toast';
import type { WebhookConfig, WebhookEventType } from '@/types';
import { format } from 'date-fns';

const AVAILABLE_EVENTS: { id: WebhookEventType; label: string; description: string }[] = [
  {
    id: 'handoff.triggered',
    label: 'Human Handoff Triggered',
    description: 'Fired when a conversation is escalated to human agent takeover.',
  },
  {
    id: 'conversation.resolved',
    label: 'Conversation Resolved',
    description: 'Fired when an agent or system marks a conversation as resolved.',
  },
  {
    id: 'conversation.reopened',
    label: 'Conversation Reopened',
    description: 'Fired when a resolved conversation is reopened by an incoming customer message.',
  },
  {
    id: 'contact.stage_changed',
    label: 'Contact Stage / CRM Updated',
    description: 'Fired when a contact lifecycle stage, company, or tags change.',
  },
  {
    id: 'message.received',
    label: 'Inbound Message Received',
    description: 'Fired on every customer incoming WhatsApp message.',
  },
  {
    id: 'note.created',
    label: 'Internal Team Note Added',
    description: 'Fired when a team member adds a private note to a conversation.',
  },
];

export default function WebhookManager() {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookConfig | null>(null);

  // Test Simulator State
  const [testWebhook, setTestWebhook] = useState<WebhookConfig | null>(null);
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [testEvent, setTestEvent] = useState<WebhookEventType>('handoff.triggered');
  const [testResult, setTestResult] = useState<any>(null);
  const [copiedSecretId, setCopiedSecretId] = useState<string | null>(null);

  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: '',
    url: '',
    secret: '',
    events: ['handoff.triggered', 'conversation.resolved'] as WebhookEventType[],
    isActive: true,
  });

  const fetchWebhooks = async () => {
    try {
      const res = await fetch('/api/webhooks');
      if (!res.ok) throw new Error('Failed to load webhooks');
      const data = await res.json();
      setWebhooks(data);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWebhooks();
  }, []);

  const generateSecret = () => {
    const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(20)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return `whsec_${randomHex}`;
  };

  const handleOpenCreate = () => {
    setEditingWebhook(null);
    setFormData({
      name: '',
      url: '',
      secret: generateSecret(),
      events: ['handoff.triggered', 'conversation.resolved'],
      isActive: true,
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (w: WebhookConfig) => {
    setEditingWebhook(w);
    setFormData({
      name: w.name,
      url: w.url,
      secret: w.secret,
      events: w.events,
      isActive: w.isActive,
    });
    setIsDialogOpen(true);
  };

  const handleToggleActive = async (w: WebhookConfig, newActive: boolean) => {
    try {
      const res = await fetch(`/api/webhooks/${w.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newActive }),
      });
      if (!res.ok) throw new Error('Failed to update webhook status');
      setWebhooks(prev => prev.map(item => (item.id === w.id ? { ...item, isActive: newActive } : item)));
      toast({ title: newActive ? 'Webhook Enabled' : 'Webhook Disabled' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.url.trim() || formData.events.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Please provide a name, valid URL, and at least one event.',
      });
      return;
    }

    setIsSaving(true);
    try {
      const url = editingWebhook ? `/api/webhooks/${editingWebhook.id}` : '/api/webhooks';
      const method = editingWebhook ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to save webhook');
      }

      toast({
        title: editingWebhook ? 'Webhook Updated' : 'Webhook Created',
        description: `Endpoint "${formData.name}" is now ready for events.`,
      });

      setIsDialogOpen(false);
      fetchWebhooks();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save Failed', description: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const [webhookToDelete, setWebhookToDelete] = useState<{ id: string; name: string } | null>(null);

  const confirmDeleteWebhook = async () => {
    if (!webhookToDelete) return;
    try {
      const res = await fetch(`/api/webhooks/${webhookToDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete webhook');
      setWebhooks(prev => prev.filter(w => w.id !== webhookToDelete.id));
      toast({ title: 'Webhook Deleted', description: `Webhook "${webhookToDelete.name}" was removed.` });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    } finally {
      setWebhookToDelete(null);
    }
  };

  const handleRunTest = async (targetWebhook: WebhookConfig) => {
    setIsTestRunning(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookId: targetWebhook.id,
          url: targetWebhook.url,
          secret: targetWebhook.secret,
          event: testEvent,
        }),
      });

      const data = await res.json();
      setTestResult(data);
      fetchWebhooks(); // Refresh delivery stats
    } catch (err) {
      setTestResult({ success: false, statusCode: 0, responseBody: (err as Error).message });
    } finally {
      setIsTestRunning(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSecretId(id);
    setTimeout(() => setCopiedSecretId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header & Description */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-headline flex items-center gap-2">
            <Webhook className="h-5 w-5 text-primary" />
            <span>Outbound Webhooks & Integrations</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            Stream real-time WhatsApp events to Zapier, Make, HubSpot, or custom webhook endpoints with HMAC-SHA256 signatures.
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="gap-1.5 self-start sm:self-auto">
          <Plus className="h-4 w-4" />
          <span>Add Webhook</span>
        </Button>
      </div>

      {/* Webhook List */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : webhooks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Zap className="h-6 w-6" />
            </div>
            <h3 className="font-semibold text-base">No Webhooks Configured</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Connect external services like Zapier, Make, or your CRM to receive live escalations and contact updates.
            </p>
            <Button onClick={handleOpenCreate} variant="outline" className="gap-1.5 mt-2">
              <Plus className="h-4 w-4" />
              <span>Create First Webhook</span>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {webhooks.map((w) => (
            <Card key={w.id} className="transition-all hover:shadow-sm">
              <CardHeader className="p-4 pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-base font-semibold truncate">{w.name}</CardTitle>
                      <Badge
                        variant={w.isActive ? 'default' : 'secondary'}
                        className="text-[10px] uppercase font-bold"
                      >
                        {w.isActive ? 'Active' : 'Disabled'}
                      </Badge>
                      {w.lastStatusCode !== undefined && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium border ${
                            w.lastStatusCode >= 200 && w.lastStatusCode < 300
                              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                          }`}
                        >
                          HTTP {w.lastStatusCode || 'ERR'}
                        </span>
                      )}
                    </div>
                    <CardDescription className="font-mono text-xs text-foreground/80 truncate">
                      {w.url}
                    </CardDescription>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={w.isActive}
                      onCheckedChange={(checked) => handleToggleActive(w, checked)}
                      title={w.isActive ? 'Disable Webhook' : 'Enable Webhook'}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setTestWebhook(w);
                        setTestResult(null);
                      }}
                      className="h-8 text-xs gap-1"
                    >
                      <Send className="h-3 w-3" />
                      <span>Test Ping</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenEdit(w)}
                      className="h-8 w-8"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setWebhookToDelete({ id: w.id, name: w.name })}
                      className="h-8 w-8 text-destructive hover:text-destructive cursor-pointer"
                      title="Delete Webhook"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-4 pt-2 space-y-3">
                {/* Subscribed Events */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground font-medium mr-1">Events:</span>
                  {w.events.map((event) => (
                    <Badge key={event} variant="outline" className="text-[11px] font-normal bg-muted/40">
                      {event}
                    </Badge>
                  ))}
                </div>

                {/* Secret Key & Metadata */}
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-primary" />
                    <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded">
                      {w.secret.slice(0, 10)}...{w.secret.slice(-4)}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(w.secret, w.id)}
                      className="hover:text-foreground inline-flex items-center gap-1 text-[11px]"
                    >
                      {copiedSecretId === w.id ? (
                        <Check className="h-3 w-3 text-emerald-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-4 text-[11px]">
                    {w.lastTriggeredAt ? (
                      <span>Last Triggered: {format(new Date(w.lastTriggeredAt), 'MMM d, p')}</span>
                    ) : (
                      <span>Never triggered</span>
                    )}
                    {w.failureCount > 0 && (
                      <span className="text-rose-500 font-medium">Failures: {w.failureCount}</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Webhook Create / Edit Modal */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingWebhook ? 'Edit Outbound Webhook' : 'Create Outbound Webhook'}</DialogTitle>
            <DialogDescription>
              Configure the endpoint URL and events to stream to external applications.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="webhook-name">Webhook Name</Label>
              <Input
                id="webhook-name"
                value={formData.name}
                onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Zapier Lead CRM Sync"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="webhook-url">Endpoint URL</Label>
              <Input
                id="webhook-url"
                value={formData.url}
                onChange={(e) => setFormData(p => ({ ...p, url: e.target.value }))}
                placeholder="https://hooks.zapier.com/hooks/catch/..."
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="webhook-secret">HMAC Signing Secret</Label>
                <button
                  type="button"
                  onClick={() => setFormData(p => ({ ...p, secret: generateSecret() }))}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Regenerate</span>
                </button>
              </div>
              <Input
                id="webhook-secret"
                value={formData.secret}
                onChange={(e) => setFormData(p => ({ ...p, secret: e.target.value }))}
                className="font-mono text-xs"
              />
            </div>

            {/* Event Subscription Checkboxes */}
            <div className="space-y-2 pt-2 border-t">
              <Label className="font-semibold text-xs">Event Subscriptions</Label>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {AVAILABLE_EVENTS.map((event) => {
                  const isChecked = formData.events.includes(event.id);
                  return (
                    <div
                      key={event.id}
                      className="flex items-start space-x-2 p-2 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors"
                    >
                      <Checkbox
                        id={`event-${event.id}`}
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setFormData(p => ({ ...p, events: [...p.events, event.id] }));
                          } else {
                            setFormData(p => ({
                              ...p,
                              events: p.events.filter(e => e !== event.id),
                            }));
                          }
                        }}
                      />
                      <div className="grid gap-0.5 leading-none">
                        <label
                          htmlFor={`event-${event.id}`}
                          className="text-xs font-semibold cursor-pointer"
                        >
                          {event.label} <span className="font-mono text-[10px] text-muted-foreground font-normal">({event.id})</span>
                        </label>
                        <p className="text-[11px] text-muted-foreground">{event.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="gap-1.5">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              <span>{editingWebhook ? 'Update Webhook' : 'Create Webhook'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Live Webhook Test Simulator Dialog */}
      {testWebhook && (
        <Dialog open={!!testWebhook} onOpenChange={(open) => !open && setTestWebhook(null)}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                <span>Live Webhook Test Simulator</span>
              </DialogTitle>
              <DialogDescription>
                Simulate a real-time event dispatch with HMAC-SHA256 signature to <strong>{testWebhook.name}</strong>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-lg border bg-muted/20">
                  <span className="text-muted-foreground block mb-1">Target Endpoint:</span>
                  <span className="font-mono truncate block font-medium">{testWebhook.url}</span>
                </div>
                <div className="p-2.5 rounded-lg border bg-muted/20">
                  <span className="text-muted-foreground block mb-1">Select Event Type:</span>
                  <select
                    value={testEvent}
                    onChange={(e) => setTestEvent(e.target.value as WebhookEventType)}
                    className="w-full bg-background border rounded px-2 py-1 text-xs"
                  >
                    {AVAILABLE_EVENTS.map(ev => (
                      <option key={ev.id} value={ev.id}>{ev.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {testResult && (
                <div className="space-y-2 pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Test Results</span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-bold ${
                          testResult.success
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {testResult.success ? '✓ SUCCESS' : '✕ FAILED'} (HTTP {testResult.statusCode})
                      </span>
                      {testResult.durationMs !== undefined && (
                        <span className="text-xs text-muted-foreground font-mono">{testResult.durationMs}ms</span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">Response Payload / Diagnostic</Label>
                    <pre className="text-[11px] p-2.5 rounded-lg border bg-black/90 text-emerald-400 font-mono overflow-x-auto max-h-36">
                      {typeof testResult.responseBody === 'string'
                        ? testResult.responseBody || '(Empty response body)'
                        : JSON.stringify(testResult.responseBody, null, 2)}
                    </pre>
                  </div>

                  {testResult.signatureSent && (
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      Header: <span className="text-foreground">{testResult.signatureSent}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setTestWebhook(null)}>
                Close
              </Button>
              <Button
                onClick={() => handleRunTest(testWebhook)}
                disabled={isTestRunning}
                className="gap-1.5"
              >
                {isTestRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                <span>Send Test Ping</span>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Confirm Delete Webhook Dialog */}
      <ConfirmDeleteDialog
        isOpen={!!webhookToDelete}
        onOpenChange={(open) => !open && setWebhookToDelete(null)}
        title="Delete Outbound Webhook?"
        itemName={webhookToDelete?.name}
        itemType="webhook endpoint"
        description={
          webhookToDelete ? (
            <>
              Are you sure you want to delete the webhook{' '}
              <span className="font-semibold text-foreground">"{webhookToDelete.name}"</span>? Outbound event
              dispatches to this endpoint will immediately cease.
            </>
          ) : undefined
        }
        confirmLabel="Yes, Delete"
        cancelLabel="No, Cancel"
        onConfirm={confirmDeleteWebhook}
      />
    </div>
  );
}
