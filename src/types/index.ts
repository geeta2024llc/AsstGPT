export interface Conversation {
  id: string; // e.g., '1234567890@s.whatsapp.net'
  name: string;
  unreadCount: number;
  lastMessage: {
    text: string;
    timestamp: number;
  };
  avatar: string;
  /** Agent currently assigned to this conversation */
  assignedAgentId?: string;
  status?: 'open' | 'resolved';
}

export interface Message {
  id: string; // from Baileys
  chatId: string;
  fromMe: boolean;
  text: string;
  timestamp: number;
  senderName?: string;
}

export interface AgentRule {
  id: string;
  trigger: {
    type: 'keywords'; // Future-proof for more trigger types
    value: string; // Comma-separated keywords
  };
  responses: string[];
  knowledgeFileIds?: string[];
}

export type AgentStatus = 'active' | 'paused' | 'errored' | 'disconnected';

export type AIProvider = 'openai' | 'gemini' | 'anthropic';

export interface AISettings {
  provider: AIProvider;
  apiKey?: string; // optional override, otherwise use env
  knowledgeFileIds: string[];
  systemPrompt: string;
  maxLen: number; // approximate max character or token length
  temperature: number; // 0-1 creativity
}

export type AgentMode = 'rule' | 'ai';

export interface Agent {
  id: string;
  name: string;
  description: string;
  mode: AgentMode;
  rules: AgentRule[];
  fallbackResponse: string;
  aiSettings?: AISettings;
  /** Real-time connection / health status */
  status?: AgentStatus;
}

export interface Stats {
  sent: number;
  received: number;
  activeAgents: number;
  errors: number;
}

export interface KnowledgeFile {
  id: string;
  fileName: string;
  fileType: string;
  size: number; // in bytes
  content: string; // extracted text
  enabled?: boolean;
  status?: 'ready' | 'processing' | 'disabled' | 'error';
  createdAt: number;
  updatedAt?: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  user: string;
  action: string;
  details: string;
  type: 'info' | 'warning' | 'error' | 'success';
}

// --- Dashboard & Production Analytics Types ---

export interface TimeSeriesDataPoint {
  date: string;
  Sent?: number;
  Received?: number;
  NewConvos?: number;
  ResolvedConvos?: number;
}

export interface ErrorBreakdownPoint {
  name: string;
  value: number;
  fill: string;
}

export interface StatCardData {
  value: number;
  change: string;
  changeType: 'increase' | 'decrease' | 'neutral';
}

export interface DashboardData {
  stats: {
    sent: StatCardData;
    received: StatCardData;
    activeAgents: StatCardData;
    errors: StatCardData;
  };
  messageTrend: TimeSeriesDataPoint[];
  errorBreakdown: ErrorBreakdownPoint[];
  recentErrors: LogEntry[];
}

export interface KnowledgeUsagePoint {
  sourceName: string;
  count: number;
}

export interface AgentMetricPoint {
  id: string;
  name: string;
  status: AgentStatus;
  mode: AgentMode;
  conversationsHandled: number;
  aiResponses: number;
  failures: number;
  humanHandoffs: number;
  lastActivity?: number;
}

export interface AnalyticsData {
  range: 'today' | '7d' | '30d';
  kpis: {
    totalConversations: number;
    activeConversations: number;
    resolvedConversations: number;
    totalMessages: number;
    incomingMessages: number;
    outgoingMessages: number;
    aiResponses: number;
    humanResponses: number;
    aiResponseFailures: number;
    activeAgents: number;
  };
  conversationAnalytics: {
    openVsResolvedRatio: { open: number; resolved: number; openPercentage: number };
    avgMessagesPerConversation: number;
    humanTakeoverCount: number;
    currentHumanTakeoverCount: number;
    dailyConvoTrend: Array<{ date: string; created: number; resolved: number }>;
  };
  messageTrend: TimeSeriesDataPoint[];
  aiPerformance: {
    aiResponseCount: number;
    aiFailureCount: number;
    aiSuccessRate: number;
    humanTakeoverCount: number;
    currentHumanTakeoverCount: number;
    aiVsHumanRatio: string;
    avgResponseTimeSeconds: number | null; // null if not measurable reliably
    avgResponseTimeFormatted: string;
  };
  errorAnalytics: {
    totalErrors: number;
    byCategory: ErrorBreakdownPoint[];
    recentErrors: LogEntry[];
  };
  ragAnalytics: {
    retrievalCount: number;
    successfulRetrievals: number;
    retrievalFailures: number;
    sourcesUsed: KnowledgeUsagePoint[];
    queriesWithNoKnowledge: number;
  };
  agentPerformance: AgentMetricPoint[];
}
