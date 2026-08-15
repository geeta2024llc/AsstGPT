'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  QrCode,
  MessageSquare,
  Webhook,
  ShieldAlert,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Radio,
  ArrowRight,
  Sparkles,
  Layers,
  PhoneCall,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ChannelsIntegrationCard({
  onSwitchTab,
}: {
  onSwitchTab?: (tab: string) => void;
}) {
  const [waStatus, setWaStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [waPhone, setWaPhone] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/whatsapp/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 'connected') {
          setWaStatus('connected');
          setWaPhone(data.phone || null);
        } else if (data.status === 'connecting' || data.status === 'qr_ready') {
          setWaStatus('connecting');
        } else {
          setWaStatus('disconnected');
        }
      })
      .catch(() => setWaStatus('disconnected'))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Channel 1: WhatsApp Business Gateway */}
        <Card className="border-border/70 shadow-sm relative overflow-hidden bg-card/60 backdrop-blur-sm flex flex-col justify-between">
          <div className="absolute top-0 right-0 h-20 w-20 bg-emerald-500/10 rounded-full blur-2xl -mr-6 -mt-6" />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                <QrCode className="h-5 w-5" />
              </div>
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] px-2 py-0.5 font-bold flex items-center gap-1 uppercase',
                  waStatus === 'connected'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                    : waStatus === 'connecting'
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 animate-pulse'
                    : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
                )}
              >
                {waStatus === 'connected' ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live Connected
                  </>
                ) : waStatus === 'connecting' ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Pairing Required
                  </>
                ) : (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Offline / Disconnected
                  </>
                )}
              </Badge>
            </div>
            <CardTitle className="text-base font-bold mt-2">WhatsApp Gateway</CardTitle>
            <CardDescription className="text-xs">
              Primary multi-device Baileys WhatsApp channel for customer chats, AI memory RAG, and CRM auto-capture.
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-3 text-xs text-muted-foreground">
            {waPhone ? (
              <p className="font-mono text-foreground font-semibold flex items-center gap-1">
                <PhoneCall className="h-3.5 w-3.5 text-emerald-500" />
                <span>{waPhone}</span>
              </p>
            ) : (
              <p>Scan the WhatsApp QR code to link your business phone number.</p>
            )}
          </CardContent>
          <CardFooter className="pt-0 border-t bg-muted/10 p-3">
            <Button asChild size="sm" className="w-full text-xs font-semibold gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer">
              <Link href="/whatsapp">
                <QrCode className="h-3.5 w-3.5" />
                <span>{waStatus === 'connected' ? 'Manage Connection' : 'Connect WhatsApp'}</span>
                <ArrowRight className="h-3 w-3 ml-auto" />
              </Link>
            </Button>
          </CardFooter>
        </Card>

        {/* Channel 2: Live Web Chat Widget */}
        <Card className="border-border/70 shadow-sm relative overflow-hidden bg-card/60 backdrop-blur-sm flex flex-col justify-between">
          <div className="absolute top-0 right-0 h-20 w-20 bg-indigo-500/10 rounded-full blur-2xl -mr-6 -mt-6" />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                <MessageSquare className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-semibold bg-indigo-500/10 text-indigo-500 border-indigo-500/30">
                Embeddable
              </Badge>
            </div>
            <CardTitle className="text-base font-bold mt-2">Live Web Chat Widget</CardTitle>
            <CardDescription className="text-xs">
              Lightweight JavaScript embed script to add instant AI customer support to your website or portal.
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-3 text-xs text-muted-foreground">
            <p>Customizable branding colors, bot greeting messages, and real-time operator handoff.</p>
          </CardContent>
          <CardFooter className="pt-0 border-t bg-muted/10 p-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSwitchTab?.('widget')}
              className="w-full text-xs font-semibold gap-1.5 cursor-pointer"
            >
              <MessageSquare className="h-3.5 w-3.5 text-indigo-500" />
              <span>Configure Chat Widget</span>
              <ArrowRight className="h-3 w-3 ml-auto" />
            </Button>
          </CardFooter>
        </Card>

        {/* Channel 3: Outbound Webhooks & REST APIs */}
        <Card className="border-border/70 shadow-sm relative overflow-hidden bg-card/60 backdrop-blur-sm flex flex-col justify-between">
          <div className="absolute top-0 right-0 h-20 w-20 bg-purple-500/10 rounded-full blur-2xl -mr-6 -mt-6" />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-500 border border-purple-500/20">
                <Webhook className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-semibold bg-purple-500/10 text-purple-500 border-purple-500/30">
                HTTP Webhooks
              </Badge>
            </div>
            <CardTitle className="text-base font-bold mt-2">Webhooks & API Events</CardTitle>
            <CardDescription className="text-xs">
              Broadcast real-time customer events (handoff, resolution, CRM updates) to external systems & CRMs.
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-3 text-xs text-muted-foreground">
            <p>HMAC SHA-256 signed payloads with automated retry queues and event simulation.</p>
          </CardContent>
          <CardFooter className="pt-0 border-t bg-muted/10 p-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSwitchTab?.('webhooks')}
              className="w-full text-xs font-semibold gap-1.5 cursor-pointer"
            >
              <Webhook className="h-3.5 w-3.5 text-purple-500" />
              <span>Manage Webhooks</span>
              <ArrowRight className="h-3 w-3 ml-auto" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
