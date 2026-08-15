export type UserRole = 'owner' | 'admin' | 'operator' | 'viewer';
export type UserStatus = 'online' | 'away' | 'offline';

export interface TeamMember {
  id: string;
  fullName: string;
  email?: string;
  avatarUrl?: string;
  role: UserRole;
  status?: UserStatus;
  assignedQueues?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export type InvitationRole = Exclude<UserRole, 'owner'>;
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface TenantInvitation {
  id: string;
  email: string;
  role: InvitationRole;
  status: InvitationStatus;
  invitedBy?: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
  /** Only present in the response immediately after creation; never re-served on list. */
  inviteUrl?: string;
}

export interface TenantNotificationSettings {
  notifyEmail?: string;
  emailOnNewConversation?: boolean;
  emailOnHandoffRequested?: boolean;
  emailDailyDigest?: boolean;
}

export interface TenantProfile {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  timezone: string;
  businessDescription?: string;
  supportEmail?: string;
  notificationSettings: TenantNotificationSettings;
  plan: string;
  isActive: boolean;
  suspendedReason?: string;
  createdAt: string;
}

export type HandoffRuleType = 'confidence_threshold' | 'intent_detected' | 'keyword_match' | 'consecutive_fallback';

export interface HandoffCondition {
  threshold?: number; // 0.0 to 1.0 (e.g. 0.65)
  intents?: string[]; // e.g. ['human_agent_request', 'complaint', 'billing_refund', 'cancellation']
  keywords?: string[]; // e.g. ['human', 'agent', 'operator', 'representative', 'urgent']
  maxFallbacks?: number; // consecutive unanswered / low confidence count
  consecutiveFallbacks?: number;
}

export interface HandoffAction {
  assignToUserId?: string;
  autoPauseAi: boolean;
  transitionMessage?: string;
  notificationType?: 'in_app' | 'email' | 'none';
}

export interface HandoffRule {
  id: string;
  name: string;
  description: string;
  isEnabled: boolean;
  ruleType: HandoffRuleType;
  conditions: HandoffCondition;
  actions: HandoffAction;
  priority: number;
  createdAt: number;
  updatedAt?: number;
}

export interface HandoffEvaluationResult {
  shouldHandoff: boolean;
  matchedRule?: HandoffRule;
  confidence?: number;
  detectedIntent?: string;
  reason?: string;
  transitionMessage?: string;
}

export interface CannedResponse {
  id: string;
  title: string;
  shortcut: string; // e.g. "intro", "pricing", "hours"
  content: string;
  category?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface ConversationNote {
  id: string;
  chatId: string;
  userId?: string;
  userName: string;
  userAvatar?: string;
  content: string;
  createdAt: number;
}

export type WebhookEventType =
  | 'handoff.triggered'
  | 'conversation.resolved'
  | 'conversation.reopened'
  | 'contact.stage_changed'
  | 'message.received'
  | 'note.created';

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  isActive: boolean;
  createdAt: number;
  updatedAt?: number;
  lastTriggeredAt?: number;
  lastStatusCode?: number;
  failureCount: number;
}

export interface WebhookPayload<T = any> {
  id: string;
  event: WebhookEventType;
  timestamp: number;
  tenantId: string;
  data: T;
}

export type LeadStage = 'lead' | 'prospect' | 'customer' | 'vip' | 'churned';

export interface ContactProfile {
  id: string;
  name: string;
  avatarUrl?: string;
  phone?: string;
  email?: string;
  company?: string;
  stage: LeadStage;
  tags: string[];
  notes?: string;
  customAttributes?: Record<string, any>;
  createdAt: number;
  updatedAt?: number;
  messageCount?: number;
}

export interface ClientDetailItem extends ContactProfile {
  externalId: string;
  formattedPhone: string;
  lastActiveAt?: number;
  initials: string;
}

export type SentimentType = 'positive' | 'neutral' | 'negative' | 'frustrated';

export interface WidgetConfig {
  title: string;
  primaryColor: string;
  greeting: string;
  botAvatar: string;
  botName?: string;
  placeholder?: string;
  allowedOrigins?: string[];
}

export interface SLAMetrics {
  avgFirstResponseTimeMs: number;
  avgResolutionDurationMs: number;
  totalResolved: number;
  sentimentBreakdown: {
    positive: number;
    neutral: number;
    negative: number;
    frustrated: number;
  };
  agentLeaderboard: {
    userId: string;
    fullName: string;
    avatarUrl?: string;
    conversationsHandled: number;
    avgResolutionTimeMs: number;
  }[];
}

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
  /** Human takeover / manual pause status */
  isBotPaused?: boolean;
  /** Human team member assigned to this conversation */
  assignedUserId?: string;
  assignedUser?: TeamMember;
  /** Reason why handoff occurred */
  handoffReason?: string;
  takeoverReason?: string;
  handoffMetadata?: Record<string, any>;
  handoffAt?: number;
  takeoverBriefing?: TakeoverCatchUpSummary;
  reEngagementCount?: number;
  lastReEngagementAt?: number;
  status?: 'open' | 'resolved' | 'pending';
  /** CRM fields */
  contactId?: string;
  stage?: LeadStage;
  tags?: string[];
  email?: string;
  company?: string;
  /** AI Summaries & Sentiment */
  aiSummary?: string;
  sentiment?: SentimentType;
  firstResponseTimeMs?: number;
  resolutionDurationMs?: number;
}

export interface TakeoverCatchUpSummary {
  chatId: string;
  customerIntent: string;
  customerFrustration: 'low' | 'medium' | 'high';
  keyIssue: string;
  botAttemptsSummary: string;
  recommendedNextAction: string;
  generatedAt: number;
}

export interface ReEngagementConfig {
  isEnabled: boolean;
  inactivityHoursThreshold: number; // e.g. 2, 4, 12, 24, 48
  maxFollowUpsPerConversation: number; // e.g. 1 or 2
  followUpMessageTemplate: string;
  onlyUnresolved: boolean;
  aiGeneratedContextual: boolean;
  scanIntervalMinutes: number; // how often the background scheduler checks for stale conversations
}

export function isConversationPaused(convo?: Partial<Conversation> | null): boolean {
  if (!convo) return false;
  return !!convo.isBotPaused || convo.assignedAgentId === null || convo.assignedAgentId === '';
}

export interface Message {
  id: string; // from Baileys
  chatId: string;
  fromMe: boolean;
  text: string;
  timestamp: number;
  senderName?: string;
  mediaType?: 'text' | 'audio' | 'image' | 'document';
  mediaCaption?: string;
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

export type AIProvider = 'openai' | 'gemini' | 'anthropic' | 'groq';

export interface AISettings {
  provider: AIProvider;
  apiKey?: string; // optional override, otherwise use env
  knowledgeFileIds: string[];
  systemPrompt: string;
  maxLen: number; // approximate max character or token length
  temperature: number; // 0-1 creativity
  enableVoiceResponse?: boolean; // Reply with synthetic voice notes when receiving voice notes or always
  voiceProvider?: 'google' | 'openai' | 'elevenlabs';
  voiceName?: string;
  enableVision?: boolean; // Enable inspection of incoming images and PDF documents
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
