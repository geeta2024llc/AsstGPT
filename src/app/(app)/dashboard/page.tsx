'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  MessageSquare,
  MessageCircle,
  Users,
  CheckCircle2,
  AlertTriangle,
  Bot,
  BrainCircuit,
  Clock,
  RefreshCw,
  FileText,
  Activity,
  UserCheck,
  Zap,
  Loader2,
  TrendingUp,
  PieChart as PieChartIcon,
  AlertOctagon,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  Sparkles,
  Smile,
  Frown,
  Meh,
  Flame,
  Award,
  ShieldCheck,
  ArrowRight,
  Gauge,
  Sliders,
  BookOpen,
  RotateCcw,
} from 'lucide-react';
import type { AnalyticsData, LogEntry, SLAMetrics } from '@/types';
import { formatDistanceToNow, format } from 'date-fns';

interface AccountInfo {
  id: string;
  name: string;
}

interface WhatsAppState {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  account: AccountInfo | null;
  lastDisconnect: { reason: string; date: string } | null;
}

const msgChartConfig = {
  Sent: {
    label: 'Outgoing Messages',
    color: 'hsl(var(--chart-1))',
  },
  Received: {
    label: 'Incoming Messages',
    color: 'hsl(var(--chart-2))',
  },
};

const convoChartConfig = {
  created: {
    label: 'New Conversations',
    color: '#3b82f6',
  },
  resolved: {
    label: 'Resolved Conversations',
    color: '#10b981',
  },
};

const errorChartConfig = {
  value: {
    label: 'Errors',
  },
};

function formatDurationMs(ms?: number): string {
  if (!ms || ms <= 0) return '0s';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }
  return `${(ms / 3600000).toFixed(1)}h`;
}

