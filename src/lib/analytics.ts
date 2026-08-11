if (typeof window !== 'undefined') {
  throw new Error('CRITICAL SECURITY ERROR: src/lib/analytics.ts is a server-only module and cannot be imported in client components.');
}

import { getSupabaseAdmin } from './supabase';
import type { 
  AnalyticsData, 
  TimeSeriesDataPoint, 
  ErrorBreakdownPoint, 
  KnowledgeUsagePoint, 
  AgentMetricPoint,
  LogEntry
} from '@/types';
import { subDays, startOfDay, format, parseISO } from 'date-fns';

function getDefaultTenantId(): string {
  const tenantId = process.env.DEFAULT_TENANT_ID;
  if (!tenantId) {
    throw new Error('CRITICAL CONFIGURATION ERROR: DEFAULT_TENANT_ID environment variable is missing.');
  }
  return tenantId;
}

function categorizeError(action: string, details: string): string {
  const act = (action || '').toLowerCase();
  const det = (details || '').toLowerCase();

  if (det.includes('429') || det.includes('rate') || det.includes('quota')) return 'Rate Limit';
  if (act.includes('gemini') || det.includes('gemini') || det.includes('api key') || act.includes('ai response failed')) return 'Gemini / API';
  if (act.includes('rag') || act.includes('knowledge') || det.includes('retrieval')) return 'RAG / Retrieval';
  if (act.includes('whatsapp') || det.includes('baileys') || act.includes('disconnect') || det.includes('connection')) return 'WhatsApp / Network';
  if (det.includes('config') || det.includes('missing') || det.includes('env')) return 'Configuration';
  if (det.includes('database') || det.includes('supabase') || det.includes('constraint')) return 'Database';

  return 'Other';
}

const CATEGORY_COLORS: Record<string, string> = {
  'Rate Limit': 'hsl(var(--chart-1))',
  'Gemini / API': 'hsl(var(--chart-2))',
  'RAG / Retrieval': 'hsl(var(--chart-3))',
  'WhatsApp / Network': 'hsl(var(--chart-4))',
  'Configuration': 'hsl(var(--chart-5))',
  'Database': '#f59e0b',
  'Other': '#6b7280',
};

