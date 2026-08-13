'use client';

import { useEffect, useState, useMemo } from 'react';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  ResponsiveContainer,
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
} from 'lucide-react';
import type { AnalyticsData, LogEntry } from '@/types';
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

export default function DashboardPage() {
  const [whatsAppState, setWhatsAppState] = useState<WhatsAppState | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [range, setRange] = useState<'today' | '7d' | '30d'>('7d');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const fetchAnalytics = async (selectedRange: 'today' | '7d' | '30d' = range, showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      const res = await fetch(`/api/analytics?range=${selectedRange}`);
      if (!res.ok) throw new Error('Failed to fetch analytics data');
      const data: AnalyticsData = await res.json();
      setAnalytics(data);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWhatsAppStatus();
    fetchAnalytics(range);

    const statusInterval = setInterval(fetchWhatsAppStatus, 5000);
    const dataInterval = setInterval(() => fetchAnalytics(range), 15000);

    return () => {
      clearInterval(statusInterval);
      clearInterval(dataInterval);
    };
  }, [range]);

  const handleRangeChange = (newRange: 'today' | '7d' | '30d') => {
    setRange(newRange);
    setIsLoading(true);
    fetchAnalytics(newRange);
  };

  const renderStatusBadge = () => {
    if (!whatsAppState) {
      return (
        <Badge className="border-yellow-600 bg-yellow-100 text-yellow-700 hover:bg-yellow-200">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Checking Status...
        </Badge>
      );
    }
    switch (whatsAppState.status) {
      case 'connected':
        return (
          <Badge className="border-green-600 bg-green-100 text-green-700 hover:bg-green-200">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Connected
          </Badge>
        );
      case 'connecting':
        return (
          <Badge className="border-blue-600 bg-blue-100 text-blue-700 hover:bg-blue-200">
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
    { title: 'Incoming Messages', value: analytics.kpis.incomingMessages, icon: ArrowDownRight, desc: 'From contacts' },
    { title: 'Outgoing Messages', value: analytics.kpis.outgoingMessages, icon: ArrowUpRight, desc: 'AI & Agent replies' },
    { title: 'AI Responses', value: analytics.kpis.aiResponses, icon: Bot, desc: 'Auto-generated by AI' },
    { title: 'Human Responses', value: analytics.kpis.humanResponses, icon: UserCheck, desc: 'Sent by operator' },
    { title: 'AI Response Failures', value: analytics.kpis.aiResponseFailures, icon: AlertTriangle, desc: 'Failed model executions' },
    { title: 'Active Agents', value: analytics.kpis.activeAgents, icon: Zap, desc: 'Configured AI bots' },
  ] : [];

  if (isLoading && !analytics) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-48" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Range Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">Agent Analytics Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Real-time performance metrics and system intelligence backed by Supabase.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border bg-muted p-1 text-xs">
            <button
              onClick={() => handleRangeChange('today')}
              className={`px-3 py-1.5 font-medium rounded-md transition-colors ${
                range === 'today' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => handleRangeChange('7d')}
              className={`px-3 py-1.5 font-medium rounded-md transition-colors ${
                range === '7d' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              7 Days
            </button>
            <button
              onClick={() => handleRangeChange('30d')}
              className={`px-3 py-1.5 font-medium rounded-md transition-colors ${
                range === '30d' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              30 Days
            </button>
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={() => fetchAnalytics(range, true)}
            disabled={isRefreshing}
            title="Refresh analytics data"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* PHASE 2 — 10 CORE KPI CARDS */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {kpiCards.map((stat) => (
          <Card key={stat.title} className="hover:border-primary/50 transition-colors">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value.toLocaleString()}</div>
              <p className="text-[11px] text-muted-foreground mt-1 truncate">{stat.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* CHARTS ROW 1: Message Volume & Conversation Analytics */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-7">
        {/* PHASE 4 — MESSAGE VOLUME */}
        <Card className="lg:col-span-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-5 w-5 text-primary" />
                Message Volume Over Time ({range === 'today' ? '24 Hours' : range === '30d' ? 'Last 30 Days' : 'Last 7 Days'})
              </CardTitle>
              <CardDescription>Incoming vs Outgoing message counts per day</CardDescription>
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

        {/* PHASE 3 — CONVERSATION ANALYTICS */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-5 w-5 text-primary" />
              Conversation Trends
            </CardTitle>
            <CardDescription>Daily new threads and resolution ratio</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/40 p-3 text-center">
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

      {/* CHARTS ROW 2: AI Performance & Knowledge/RAG */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* PHASE 5 — AI PERFORMANCE */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-5 w-5 text-amber-500" />
              AI Performance
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

            <div className="grid grid-cols-2 gap-3 text-sm pt-2">
              <div className="rounded-md border p-2.5">
                <div className="text-xs text-muted-foreground">AI vs Human Handling</div>
                <div className="font-semibold text-xs mt-1 truncate">{analytics?.aiPerformance.aiVsHumanRatio}</div>
              </div>
              <div className="rounded-md border p-2.5">
                <div className="text-xs text-muted-foreground">Human Takeovers</div>
                <div className="font-semibold text-xs mt-1">{analytics?.aiPerformance.humanTakeoverCount} total ({analytics?.aiPerformance.currentHumanTakeoverCount} active)</div>
              </div>
            </div>

            <div className="rounded-md bg-muted/50 p-3 text-xs flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-4 w-4" /> Average AI Response Time:
              </span>
              <span className="font-semibold">{analytics?.aiPerformance.avgResponseTimeFormatted}</span>
            </div>
          </CardContent>
        </Card>

        {/* PHASE 7 — KNOWLEDGE / RAG ANALYTICS */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BrainCircuit className="h-5 w-5 text-indigo-500" />
              Knowledge / RAG System
            </CardTitle>
            <CardDescription>Retrieval count & top knowledge sources</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center rounded-lg bg-muted/40 p-2.5">
              <div>
                <div className="text-lg font-bold">{analytics?.ragAnalytics.retrievalCount}</div>
                <div className="text-[10px] text-muted-foreground">Total Searches</div>
              </div>
              <div>
                <div className="text-lg font-bold text-green-600">{analytics?.ragAnalytics.successfulRetrievals}</div>
                <div className="text-[10px] text-muted-foreground">Context Found</div>
              </div>
              <div>
                <div className="text-lg font-bold text-amber-600">{analytics?.ragAnalytics.queriesWithNoKnowledge}</div>
                <div className="text-[10px] text-muted-foreground">No Context</div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">Top Knowledge Sources Used:</h4>
              {analytics?.ragAnalytics.sourcesUsed && analytics.ragAnalytics.sourcesUsed.length > 0 ? (
                <div className="space-y-1.5 text-xs">
                  {analytics.ragAnalytics.sourcesUsed.map((src) => (
                    <div key={src.sourceName} className="flex items-center justify-between rounded border px-2.5 py-1.5">
                      <span className="truncate flex items-center gap-1.5 font-medium">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" /> {src.sourceName}
                      </span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{src.count} queries</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic text-center py-4">No knowledge retrieval logs yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* PHASE 6 — ERROR ANALYTICS BREAKDOWN */}
        <Card className="md:col-span-2 lg:col-span-1">
          <CardHeader>
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
                <CheckCircle2 className="h-8 w-8 text-green-500" />
                <p className="font-medium text-foreground">Zero Errors Logged!</p>
                <p className="text-xs">System operating at 100% stability.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* PHASE 8 — AGENT PERFORMANCE TABLE */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-5 w-5 text-primary" />
            Agent Performance Overview
          </CardTitle>
          <CardDescription>Individual agent volume, handoffs, and activity status</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
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
                            ? 'border-green-600 bg-green-100 text-green-700'
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
        </CardContent>
      </Card>

      {/* BOTTOM ROW: Connection Status & Recent Error Logs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertOctagon className="h-5 w-5 text-destructive" /> Recent System Logs & Errors
            </CardTitle>
            <CardDescription>Latest system activity audit trail</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-headline">WhatsApp Channel Connection</CardTitle>
            <CardDescription>Authenticated WhatsApp account status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:text-left">
              <Avatar className="h-14 w-14">
                <AvatarImage
                  src={`https://ui-avatars.com/api/?name=${whatsAppState?.account?.name || '?'}&background=3F51B5&color=fff`}
                  alt={whatsAppState?.account?.name || ''}
                />
                <AvatarFallback>
                  {whatsAppState?.account ? whatsAppState.account.name.charAt(0) : '?'}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <p className="text-lg font-semibold">{whatsAppState?.account?.name || 'Not Connected'}</p>
                <p className="text-xs text-muted-foreground">{whatsAppState?.account?.id.split(':')[0] || '---'}</p>
                <div>{renderStatusBadge()}</div>
              </div>
            </div>
            {whatsAppState?.lastDisconnect && (
              <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                <p>
                  <strong>Last Disconnection:</strong> {format(new Date(whatsAppState.lastDisconnect.date), 'PPp')}
                </p>
                <p className="truncate">
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