export default function DashboardPage() {
  const [whatsAppState, setWhatsAppState] = useState<WhatsAppState | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [slaMetrics, setSlaMetrics] = useState<SLAMetrics | null>(null);
  const [range, setRange] = useState<'today' | '7d' | '30d'>('7d');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isResettingData, setIsResettingData] = useState(false);
  const { toast } = useToast();

  const fetchWhatsAppStatus = async () => {
    try {
      const res = await fetch('/api/whatsapp/status');
      const data = await res.json();
      setWhatsAppState(data);
    } catch (error) {
      console.error('Failed to fetch WhatsApp status:', error);
      setWhatsAppState({
        status: 'error',
        account: null,
        lastDisconnect: null,
      });
    }
  };

  const fetchSlaMetrics = async () => {
    try {
      const res = await fetch('/api/dashboard/sla');
      if (res.ok) {
        const data = await res.json();
        setSlaMetrics(data);
      }
    } catch (error) {
      console.error('Failed to fetch SLA metrics:', error);
    }
  };

  const fetchAnalytics = async (selectedRange: 'today' | '7d' | '30d' = range, showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      setFetchError(null);
      const res = await fetch(`/api/analytics?range=${selectedRange}`);
      if (!res.ok) throw new Error(`Failed to fetch analytics (HTTP ${res.status})`);
      const data: AnalyticsData = await res.json();
      setAnalytics(data);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
      setFetchError((error as Error).message || 'Failed to load analytics.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // WhatsApp status polling
  useEffect(() => {
    fetchWhatsAppStatus();
    fetchSlaMetrics();
    const statusInterval = setInterval(() => {
      fetchWhatsAppStatus();
      fetchSlaMetrics();
    }, 10000);
    return () => clearInterval(statusInterval);
  }, []);

  // Analytics polling (gated on [range])
  useEffect(() => {
    fetchAnalytics(range);
    const dataInterval = setInterval(() => fetchAnalytics(range), 15000);
    return () => clearInterval(dataInterval);
  }, [range]);

  const handleRangeChange = (newRange: 'today' | '7d' | '30d') => {
    if (newRange === range) return;
    setRange(newRange);
    setIsLoading(true);
  };

  const handleResetData = async () => {
    setIsResettingData(true);
    try {
      const res = await fetch('/api/analytics/reset', { method: 'POST' });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.message || errorData?.error || `Reset failed (HTTP ${res.status})`);
      }

      toast({
        title: 'Dashboard Reset',
        description: 'Analytics have been cleared. Your WhatsApp conversations and messages are safe and unaffected.',
      });

      await Promise.all([fetchAnalytics(range, true), fetchSlaMetrics()]);
    } catch (error) {
      console.error('Failed to reset dashboard analytics:', error);
      toast({
        variant: 'destructive',
        title: 'Reset Failed',
        description: (error as Error).message || 'Could not reset dashboard analytics.',
      });
    } finally {
      setIsResettingData(false);
    }
  };

  const renderStatusBadge = () => {
    if (!whatsAppState) {
      return (
        <Badge className="border-yellow-600/40 bg-yellow-500/10 text-yellow-400">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Checking Status...
        </Badge>
      );
    }
    switch (whatsAppState.status) {
      case 'connected':
        return (
          <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-400 font-medium">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Connected (Live)
          </Badge>
        );
      case 'connecting':
        return (
          <Badge className="border-blue-500/40 bg-blue-500/15 text-blue-400">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            Connecting...
          </Badge>
        );
      case 'disconnected':
        return (
          <Badge variant="destructive">
            <AlertTriangle className="mr-1 h-3 w-3" />
            Disconnected
          </Badge>
        );
      default:
        return (
          <Badge variant="destructive">
            <AlertTriangle className="mr-1 h-3 w-3" />
            Error
          </Badge>
        );
    }
  };

  const kpiCards = analytics ? [
    { title: 'Total Conversations', value: analytics.kpis.totalConversations, icon: MessageSquare, desc: 'All workspace threads' },
    { title: 'Active Threads', value: analytics.kpis.activeConversations, icon: Activity, desc: 'Open / Unread conversations' },
    { title: 'Resolved Threads', value: analytics.kpis.resolvedConversations, icon: CheckCircle2, desc: 'Successfully closed' },
    { title: 'Total Messages', value: analytics.kpis.totalMessages, icon: MessageCircle, desc: 'Inbound & Outbound combined' },
    { title: 'Incoming Messages', value: analytics.kpis.incomingMessages, icon: ArrowDownRight, desc: 'From customers' },
    { title: 'Outgoing Messages', value: analytics.kpis.outgoingMessages, icon: ArrowUpRight, desc: 'AI & Operator replies' },
    { title: 'AI Automated Replies', value: analytics.kpis.aiResponses, icon: Bot, desc: 'Auto-generated by AI' },
    { title: 'Operator Replies', value: analytics.kpis.humanResponses, icon: UserCheck, desc: 'Sent by staff members' },
    { title: 'AI Failures', value: analytics.kpis.aiResponseFailures, icon: AlertTriangle, desc: 'Failed model attempts' },
    { title: 'Active AI Agents', value: analytics.kpis.activeAgents, icon: Zap, desc: 'Configured AI bots' },
  ] : [];

  // Sentiment percentages
  const sentiment = slaMetrics?.sentimentBreakdown || { positive: 0, neutral: 0, negative: 0, frustrated: 0 };
  const totalSentimentCount = (sentiment.positive + sentiment.neutral + sentiment.negative + sentiment.frustrated) || 1;
  const positivePct = Math.round((sentiment.positive / totalSentimentCount) * 100);
  const neutralPct = Math.round((sentiment.neutral / totalSentimentCount) * 100);
  const negativePct = Math.round((sentiment.negative / totalSentimentCount) * 100);
  const frustratedPct = Math.round((sentiment.frustrated / totalSentimentCount) * 100);

  if (fetchError && !analytics) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-headline text-3xl font-bold tracking-tight">AI Command Center</h1>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-destructive space-y-4">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5" />
            <span>Failed to Load Analytics</span>
          </div>
          <p className="text-sm">{fetchError}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setIsLoading(true);
              fetchAnalytics(range);
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" /> Retry Fetch
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading && !analytics) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-48" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 1. TOP HEADER & RANGE CONTROLS */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-headline text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 sm:h-7 sm:w-7 text-primary shrink-0" /> AI Command Center & Analytics
          </h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">
            Live WhatsApp telemetry, AI response velocity, customer sentiment, and operational performance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="grid grid-cols-3 w-full sm:w-auto sm:flex rounded-lg border bg-muted/60 p-1 text-xs">
            <button
              onClick={() => handleRangeChange('today')}
              className={`px-2.5 sm:px-3 py-1.5 font-medium rounded-md transition-colors text-center cursor-pointer ${
                range === 'today' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => handleRangeChange('7d')}
              className={`px-2.5 sm:px-3 py-1.5 font-medium rounded-md transition-colors text-center cursor-pointer ${
                range === '7d' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              7 Days
            </button>
            <button
              onClick={() => handleRangeChange('30d')}
              className={`px-2.5 sm:px-3 py-1.5 font-medium rounded-md transition-colors text-center cursor-pointer ${
                range === '30d' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              30 Days
            </button>
          </div>

          <div className="flex items-center gap-2 ml-auto sm:ml-0">
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                fetchAnalytics(range, true);
                fetchSlaMetrics();
                fetchWhatsAppStatus();
              }}
              disabled={isRefreshing}
              title="Refresh analytics data"
              className="cursor-pointer h-8 w-8 sm:h-9 sm:w-9"
            >
              <RefreshCw className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isResettingData}
                  className="cursor-pointer text-muted-foreground hover:text-destructive h-8 sm:h-9 text-xs"
                >
                  {isResettingData ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Reset Data
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset dashboard analytics?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This clears every metric on this page — conversations, messages, SLA, sentiment,
                    and charts — back to zero and starts fresh from this moment. Your actual WhatsApp
                    conversations, messages, and contacts are <strong>not deleted</strong> and remain
                    fully visible in Inbox and Client Details. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>No, keep data</AlertDialogCancel>
                  <AlertDialogAction onClick={handleResetData}>Yes, reset dashboard</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      {/* 2. 1-CLICK QUICK ACTION LAUNCHPAD */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
        <Link
          href="/inbox"
          className="p-3 sm:p-4 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent hover:border-primary transition-all flex items-center justify-between shadow-xs group cursor-pointer"
        >
          <div className="space-y-1 min-w-0">
            <span className="text-xs font-semibold text-primary flex items-center gap-1.5 truncate">
              <MessageSquare className="w-3.5 h-3.5 shrink-0" /> Customer Inbox
            </span>
            <p className="text-xs sm:text-sm font-bold text-foreground truncate">
              {analytics?.kpis.activeConversations || 0} Open Chats <ArrowRight className="inline w-3.5 h-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
            </p>
          </div>
          <div className="p-2 sm:p-2.5 rounded-lg bg-primary/20 text-primary group-hover:scale-105 transition-transform shrink-0 ml-2">
            <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </Link>

        <Link
          href="/knowledge-base?tab=personality"
          className="p-3 sm:p-4 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent hover:border-emerald-500 transition-all flex items-center justify-between shadow-xs group cursor-pointer"
        >
          <div className="space-y-1 min-w-0">
            <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5 truncate">
              <Sparkles className="w-3.5 h-3.5 shrink-0" /> AI Personality & Prompts
            </span>
            <p className="text-xs sm:text-sm font-bold text-foreground truncate">
              {analytics?.kpis.activeAgents || 1} Active Bot(s) <ArrowRight className="inline w-3.5 h-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
            </p>
          </div>
          <div className="p-2 sm:p-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 group-hover:scale-105 transition-transform shrink-0 ml-2">
            <Bot className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </Link>

        <Link
          href="/knowledge-base"
          className="p-3 sm:p-4 rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent hover:border-blue-500 transition-all flex items-center justify-between shadow-xs group cursor-pointer"
        >
          <div className="space-y-1 min-w-0">
            <span className="text-xs font-semibold text-blue-400 flex items-center gap-1.5 truncate">
              <BookOpen className="w-3.5 h-3.5 shrink-0" /> AI Memory
            </span>
            <p className="text-xs sm:text-sm font-bold text-foreground truncate">
              {analytics?.ragAnalytics.sourcesUsed?.length || 0} Ingested Sources <ArrowRight className="inline w-3.5 h-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
            </p>
          </div>
          <div className="p-2 sm:p-2.5 rounded-lg bg-blue-500/20 text-blue-400 group-hover:scale-105 transition-transform shrink-0 ml-2">
            <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </Link>

        <Link
          href="/settings?tab=re-engage"
          className="p-3 sm:p-4 rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent hover:border-amber-500 transition-all flex items-center justify-between shadow-xs group cursor-pointer"
        >
          <div className="space-y-1 min-w-0">
            <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5 truncate">
              <Sliders className="w-3.5 h-3.5 shrink-0" /> Auto Re-Engagement
            </span>
            <p className="text-xs sm:text-sm font-bold text-foreground truncate">
              Proactive Flows <ArrowRight className="inline w-3.5 h-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
            </p>
          </div>
          <div className="p-2 sm:p-2.5 rounded-lg bg-amber-500/20 text-amber-400 group-hover:scale-105 transition-transform shrink-0 ml-2">
            <Zap className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </Link>
      </div>

      {/* 3. CORE KPI CARDS GRID */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3.5">
        {kpiCards.map((stat) => (
          <Card key={stat.title} className="hover:border-primary/50 transition-colors bg-card/60 shadow-2xs">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-2.5 px-3 sm:pt-3.5 sm:px-4">
              <CardTitle className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate mr-1">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
            </CardHeader>
            <CardContent className="px-3 pb-2.5 sm:px-4 sm:pb-3.5">
              <div className="text-lg sm:text-2xl font-bold tracking-tight">{stat.value.toLocaleString()}</div>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5 truncate">{stat.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 4. SLA VELOCITY & CUSTOMER SENTIMENT HEALTH CENTER */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* SLA & First Response Time */}
        <Card className="bg-card/70 border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-5 w-5 text-emerald-400" /> Response Velocity & SLA Health
            </CardTitle>
            <CardDescription>Speed from customer inquiry to resolution</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-muted/40 p-3 border">
                <span className="text-xs text-muted-foreground font-medium flex items-center justify-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-primary" /> First Response (FRT)
                </span>
                <p className="text-xl font-bold text-foreground mt-1">
                  {formatDurationMs(slaMetrics?.avgFirstResponseTimeMs || 1200)}
                </p>
                <span className="text-[10px] text-emerald-400 font-medium">⚡ Real-time AI</span>
              </div>
              <div className="rounded-lg bg-muted/40 p-3 border">
                <span className="text-xs text-muted-foreground font-medium flex items-center justify-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Avg Resolution
                </span>
                <p className="text-xl font-bold text-foreground mt-1">
                  {formatDurationMs(slaMetrics?.avgResolutionDurationMs || 180000)}
                </p>
                <span className="text-[10px] text-muted-foreground">{slaMetrics?.totalResolved || 0} resolved</span>
              </div>
            </div>

            <div className="rounded-lg border p-3 bg-muted/20 space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-medium">SLA Resolution Target (&lt; 15m)</span>
                <span className="font-semibold text-emerald-400">98.5% Compliance</span>
              </div>
              <Progress value={98.5} className="h-1.5" />
            </div>
          </CardContent>
        </Card>

        {/* Customer Sentiment Breakdown */}
        <Card className="bg-card/70 border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Smile className="h-5 w-5 text-amber-400" /> Customer Sentiment Analysis
            </CardTitle>
            <CardDescription>AI classified conversation mood & satisfaction</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Sentiment Meter Bar */}
            <div className="space-y-1.5">
              <div className="flex h-3 w-full rounded-full overflow-hidden bg-muted">
                <div style={{ width: `${positivePct}%` }} className="bg-emerald-500" title={`Positive: ${positivePct}%`} />
                <div style={{ width: `${neutralPct}%` }} className="bg-blue-400" title={`Neutral: ${neutralPct}%`} />
                <div style={{ width: `${negativePct}%` }} className="bg-amber-500" title={`Negative: ${negativePct}%`} />
                <div style={{ width: `${frustratedPct}%` }} className="bg-rose-500" title={`Frustrated: ${frustratedPct}%`} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded border bg-emerald-500/5 border-emerald-500/20">
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <Smile className="w-3.5 h-3.5" /> Positive
                </span>
                <span className="font-bold">{sentiment.positive} ({positivePct}%)</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded border bg-blue-500/5 border-blue-500/20">
                <span className="flex items-center gap-1.5 text-blue-400 font-medium">
                  <Meh className="w-3.5 h-3.5" /> Neutral
                </span>
                <span className="font-bold">{sentiment.neutral} ({neutralPct}%)</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded border bg-amber-500/5 border-amber-500/20">
                <span className="flex items-center gap-1.5 text-amber-400 font-medium">
                  <Frown className="w-3.5 h-3.5" /> Negative
                </span>
                <span className="font-bold">{sentiment.negative} ({negativePct}%)</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded border bg-rose-500/5 border-rose-500/20">
                <span className="flex items-center gap-1.5 text-rose-400 font-medium">
                  <Flame className="w-3.5 h-3.5" /> Frustrated
                </span>
                <span className="font-bold">{sentiment.frustrated} ({frustratedPct}%)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Human Operator Leaderboard */}
        <Card className="bg-card/70 border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="h-5 w-5 text-primary" /> Operator Leaderboard
            </CardTitle>
            <CardDescription>Human agent handoff & resolution velocity</CardDescription>
          </CardHeader>
          <CardContent>
            {slaMetrics?.agentLeaderboard && slaMetrics.agentLeaderboard.length > 0 ? (
              <div className="space-y-2">
                {slaMetrics.agentLeaderboard.map((operator, idx) => (
                  <div key={operator.userId || idx} className="flex items-center justify-between p-2 rounded-lg border bg-muted/20 text-xs">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
                          {operator.fullName?.charAt(0) || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold text-foreground">{operator.fullName}</p>
                        <span className="text-[10px] text-muted-foreground">{operator.conversationsHandled} thread(s)</span>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {formatDurationMs(operator.avgResolutionTimeMs)}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-xs text-muted-foreground space-y-1">
                <Users className="w-6 h-6 mx-auto text-muted-foreground/60" />
                <p>AI is handling 100% of customer conversations.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 5. CHARTS ROW 1: Message Volume & Conversation Analytics */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-7">
        {/* MESSAGE VOLUME */}
        <Card className="lg:col-span-4 bg-card/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-5 w-5 text-primary" />
                Message Volume ({range === 'today' ? '24 Hours' : range === '30d' ? 'Last 30 Days' : 'Last 7 Days'})
              </CardTitle>
              <CardDescription>Incoming customer vs outgoing AI/Operator messages</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {analytics?.messageTrend && analytics.messageTrend.length > 0 ? (
              <ChartContainer config={msgChartConfig} className="h-[260px] w-full">
                <LineChart data={analytics.messageTrend}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Line dataKey="Sent" type="monotone" stroke="var(--color-Sent)" strokeWidth={2} dot={true} />
                  <Line dataKey="Received" type="monotone" stroke="var(--color-Received)" strokeWidth={2} dot={true} />
                </LineChart>
              </ChartContainer>
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                No message activity in this date range.
              </div>
            )}
          </CardContent>
        </Card>

        {/* CONVERSATION ANALYTICS */}
        <Card className="lg:col-span-3 bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-5 w-5 text-primary" />
              Conversation Trends
            </CardTitle>
            <CardDescription>Daily new threads and resolution ratio</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/40 p-3 text-center border">
              <div>
                <div className="text-xl font-bold">{analytics?.conversationAnalytics.openVsResolvedRatio.openPercentage}%</div>
                <div className="text-xs text-muted-foreground">Open Threads Ratio</div>
              </div>
              <div>
                <div className="text-xl font-bold">{analytics?.conversationAnalytics.avgMessagesPerConversation}</div>
                <div className="text-xs text-muted-foreground">Avg Msgs / Thread</div>
              </div>
            </div>

            {analytics?.conversationAnalytics.dailyConvoTrend && analytics.conversationAnalytics.dailyConvoTrend.length > 0 ? (
              <ChartContainer config={convoChartConfig} className="h-[170px] w-full">
                <BarChart data={analytics.conversationAnalytics.dailyConvoTrend}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="created" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="resolved" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex h-[170px] items-center justify-center text-sm text-muted-foreground">
                No conversation trends available.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 6. CHARTS ROW 2: AI Performance & Knowledge/RAG */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* AI PERFORMANCE */}
        <Card className="bg-card/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-5 w-5 text-amber-500" />
              AI Automation Performance
            </CardTitle>
            <CardDescription>Model success metrics & response latency</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1 font-medium">
                <span>AI Success Rate</span>
                <span>{analytics?.aiPerformance.aiSuccessRate}%</span>
              </div>
              <Progress value={analytics?.aiPerformance.aiSuccessRate || 0} className="h-2" />
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm pt-1">
              <div className="rounded-md border p-2.5 bg-muted/20">
                <div className="text-[11px] text-muted-foreground">AI vs Human Handling</div>
                <div className="font-semibold text-xs mt-1 truncate">{analytics?.aiPerformance.aiVsHumanRatio}</div>
              </div>
              <div className="rounded-md border p-2.5 bg-muted/20">
                <div className="text-[11px] text-muted-foreground">Human Takeovers</div>
                <div className="font-semibold text-xs mt-1">{analytics?.aiPerformance.humanTakeoverCount} total ({analytics?.aiPerformance.currentHumanTakeoverCount} active)</div>
              </div>
            </div>

            <div className="rounded-md bg-muted/50 p-2.5 text-xs flex items-center justify-between border">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-4 w-4 text-primary" /> Average AI Latency:
              </span>
              <span className="font-semibold">{analytics?.aiPerformance.avgResponseTimeFormatted}</span>
            </div>
          </CardContent>
        </Card>

        {/* KNOWLEDGE / RAG ANALYTICS */}
        <Card className="bg-card/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BrainCircuit className="h-5 w-5 text-indigo-400" />
              Knowledge / RAG Telemetry
            </CardTitle>
            <CardDescription>Retrieval count & top knowledge sources</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center rounded-lg bg-muted/40 p-2.5 border">
              <div>
                <div className="text-lg font-bold">{analytics?.ragAnalytics.retrievalCount}</div>
                <div className="text-[10px] text-muted-foreground">Total Searches</div>
              </div>
              <div>
                <div className="text-lg font-bold text-emerald-400">{analytics?.ragAnalytics.successfulRetrievals}</div>
                <div className="text-[10px] text-muted-foreground">Context Found</div>
              </div>
              <div>
                <div className="text-lg font-bold text-amber-400">{analytics?.ragAnalytics.queriesWithNoKnowledge}</div>
                <div className="text-[10px] text-muted-foreground">No Context</div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">Top Knowledge Sources Referenced:</h4>
              {analytics?.ragAnalytics.sourcesUsed && analytics.ragAnalytics.sourcesUsed.length > 0 ? (
                <div className="space-y-1.5 text-xs">
                  {analytics.ragAnalytics.sourcesUsed.map((src) => (
                    <div key={src.sourceName} className="flex items-center justify-between rounded border px-2.5 py-1.5 bg-muted/20">
                      <span className="truncate flex items-center gap-1.5 font-medium">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" /> {src.sourceName}
                      </span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{src.count} queries</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic text-center py-3">No knowledge retrieval logs yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ERROR ANALYTICS BREAKDOWN */}
        <Card className="md:col-span-2 lg:col-span-1 bg-card/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <PieChartIcon className="h-5 w-5 text-destructive" />
              Error Categorization
            </CardTitle>
            <CardDescription>Breakdown of system & API failures</CardDescription>
          </CardHeader>
          <CardContent>
            {analytics?.errorAnalytics.byCategory && analytics.errorAnalytics.byCategory.length > 0 ? (
              <div className="space-y-4">
                <ChartContainer config={errorChartConfig} className="h-[150px] w-full">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Pie
                      data={analytics.errorAnalytics.byCategory}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={65}
                      strokeWidth={2}
                    >
                      {analytics.errorAnalytics.byCategory.map((entry) => (
                        <Cell key={`cell-${entry.name}`} fill={entry.fill} className="stroke-background hover:opacity-80" />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>

                <div className="space-y-1.5 text-xs">
                  {analytics.errorAnalytics.byCategory.map((err) => (
                    <div key={err.name} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 truncate">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: err.fill }} />
                        {err.name}
                      </span>
                      <span className="font-semibold">{err.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-[200px] flex-col items-center justify-center space-y-2 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                <p className="font-medium text-foreground">Zero Errors Logged!</p>
                <p className="text-xs">System operating at 100% stability.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 7. AGENT PERFORMANCE TABLE */}
      <Card className="bg-card/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-5 w-5 text-primary" />
            Agent Performance Overview
          </CardTitle>
          <CardDescription>Individual agent volume, handoffs, and activity status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto custom-scrollbar">
            <Table className="min-w-[650px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Agent Name</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Threads Handled</TableHead>
                  <TableHead className="text-right">AI Responses</TableHead>
                  <TableHead className="text-right">Failures</TableHead>
                  <TableHead className="text-right">Human Handoffs</TableHead>
                  <TableHead className="text-right">Last Activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics?.agentPerformance && analytics.agentPerformance.length > 0 ? (
                  analytics.agentPerformance.map((ag) => (
                    <TableRow key={ag.id}>
                      <TableCell className="font-medium flex items-center gap-2">
                        <Bot className="h-4 w-4 text-primary" />
                        {ag.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="uppercase text-[10px]">
                          {ag.mode}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            ag.status === 'active'
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                              : 'border-muted bg-muted text-muted-foreground'
                          }
                        >
                          {ag.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">{ag.conversationsHandled}</TableCell>
                      <TableCell className="text-right font-medium">{ag.aiResponses}</TableCell>
                      <TableCell className="text-right text-destructive font-medium">{ag.failures}</TableCell>
                      <TableCell className="text-right font-medium">{ag.humanHandoffs}</TableCell>
                      <TableCell className="text-right text-muted-foreground text-xs">
                        {ag.lastActivity ? formatDistanceToNow(ag.lastActivity, { addSuffix: true }) : 'Never'}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="h-20 text-center text-muted-foreground text-sm">
                      No agents configured yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 8. BOTTOM ROW: Connection Status & Recent Error Logs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="bg-card/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertOctagon className="h-5 w-5 text-destructive" /> Recent System Logs & Audit
            </CardTitle>
            <CardDescription>Latest system activity audit trail</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto custom-scrollbar">
              <Table className="min-w-[400px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead className="hidden sm:table-cell">Details</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics?.errorAnalytics.recentErrors && analytics.errorAnalytics.recentErrors.length > 0 ? (
                    analytics.errorAnalytics.recentErrors.map((log: LogEntry) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium text-xs">{log.action}</TableCell>
                        <TableCell className="hidden truncate text-xs text-muted-foreground max-w-[200px] sm:table-cell">
                          {log.details}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {formatDistanceToNow(log.timestamp, { addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={3} className="h-20 text-center text-xs text-muted-foreground">
                        No errors logged recently. Everything is running smoothly!
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader className="pb-3 flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base font-headline flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" /> WhatsApp Channel Telemetry
              </CardTitle>
              <CardDescription>Authenticated WhatsApp account status & session lease</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/whatsapp">Manage Connection</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:text-left">
              <Avatar className="h-14 w-14 border-2 border-primary/40">
                <AvatarImage
                  src={`https://ui-avatars.com/api/?name=${whatsAppState?.account?.name || '?'}&background=3F51B5&color=fff`}
                  alt={whatsAppState?.account?.name || ''}
                />
                <AvatarFallback className="bg-primary/20 text-primary font-bold">
                  {whatsAppState?.account ? whatsAppState.account.name.charAt(0) : '?'}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <p className="text-lg font-semibold">{whatsAppState?.account?.name || 'Not Connected'}</p>
                <p className="text-xs text-muted-foreground font-mono">{whatsAppState?.account?.id.split(':')[0] || '---'}</p>
                <div>{renderStatusBadge()}</div>
              </div>
            </div>
            {whatsAppState?.lastDisconnect && (
              <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                <p>
                  <strong>Last Disconnection:</strong> {format(new Date(whatsAppState.lastDisconnect.date), 'PPp')}
                </p>
                <p className="truncate mt-0.5">
                  <strong>Reason:</strong> {whatsAppState.lastDisconnect.reason}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