export async function getAnalyticsData(range: 'today' | '7d' | '30d' = '7d'): Promise<AnalyticsData> {
  const supabase = getSupabaseAdmin();
  const tenantId = getDefaultTenantId();

  const now = new Date();
  let days = 7;
  if (range === 'today') days = 1;
  if (range === '30d') days = 30;

  const startDate = subDays(startOfDay(now), days - 1);
  const startDateIso = startDate.toISOString();

  // Execute high-performance tenant-isolated queries in parallel
  const [
    convosCountRes,
    activeConvosCountRes,
    resolvedConvosCountRes,
    messagesCountRes,
    incomingMsgsRes,
    outgoingMsgsRes,
    aiResponsesLogRes,
    aiFailuresLogRes,
    activeAgentsRes,
    allAgentsRes,
    convosListRes,
    messagesListRes,
    auditLogsRes,
  ] = await Promise.all([
    // 1. Total conversations
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    // 2. Active conversations (unread > 0 or unassigned / open)
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).or('unread_count.gt.0,status.eq.open'),
    // 3. Resolved conversations
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'resolved'),
    // 4. Total messages
    supabase.from('messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    // 5. Incoming messages
    supabase.from('messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('from_me', false),
    // 6. Outgoing messages
    supabase.from('messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('from_me', true),
    // 7. AI response logs
    supabase.from('audit_logs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('action', ['Auto-response Sent', 'AI Response Generated']),
    // 8. AI failure logs
    supabase.from('audit_logs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('action', ['AI Response Failed', 'Auto-response Failed']),
    // 9. Active agents count
    supabase.from('agents').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'active'),
    // 10. All agents list
    supabase.from('agents').select('id, name, mode, status, created_at').eq('tenant_id', tenantId),
    // 11. Convos bounded list for date trends
    supabase.from('conversations').select('id, assigned_agent_id, unread_count, status, created_at, updated_at').eq('tenant_id', tenantId),
    // 12. Messages within date range for trend chart
    supabase.from('messages').select('id, from_me, created_at, sender_name').eq('tenant_id', tenantId).gte('created_at', startDateIso).order('created_at', { ascending: true }),
    // 13. Audit logs within date range
    supabase.from('audit_logs').select('id, user_name, action, details, log_type, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(200),
  ]);

  const totalConversations = convosCountRes.count || 0;
  const activeConversations = activeConvosCountRes.count || 0;
  const resolvedConversations = resolvedConvosCountRes.count || 0;
  const totalMessages = messagesCountRes.count || 0;
  const incomingMessages = incomingMsgsRes.count || 0;
  const outgoingMessages = outgoingMsgsRes.count || 0;
  const aiResponses = aiResponsesLogRes.count || 0;
  const aiResponseFailures = aiFailuresLogRes.count || 0;
  const activeAgents = activeAgentsRes.count || 0;
  const humanResponses = Math.max(0, outgoingMessages - aiResponses);

  // --- Message Volume Trend (by date) ---
  const messageTrendMap: Record<string, { Sent: number; Received: number }> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = subDays(now, i);
    const dateKey = format(d, 'MMM d');
    messageTrendMap[dateKey] = { Sent: 0, Received: 0 };
  }

  const rangeMessages = messagesListRes.data || [];
  rangeMessages.forEach((m: any) => {
    const dateKey = format(parseISO(m.created_at), 'MMM d');
    if (messageTrendMap[dateKey]) {
      if (m.from_me) messageTrendMap[dateKey].Sent++;
      else messageTrendMap[dateKey].Received++;
    }
  });

  const messageTrend: TimeSeriesDataPoint[] = Object.entries(messageTrendMap).map(([date, counts]) => ({
    date,
    Sent: counts.Sent,
    Received: counts.Received,
  }));

  // --- Daily Conversation Trend ---
  const dailyConvoMap: Record<string, { created: number; resolved: number }> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = subDays(now, i);
    const dateKey = format(d, 'MMM d');
    dailyConvoMap[dateKey] = { created: 0, resolved: 0 };
  }

  const convos = convosListRes.data || [];
  convos.forEach((c: any) => {
    const createdKey = format(parseISO(c.created_at), 'MMM d');
    if (dailyConvoMap[createdKey]) {
      dailyConvoMap[createdKey].created++;
    }
    if (c.status === 'resolved' && c.updated_at) {
      const resolvedKey = format(parseISO(c.updated_at), 'MMM d');
      if (dailyConvoMap[resolvedKey]) {
        dailyConvoMap[resolvedKey].resolved++;
      }
    }
  });

  const dailyConvoTrend = Object.entries(dailyConvoMap).map(([date, val]) => ({
    date,
    created: val.created,
    resolved: val.resolved,
  }));

  // --- Open vs Resolved Ratio ---
  const openCount = totalConversations - resolvedConversations;
  const openPercentage = totalConversations > 0 ? Math.round((openCount / totalConversations) * 100) : 100;
  const avgMessagesPerConversation = totalConversations > 0 ? Number((totalMessages / totalConversations).toFixed(1)) : 0;

  // --- AI Performance ---
  const totalAIAttempts = aiResponses + aiResponseFailures;
  const aiSuccessRate = totalAIAttempts > 0 ? Math.round((aiResponses / totalAIAttempts) * 100) : 100;
  
  const currentHumanTakeoverCount = convos.filter((c: any) => c.assigned_agent_id === null || c.assigned_agent_id === '').length;
  
  const logs = auditLogsRes.data || [];
  const humanTakeoverLogs = logs.filter((l: any) => l.action === 'AI Response Skipped');
  const humanTakeoverCount = humanTakeoverLogs.length || currentHumanTakeoverCount;

  const totalHandled = aiResponses + humanResponses;
  const aiRatioPct = totalHandled > 0 ? Math.round((aiResponses / totalHandled) * 100) : 100;
  const aiVsHumanRatio = `${aiRatioPct}% AI / ${100 - aiRatioPct}% Human`;

  // --- Average AI Response Latency Calculation ---
  let avgResponseTimeSeconds: number | null = null;
  let avgResponseTimeFormatted = 'Not currently measurable from existing data';

  const rxLogs = logs.filter((l: any) => l.action === 'WhatsApp Message Received');
  const txLogs = logs.filter((l: any) => l.action === 'Auto-response Sent' || l.action === 'AI Response Generated');

  if (rxLogs.length > 0 && txLogs.length > 0) {
    const latencies: number[] = [];
    txLogs.forEach((tx: any) => {
      const txTime = new Date(tx.created_at).getTime();
      const prevRx = rxLogs.find((rx: any) => {
        const rxTime = new Date(rx.created_at).getTime();
        const diff = txTime - rxTime;
        return diff > 0 && diff < 60000;
      });
      if (prevRx) {
        latencies.push((txTime - new Date(prevRx.created_at).getTime()) / 1000);
      }
    });

    if (latencies.length > 0) {
      const sum = latencies.reduce((a, b) => a + b, 0);
      avgResponseTimeSeconds = Number((sum / latencies.length).toFixed(1));
      avgResponseTimeFormatted = `${avgResponseTimeSeconds}s`;
    }
  }

  // --- Error Analytics ---
  const errorLogs = logs.filter((l: any) => l.log_type === 'error');
  const errorBreakdownMap: Record<string, number> = {};
  
  errorLogs.forEach((l: any) => {
    const cat = categorizeError(l.action, l.details);
    errorBreakdownMap[cat] = (errorBreakdownMap[cat] || 0) + 1;
  });

  const errorBreakdown: ErrorBreakdownPoint[] = Object.entries(errorBreakdownMap).map(([name, value]) => ({
    name,
    value,
    fill: CATEGORY_COLORS[name] || '#6b7280',
  }));

  const recentErrors: LogEntry[] = errorLogs.slice(0, 10).map((l: any) => ({
    id: l.id,
    timestamp: new Date(l.created_at).getTime(),
    user: l.user_name || 'System',
    action: l.action,
    details: l.details,
    type: 'error',
  }));

  // --- RAG / Knowledge Analytics ---
  const ragLogs = logs.filter((l: any) => l.action.toLowerCase().includes('rag') || l.action.toLowerCase().includes('knowledge'));
  const retrievalCount = ragLogs.length;
  const successfulRetrievals = ragLogs.filter((l: any) => !l.details.includes('0 chunk') && !l.details.includes('0 source')).length;
  const retrievalFailures = retrievalCount - successfulRetrievals;

  const sourcesUsageMap: Record<string, number> = {};
  ragLogs.forEach((l: any) => {
    const match = l.details.match(/source\(s\):\s*([^.]+)/i);
    if (match && match[1]) {
      const srcs = match[1].split(',').map((s: string) => s.trim()).filter(Boolean);
      srcs.forEach((s: string) => {
        sourcesUsageMap[s] = (sourcesUsageMap[s] || 0) + 1;
      });
    }
  });

  const sourcesUsed: KnowledgeUsagePoint[] = Object.entries(sourcesUsageMap).map(([sourceName, count]) => ({
    sourceName,
    count,
  })).sort((a, b) => b.count - a.count).slice(0, 5);

  const queriesWithNoKnowledge = retrievalFailures;

  // --- Agent Performance ---
  const agentsList = allAgentsRes.data || [];
  const agentPerformance: AgentMetricPoint[] = agentsList.map((ag: any) => {
    const agentConvos = convos.filter((c: any) => c.assigned_agent_id === ag.id).length;
    const agentAiResp = logs.filter((l: any) => l.user_name === ag.name && (l.action === 'Auto-response Sent' || l.action === 'AI Response Generated')).length;
    const agentFailures = logs.filter((l: any) => l.user_name === ag.name && l.log_type === 'error').length;
    const agentHandoffs = logs.filter((l: any) => l.user_name === ag.name && l.action === 'AI Response Skipped').length;
    
    const lastLog = logs.find((l: any) => l.user_name === ag.name);
    const lastActivity = lastLog ? new Date(lastLog.created_at).getTime() : new Date(ag.created_at).getTime();

    return {
      id: ag.id,
      name: ag.name,
      status: ag.status as any,
      mode: ag.mode as any,
      conversationsHandled: agentConvos,
      aiResponses: agentAiResp,
      failures: agentFailures,
      humanHandoffs: agentHandoffs,
      lastActivity,
    };
  });

  return {
    range,
    kpis: {
      totalConversations,
      activeConversations,
      resolvedConversations,
      totalMessages,
      incomingMessages,
      outgoingMessages,
      aiResponses,
      humanResponses,
      aiResponseFailures,
      activeAgents,
    },
    conversationAnalytics: {
      openVsResolvedRatio: {
        open: openCount,
        resolved: resolvedConversations,
        openPercentage,
      },
      avgMessagesPerConversation,
      humanTakeoverCount,
      currentHumanTakeoverCount,
      dailyConvoTrend,
    },
    messageTrend,
    aiPerformance: {
      aiResponseCount: aiResponses,
      aiFailureCount: aiResponseFailures,
      aiSuccessRate,
      humanTakeoverCount,
      currentHumanTakeoverCount,
      aiVsHumanRatio,
      avgResponseTimeSeconds,
      avgResponseTimeFormatted,
    },
    errorAnalytics: {
      totalErrors: errorLogs.length,
      byCategory: errorBreakdown,
      recentErrors,
    },
    ragAnalytics: {
      retrievalCount,
      successfulRetrievals,
      retrievalFailures,
      sourcesUsed,
      queriesWithNoKnowledge,
    },
    agentPerformance,
  };
}
