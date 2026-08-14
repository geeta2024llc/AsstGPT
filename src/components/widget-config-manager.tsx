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
import { Textarea } from '@/components/ui/textarea';
import {
  MessageSquare,
  Code2,
  Copy,
  Check,
  Save,
  Loader2,
  Palette,
  Eye,
  Send,
  ExternalLink,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { WidgetConfig } from '@/types';

export default function WidgetConfigManager() {
  const [config, setConfig] = useState<WidgetConfig>({
    title: 'Chat with Support',
    primaryColor: '#6366F1',
    greeting: 'Hi there! 👋 How can we help you today?',
    botAvatar: '🤖',
    botName: 'AI Assistant',
    placeholder: 'Type your message...',
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const { toast } = useToast();

  const [embedHost, setEmbedHost] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setEmbedHost(window.location.origin);
    }

    fetch('/api/widget/config')
      .then(res => res.json())
      .then(data => {
        if (data && data.title) {
          setConfig(data);
        }
      })
      .catch(err => {
        toast({ variant: 'destructive', title: 'Error', description: err.message });
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/widget/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      // Also trigger update via db
      toast({
        title: 'Widget Settings Saved',
        description: 'Live chat widget branding and greeting updated.',
      });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save Failed', description: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const embedSnippet = `<script src="${embedHost || 'https://your-domain.com'}/widget.js" defer></script>`;

  const copyEmbedSnippet = () => {
    navigator.clipboard.writeText(embedSnippet);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
    toast({ title: 'Embed Code Copied to Clipboard!' });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-headline flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            <span>Live Web Chat Widget</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            Embed a modern glassmorphic chat widget on any website to route visitor questions directly into AIWhisper.
          </p>
        </div>
        <Button onClick={handleSave} disabled={isSaving || isLoading} className="gap-1.5 self-start sm:self-auto">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span>Save Widget Settings</span>
        </Button>
      </div>

      {/* Embed Code Snippet Banner */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-primary" />
              <span>1-Line Website Embed Code</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={copyEmbedSnippet}
              className="h-7 text-xs gap-1.5 bg-background"
            >
              {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedCode ? 'Copied' : 'Copy Snippet'}</span>
            </Button>
          </CardTitle>
          <CardDescription className="text-xs">
            Paste this snippet before the closing <code>&lt;/body&gt;</code> tag on any website (WordPress, Shopify, Webflow, Next.js, HTML).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-1">
          <pre className="p-3 rounded-lg bg-black/80 text-emerald-400 font-mono text-xs overflow-x-auto border border-white/10 select-all">
            {embedSnippet}
          </pre>
        </CardContent>
      </Card>

      {/* Main Grid: Customizer on Left, Live Preview on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Customization Form */}
        <div className="lg:col-span-7 space-y-4">
          <Card>
            <CardHeader className="p-4 pb-3 border-b">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" />
                <span>Branding & Appearance</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="widget-title" className="text-xs">Widget Title</Label>
                <Input
                  id="widget-title"
                  value={config.title}
                  onChange={(e) => setConfig(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Chat with Support"
                  className="h-8 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="widget-color" className="text-xs">Primary Brand Color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      id="widget-color"
                      value={config.primaryColor}
                      onChange={(e) => setConfig(p => ({ ...p, primaryColor: e.target.value }))}
                      className="h-8 w-10 rounded border cursor-pointer bg-background p-0.5"
                    />
                    <Input
                      value={config.primaryColor}
                      onChange={(e) => setConfig(p => ({ ...p, primaryColor: e.target.value }))}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="bot-avatar" className="text-xs">Bot Avatar Emoji</Label>
                  <Input
                    id="bot-avatar"
                    value={config.botAvatar}
                    onChange={(e) => setConfig(p => ({ ...p, botAvatar: e.target.value }))}
                    placeholder="🤖"
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="widget-greeting" className="text-xs">Welcome Greeting Message</Label>
                <Textarea
                  id="widget-greeting"
                  value={config.greeting}
                  onChange={(e) => setConfig(p => ({ ...p, greeting: e.target.value }))}
                  placeholder="Hi there! 👋 How can we help you today?"
                  rows={3}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="widget-placeholder" className="text-xs">Input Placeholder Text</Label>
                <Input
                  id="widget-placeholder"
                  value={config.placeholder || ''}
                  onChange={(e) => setConfig(p => ({ ...p, placeholder: e.target.value }))}
                  placeholder="Type your message..."
                  className="h-8 text-xs"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Live Widget Interactive Preview */}
        <div className="lg:col-span-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5 text-primary" />
              <span>Live Visual Preview</span>
            </span>
            <a
              href="/widget"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
            >
              <span>Open in new tab</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="w-full h-[460px] rounded-2xl border shadow-lg overflow-hidden bg-slate-950 flex flex-col text-slate-100">
            {/* Header */}
            <div
              className="p-3 border-b border-white/10 flex items-center justify-between shrink-0"
              style={{ background: `linear-gradient(135deg, ${config.primaryColor}33 0%, #0f172a 100%)` }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ backgroundColor: config.primaryColor }}
                >
                  {config.botAvatar}
                </div>
                <div>
                  <h4 className="text-xs font-semibold">{config.title}</h4>
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online
                  </span>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="flex-1 p-3 space-y-2.5 overflow-y-auto bg-slate-900/60 text-xs">
              <div className="flex items-start gap-2 max-w-[85%]">
                <div
                  className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] shrink-0"
                  style={{ backgroundColor: config.primaryColor }}
                >
                  {config.botAvatar}
                </div>
                <div className="p-2.5 rounded-xl rounded-tl-sm bg-slate-800 border border-white/10 text-[11px] leading-relaxed">
                  {config.greeting}
                </div>
              </div>

              <div className="flex items-start gap-2 max-w-[85%] ml-auto justify-end">
                <div
                  className="p-2.5 rounded-xl rounded-tr-sm text-[11px] text-white"
                  style={{ backgroundColor: config.primaryColor }}
                >
                  I'd like to learn more about enterprise pricing.
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-2.5 border-t border-white/10 bg-slate-950 flex items-center gap-2">
              <input
                disabled
                placeholder={config.placeholder || 'Type your message...'}
                className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-400"
              />
              <div
                className="h-7 w-7 rounded-lg flex items-center justify-center text-white"
                style={{ backgroundColor: config.primaryColor }}
              >
                <Send className="h-3 w-3" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
