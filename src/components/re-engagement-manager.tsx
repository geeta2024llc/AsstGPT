'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Clock,
  Sparkles,
  Play,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Zap,
} from 'lucide-react';
import type { ReEngagementConfig } from '@/types';

export default function ReEngagementManager() {
  const [config, setConfig] = useState<ReEngagementConfig>({
    isEnabled: false,
    inactivityHoursThreshold: 24,
    maxFollowUpsPerConversation: 1,
    followUpMessageTemplate:
      'Hi {{name}}, just checking in to see if you needed any further assistance with your inquiry?',
    onlyUnresolved: true,
    aiGeneratedContextual: true,
    scanIntervalMinutes: 60,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch('/api/re-engagement/config');
        if (res.ok) {
          const data = await res.json();
          setConfig(data);
        }
      } catch (err) {
        console.error('Failed to load re-engagement config:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadConfig();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/re-engagement/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!res.ok) throw new Error('Failed to update re-engagement settings.');

      const updated = await res.json();
      setConfig(updated);
      toast({
        title: 'Settings Saved',
        description: `Proactive re-engagement is now ${updated.isEnabled ? 'ACTIVE' : 'PAUSED'}.`,
      });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'Could not save settings.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunNow = async () => {
    setIsRunning(true);
    setScanResult(null);
    try {
      const res = await fetch('/api/re-engagement/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });

      if (!res.ok) throw new Error('Re-engagement scan failed.');

      const result = await res.json();
      setScanResult(result);

      toast({
        title: 'Scan Complete',
        description: `Scanned ${result.scanned} conversations. Dispatched ${result.dispatched} follow-up messages.`,
      });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Scan Error',
        description: err.message,
      });
    } finally {
      setIsRunning(false);
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
      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <Clock className="h-5 w-5 text-indigo-500" />
                <span>Proactive Customer Re-Engagement</span>
                <Badge
                  variant={config.isEnabled ? 'default' : 'secondary'}
                  className="text-xs px-2 py-0.5"
                >
                  {config.isEnabled ? 'ACTIVE' : 'PAUSED'}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-1">
                Automatically follow up with customers whose conversations have stalled or remained unanswered past a configured inactivity threshold.
              </CardDescription>
            </div>

            {/* Master Switch Toggle */}
            <div className="flex items-center gap-3 bg-muted/40 p-2.5 rounded-lg border">
              <Label htmlFor="reengage-master-toggle" className="text-xs font-semibold cursor-pointer">
                {config.isEnabled ? 'Automation Enabled' : 'Automation Disabled'}
              </Label>
              <Switch
                id="reengage-master-toggle"
                checked={config.isEnabled}
                onCheckedChange={(checked) => setConfig((c) => ({ ...c, isEnabled: checked }))}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Controls Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Inactivity Threshold */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>Inactivity Threshold</span>
              </Label>
              <Select
                value={config.inactivityHoursThreshold.toString()}
                onValueChange={(val) =>
                  setConfig((c) => ({ ...c, inactivityHoursThreshold: Number(val) }))
                }
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Select hours" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2" className="text-xs">2 Hours (Fast Follow-Up)</SelectItem>
                  <SelectItem value="4" className="text-xs">4 Hours (Same Day)</SelectItem>
                  <SelectItem value="12" className="text-xs">12 Hours (Half Day)</SelectItem>
                  <SelectItem value="24" className="text-xs">24 Hours (Next Day - Recommended)</SelectItem>
                  <SelectItem value="48" className="text-xs">48 Hours (2 Days)</SelectItem>
                  <SelectItem value="72" className="text-xs">72 Hours (3 Days)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Trigger follow-up when the customer hasn&apos;t replied after this duration.
              </p>
            </div>

            {/* Max Follow-Ups */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-muted-foreground" />
                <span>Max Follow-Ups Per Chat</span>
              </Label>
              <Select
                value={config.maxFollowUpsPerConversation.toString()}
                onValueChange={(val) =>
                  setConfig((c) => ({ ...c, maxFollowUpsPerConversation: Number(val) }))
                }
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Select max count" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1" className="text-xs">1 Follow-up (Standard)</SelectItem>
                  <SelectItem value="2" className="text-xs">2 Follow-ups (Persistent)</SelectItem>
                  <SelectItem value="3" className="text-xs">3 Follow-ups (Maximum)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Prevents spamming customers who choose not to respond.
              </p>
            </div>

            {/* Scan Frequency */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>Automatic Scan Frequency</span>
              </Label>
              <Select
                value={config.scanIntervalMinutes.toString()}
                onValueChange={(val) =>
                  setConfig((c) => ({ ...c, scanIntervalMinutes: Number(val) }))
                }
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Select interval" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15" className="text-xs">Every 15 Minutes</SelectItem>
                  <SelectItem value="30" className="text-xs">Every 30 Minutes</SelectItem>
                  <SelectItem value="60" className="text-xs">Every Hour (Recommended)</SelectItem>
                  <SelectItem value="120" className="text-xs">Every 2 Hours</SelectItem>
                  <SelectItem value="240" className="text-xs">Every 4 Hours</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                How often the background scheduler checks for stale conversations when automation is enabled.
              </p>
            </div>
          </div>

          {/* AI Contextual Mode Switch */}
          <div className="flex items-center justify-between p-3.5 rounded-lg border bg-muted/20">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                <span>AI Contextual Follow-Up Generation</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Uses Gemini / Groq to write a natural, 1-sentence follow-up referencing the customer&apos;s specific question or context.
              </p>
            </div>
            <Switch
              checked={config.aiGeneratedContextual}
              onCheckedChange={(checked) =>
                setConfig((c) => ({ ...c, aiGeneratedContextual: checked }))
              }
            />
          </div>

          {/* Default Template Editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span>Fallback Message Template</span>
              </Label>
              <span className="text-[10px] text-muted-foreground">
                Variable: <code className="bg-muted px-1 py-0.5 rounded text-primary">{'{{name}}'}</code>
              </span>
            </div>
            <Textarea
              rows={3}
              value={config.followUpMessageTemplate}
              onChange={(e) =>
                setConfig((c) => ({ ...c, followUpMessageTemplate: e.target.value }))
              }
              placeholder="Hi {{name}}, just checking in..."
              className="text-xs leading-relaxed"
            />
            <p className="text-[11px] text-muted-foreground">
              Used when AI contextual generation is turned off or when AI providers are in cooldown.
            </p>
          </div>

          {/* Manual Run Results Banner */}
          {scanResult && (
            <div className="p-3.5 rounded-lg border bg-muted/40 text-xs space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                {scanResult.dispatched > 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                )}
                <span>
                  Scan Completed: {scanResult.scanned} conversations evaluated, {scanResult.dispatched} follow-ups dispatched.
                </span>
              </div>

              {scanResult.details?.length > 0 && (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {scanResult.details.map((d: any, idx: number) => (
                    <div key={idx} className="p-2 rounded bg-card border text-[11px] space-y-0.5">
                      <span className="font-semibold text-primary">{d.customerName}</span>
                      <p className="text-muted-foreground italic">&ldquo;{d.message}&rdquo;</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t bg-muted/10 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunNow}
            disabled={isRunning || isSaving}
            className="text-xs gap-1.5"
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 text-indigo-500 fill-indigo-500" />
            )}
            <span>Run Re-Engagement Scan Now</span>
          </Button>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || isRunning}
            className="text-xs gap-1.5"
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            <span>Save Settings</span>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
