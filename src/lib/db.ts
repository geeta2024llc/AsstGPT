if (typeof window !== 'undefined') {
  throw new Error('CRITICAL SECURITY ERROR: src/lib/db.ts is a server-only module and cannot be imported in client components.');
}

import { getSupabaseAdmin } from './supabase';
import { getRequestContext } from './request-context';
import type { Conversation, Message, Agent, Stats, KnowledgeFile, LogEntry, TeamMember, HandoffRule, CannedResponse, ConversationNote, ContactProfile, ClientDetailItem, LeadStage, WebhookConfig, WebhookEventType, WebhookPayload, SLAMetrics, SentimentType, WidgetConfig, ReEngagementConfig, TenantInvitation, InvitationRole, UserRole, UserStatus, TenantProfile, TenantNotificationSettings, ScheduledMessage, ScheduledMessageStatus, ScheduledMessageType } from '@/types';
import crypto from 'crypto';
import { formatContactName, isSyntheticOrGenericName, formatPhoneNumber, getAvatarInitials } from './format-utils';

function getDefaultTenantId(): string {
  const tenantId = process.env.DEFAULT_TENANT_ID;
  if (!tenantId) {
    throw new Error('CRITICAL CONFIGURATION ERROR: DEFAULT_TENANT_ID environment variable is missing.');
  }
  return tenantId;
}

/**
 * Ensures that a tenant and WhatsApp channel exist in Supabase.
 * Returns the tenantId and channelId scoped to the active RequestContext.
 */
const tenantChannelCache = new Map<string, string>();

export async function ensureDefaultTenantAndChannel(explicitTenantId?: string): Promise<{ tenantId: string; channelId: string }> {
  const ctx = getRequestContext();
  const tenantId = explicitTenantId || ctx?.tenantId || getDefaultTenantId();

  const cachedChannelId = tenantChannelCache.get(tenantId);
  if (cachedChannelId) {
    return { tenantId, channelId: cachedChannelId };
  }

  const supabase = getSupabaseAdmin();

  // 1. The tenant must already exist. Silently fabricating a phantom,
  // ownerless tenant on an unrecognized id masks real problems (a
  // misconfigured DEFAULT_TENANT_ID, or a stale JWT referencing a tenant
  // that was since deleted) instead of surfacing them loudly. Real tenants
  // are only ever created via POST /api/auth/signup or invitation
  // acceptance -- neither of those paths calls this function.
  const { data: existingTenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();

  if (!existingTenant) {
    throw new Error(
      `Unknown tenant: no workspace exists with id "${tenantId}". Refusing to auto-provision a new one -- check DEFAULT_TENANT_ID configuration or whether this tenant was deleted.`
    );
  }

  // 2. Ensure WhatsApp channel exists for this tenant
  const { data: existingChannel } = await supabase
    .from('channels')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('type', 'whatsapp')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingChannel) {
    tenantChannelCache.set(tenantId, existingChannel.id);
    return { tenantId, channelId: existingChannel.id };
  }

  const { data: newChannel, error: channelError } = await supabase
    .from('channels')
    .insert({
      tenant_id: tenantId,
      type: 'whatsapp',
      display_name: 'WhatsApp Default',
      status: 'disconnected',
    })
    .select('id')
    .single();

  if (channelError || !newChannel) {
    console.error('Failed to create WhatsApp channel for tenant:', channelError);
    throw new Error(`Channel initialization failed for tenant ${tenantId}`);
  }

  tenantChannelCache.set(tenantId, newChannel.id);
  return { tenantId, channelId: newChannel.id };
}

// --- Workspace / Tenant Profile ---

function tenantRowToProfile(row: any): TenantProfile {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url || undefined,
    timezone: row.timezone || 'UTC',
    businessDescription: row.business_description || undefined,
    supportEmail: row.support_email || undefined,
    notificationSettings: (row.notification_settings as TenantNotificationSettings) || {},
    plan: row.plan || 'free',
    isActive: row.is_active !== false,
    suspendedReason: row.suspended_reason || undefined,
    createdAt: row.created_at,
  };
}

export async function getTenantProfile(): Promise<TenantProfile> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const { data, error } = await supabase.from('tenants').select('*').eq('id', tenantId).single();
  if (error || !data) {
    console.error('Failed to fetch tenant profile:', error);
    throw error || new Error('Workspace not found');
  }
  return tenantRowToProfile(data);
}

export async function updateTenantProfile(update: {
  name?: string;
  logoUrl?: string | null;
  timezone?: string;
  businessDescription?: string | null;
  supportEmail?: string | null;
  notificationSettings?: TenantNotificationSettings;
}): Promise<TenantProfile> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (update.name !== undefined) payload.name = update.name;
  if (update.logoUrl !== undefined) payload.logo_url = update.logoUrl;
  if (update.timezone !== undefined) payload.timezone = update.timezone;
  if (update.businessDescription !== undefined) payload.business_description = update.businessDescription;
  if (update.supportEmail !== undefined) payload.support_email = update.supportEmail;
  if (update.notificationSettings !== undefined) payload.notification_settings = update.notificationSettings;

  const { data, error } = await supabase
    .from('tenants')
    .update(payload)
    .eq('id', tenantId)
    .select('*')
    .single();

  if (error || !data) {
    console.error('Failed to update tenant profile:', error);
    throw error || new Error('Failed to update workspace');
  }
  return tenantRowToProfile(data);
}

export async function getConversations(options?: { limit?: number; offset?: number; contactId?: string; beforeLastMessageAt?: string }): Promise<Conversation[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    let query = supabase
      .from('conversations')
      .select(`
        id,
        unread_count,
        last_message_text,
        last_message_at,
        assigned_agent_id,
        is_bot_paused,
        assigned_user_id,
        handoff_reason,
        handoff_metadata,
        handoff_at,
        status,
        ai_summary,
        sentiment,
        first_response_time_ms,
        resolution_duration_ms,
        contacts (
          id,
          name,
          avatar_url,
          stage,
          tags,
          email,
          company,
          contact_channels (
            external_id
          )
        )
      `)
      .eq('tenant_id', tenantId)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (options?.contactId) {
      query = query.eq('contact_id', options.contactId);
    }
    if (options?.beforeLastMessageAt) {
      query = query.lt('last_message_at', options.beforeLastMessageAt);
    }
    if (options?.limit) {
      query = query.limit(options.limit);
    }
    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
    }

    const { data: convosData, error } = await query;

    if (error) {
      console.error('Failed to fetch conversations from Supabase:', error);
      return [];
    }

    if (!convosData) return [];

    const conversationsMap = new Map<string, Conversation>();

    for (const c of convosData) {
      const contact = c.contacts as any;
      const channels: any[] = contact?.contact_channels || [];

      // Find primary phone-based channel first, fallback to first channel, then contact name or convo id
      const phoneChannel = channels.find((ch: any) => ch.external_id?.endsWith('@s.whatsapp.net'));
      const rawExtId = phoneChannel?.external_id || channels[0]?.external_id || contact?.name || c.id;

      // Skip internal WhatsApp system broadcasts and newsletter channels
      if (
        rawExtId === 'status@broadcast' ||
        rawExtId.endsWith('@broadcast') ||
        rawExtId.endsWith('@newsletter') ||
        rawExtId === 'status'
      ) {
        continue;
      }

      const externalId = rawExtId;
      const lastMsgTime = c.last_message_at ? new Date(c.last_message_at).getTime() : Date.now();
      const displayName = formatContactName(contact?.name, externalId);

      const convoObj: Conversation = {
        id: externalId,
        name: displayName,
        unreadCount: c.unread_count || 0,
        lastMessage: {
          text: c.last_message_text || '',
          timestamp: lastMsgTime,
        },
        avatar: contact?.avatar_url && !contact.avatar_url.includes('placehold.co') ? contact.avatar_url : undefined,
        assignedAgentId: c.assigned_agent_id || undefined,
        isBotPaused: !!c.is_bot_paused,
        assignedUserId: c.assigned_user_id || undefined,
        handoffReason: c.handoff_reason || undefined,
        handoffMetadata: c.handoff_metadata || undefined,
        handoffAt: c.handoff_at ? new Date(c.handoff_at).getTime() : undefined,
        status: (c.status as any) || 'open',
        contactId: contact?.id || undefined,
        stage: (contact?.stage as LeadStage) || 'lead',
        tags: contact?.tags || [],
        email: contact?.email || undefined,
        company: contact?.company || undefined,
        aiSummary: c.ai_summary || undefined,
        sentiment: (c.sentiment as any) || 'neutral',
        firstResponseTimeMs: c.first_response_time_ms || undefined,
        resolutionDurationMs: c.resolution_duration_ms || undefined,
        isStarred: Boolean(
          c.handoff_metadata?.isStarred ||
          contact?.tags?.includes('starred') ||
          contact?.custom_attributes?.isStarred
        ),
      };

      // Deduplicate by contactId if present, otherwise by externalId
      const dedupKey = contact?.id ? `contact_${contact.id}` : externalId;
      const existing = conversationsMap.get(dedupKey);
      if (!existing || convoObj.lastMessage.timestamp > existing.lastMessage.timestamp) {
        conversationsMap.set(dedupKey, convoObj);
      }
    }

    const conversations = Array.from(conversationsMap.values());
    return conversations.sort((a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp);
  } catch (err) {
    console.error('Error in getConversations:', err);
    return [];
  }
}

export function isConversationPaused(convo?: Partial<Conversation> | null): boolean {
  if (!convo) return false;
  return !!convo.isBotPaused || convo.assignedAgentId === null || convo.assignedAgentId === '';
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  // Fast path: `id` is almost always a WhatsApp JID (contact_channels.external_id),
  // which is indexed -- resolve it to a contact_id and scope getConversations()
  // to that one contact instead of scanning the tenant's entire conversation
  // list. Falls back to the full scan for the rarer synthetic-id cases
  // (contact name or the conversation's own row id used as a display id).
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: channelMatch } = await supabase
      .from('contact_channels')
      .select('contact_id')
      .eq('tenant_id', tenantId)
      .eq('external_id', id)
      .maybeSingle();

    if (channelMatch?.contact_id) {
      const scoped = await getConversations({ contactId: channelMatch.contact_id, limit: 10 });
      const match = scoped.find((c) => c.id === id);
      if (match) return match;
    }
  } catch (err) {
    console.error('getConversation fast-path lookup failed, falling back to full scan:', err);
  }

  const convos = await getConversations();
  return convos.find((c) => c.id === id);
}

export async function updateConversation(
  id: string,
  update: Partial<Omit<Conversation, 'id'>> & { incrementUnread?: boolean }
) {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId, channelId } = await ensureDefaultTenantAndChannel();

    // 1. Get or create contact_channel by external_id (id = JID)
    let { data: cc } = await supabase
      .from('contact_channels')
      .select('contact_id')
      .eq('tenant_id', tenantId)
      .eq('channel_id', channelId)
      .eq('external_id', id)
      .maybeSingle();

    let contactId = cc?.contact_id;

    if (!contactId) {
      // Create contact
      const isInvalidName = !update.name || update.name.toLowerCase() === 'me' || update.name.toLowerCase() === 'system';
      const contactName = (isInvalidName ? id.split('@')[0] : update.name) || id;
      const avatarUrl = update.avatar && !update.avatar.includes('placehold.co') ? update.avatar : null;

      const { data: newContact, error: contactErr } = await supabase
        .from('contacts')
        .insert({
          tenant_id: tenantId,
          name: contactName,
          avatar_url: avatarUrl,
        })
        .select('id')
        .single();

      if (contactErr || !newContact) {
        console.error('Failed to create contact in Supabase:', contactErr);
        return;
      }
      contactId = newContact.id;

      // Upsert contact_channel to prevent race condition
      const { error: ccErr } = await supabase.from('contact_channels').upsert({
        tenant_id: tenantId,
        contact_id: contactId,
        channel_id: channelId,
        external_id: id,
      }, { onConflict: 'tenant_id,channel_id,external_id' });

      if (ccErr) {
        console.error('Failed to upsert contact_channel in Supabase:', ccErr);
      }
    } else if (update.name || update.avatar) {
      // Update contact info if provided, ensuring we never overwrite real names with "Me" or numeric fallbacks
      const contactUpdate: any = {};
      if (update.name && update.name.toLowerCase() !== 'me' && update.name.toLowerCase() !== 'system') {
        const { data: existingContact } = await supabase
          .from('contacts')
          .select('name')
          .eq('id', contactId)
          .maybeSingle();

        const existingName = (existingContact?.name || '').trim();
        const isExistingNumeric = !existingName || /^\d+$/.test(existingName.replace(/[\s\+\-\(\)]/g, ''));
        const isNewNumeric = /^\d+$/.test(update.name.replace(/[\s\+\-\(\)]/g, ''));

        // If new name is non-numeric, or if existing contact has no real name yet, update it
        if (!isNewNumeric || isExistingNumeric) {
          contactUpdate.name = update.name;
        }
      }

      if (update.avatar) contactUpdate.avatar_url = update.avatar;

      if (Object.keys(contactUpdate).length > 0) {
        await supabase.from('contacts').update(contactUpdate).eq('id', contactId);
      }
    }

    // 2. Get or create conversation for (tenantId, channelId, contactId)
    const { data: existingConvo } = await supabase
      .from('conversations')
      .select('id, unread_count, status')
      .eq('tenant_id', tenantId)
      .eq('channel_id', channelId)
      .eq('contact_id', contactId)
      .maybeSingle();

    const convoPayload: any = {
      updated_at: new Date().toISOString(),
    };

    if (update.incrementUnread) {
      convoPayload.unread_count = (existingConvo?.unread_count || 0) + 1;
    } else if (update.unreadCount !== undefined) {
      convoPayload.unread_count = update.unreadCount;
    }

    if (update.lastMessage) {
      convoPayload.last_message_text = update.lastMessage.text;
      convoPayload.last_message_at = new Date(update.lastMessage.timestamp).toISOString();
    }
    if (update.assignedAgentId !== undefined) convoPayload.assigned_agent_id = update.assignedAgentId || null;
    if (update.isBotPaused !== undefined) convoPayload.is_bot_paused = update.isBotPaused;
    if (update.assignedUserId !== undefined) convoPayload.assigned_user_id = update.assignedUserId || null;
    if (update.handoffReason !== undefined) convoPayload.handoff_reason = update.handoffReason || null;
    if (update.handoffMetadata !== undefined) convoPayload.handoff_metadata = update.handoffMetadata;
    if (update.handoffAt !== undefined) convoPayload.handoff_at = update.handoffAt ? new Date(update.handoffAt).toISOString() : null;
    if (update.status !== undefined) convoPayload.status = update.status;
    if (update.aiSummary !== undefined) convoPayload.ai_summary = update.aiSummary || null;
    if (update.sentiment !== undefined) convoPayload.sentiment = update.sentiment;
    if (update.firstResponseTimeMs !== undefined) convoPayload.first_response_time_ms = update.firstResponseTimeMs;
    if (update.resolutionDurationMs !== undefined) convoPayload.resolution_duration_ms = update.resolutionDurationMs;

    if (existingConvo) {
      const { error: updateErr } = await supabase
        .from('conversations')
        .update(convoPayload)
        .eq('id', existingConvo.id);
      if (updateErr) console.error('Failed to update conversation in Supabase:', updateErr);
    } else {
      convoPayload.tenant_id = tenantId;
      convoPayload.channel_id = channelId;
      convoPayload.contact_id = contactId;
      if (!update.incrementUnread && update.unreadCount === undefined) {
        convoPayload.unread_count = 0;
      }
      if (update.lastMessage) {
        convoPayload.last_message_text = update.lastMessage.text;
        convoPayload.last_message_at = new Date(update.lastMessage.timestamp).toISOString();
      }
      if (!convoPayload.status) {
        convoPayload.status = 'open';
      }

      const { error: insertErr } = await supabase.from('conversations').insert(convoPayload);
      if (insertErr) console.error('Failed to insert conversation into Supabase:', insertErr);
    }
  } catch (err) {
    console.error('Error in updateConversation:', err);
  }
}

export async function setConversationAssignedAgent(chatId: string, agentId: string) {
  await updateConversation(chatId, { assignedAgentId: agentId });
}

export async function setConversationTakeover(
  chatId: string,
  isPaused: boolean,
  assignedUserId?: string,
  reason?: string,
  metadata?: Record<string, any>
) {
  await updateConversation(chatId, {
    isBotPaused: isPaused,
    assignedUserId: assignedUserId !== undefined ? assignedUserId : undefined,
    handoffReason: isPaused ? (reason || 'Manual human takeover') : undefined,
    handoffMetadata: isPaused ? (metadata || {}) : {},
    handoffAt: isPaused ? Date.now() : undefined,
  });
}

export async function resolveConversation(chatId: string, isResolved: boolean) {
  await updateConversation(chatId, {
    status: isResolved ? 'resolved' : 'open',
  });
}

// --- Messages ---

export async function hasMessage(providerMessageId: string): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data, error } = await supabase
      .from('messages')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('provider_message_id', providerMessageId)
      .maybeSingle();

    if (error) {
      console.error('Failed to check message existence in Supabase:', error);
      return false;
    }

    return !!data;
  } catch (err) {
    console.error('Error in hasMessage:', err);
    return false;
  }
}

export async function getMessages(chatId?: string, options?: { limit?: number; offset?: number }): Promise<Message[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    let conversationIdFilter: string | undefined;

    if (chatId) {
      // 1. Check if chatId is a direct conversation UUID
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
      if (isUuid) {
        const { data: directConvo } = await supabase
          .from('conversations')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('id', chatId)
          .maybeSingle();

        if (directConvo) {
          conversationIdFilter = directConvo.id;
        }
      }

      // 2. Fallback: Search by WhatsApp JID / contact phone
      if (!conversationIdFilter) {
        const { data: contactChannel } = await supabase
          .from('contact_channels')
          .select('contact_id')
          .eq('tenant_id', tenantId)
          .eq('external_id', chatId)
          .maybeSingle();

        if (contactChannel) {
          const { data: convo } = await supabase
            .from('conversations')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('contact_id', contactChannel.contact_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (convo) {
            conversationIdFilter = convo.id;
          }
        }
      }

      // If specific chatId was requested but no conversation was found, return empty array immediately
      if (!conversationIdFilter) {
        return [];
      }
    }

    let query = supabase
      .from('messages')
      .select('id, provider_message_id, from_me, sender_name, text, created_at, metadata')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (conversationIdFilter) {
      query = query.eq('conversation_id', conversationIdFilter);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }
    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 100) - 1);
    }

    const { data: msgs, error } = await query;
    if (error) {
      console.error('Failed to fetch messages from Supabase:', error);
      return [];
    }

    if (!msgs) return [];

    return msgs.map((m: any) => {
      const timestamp = new Date(m.created_at).getTime();
      const msgChatId = m.metadata?.chatId || chatId || 'unknown';

      return {
        id: m.provider_message_id || m.id,
        chatId: msgChatId,
        fromMe: m.from_me,
        text: m.text,
        timestamp,
        senderName: m.sender_name || (m.from_me ? 'Me' : msgChatId.split('@')[0]),
      };
    });
  } catch (err) {
    console.error('Error in getMessages:', err);
    return [];
  }
}

export async function addMessage(message: Message): Promise<{ success: boolean; duplicate: boolean }> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId, channelId } = await ensureDefaultTenantAndChannel();

    const createdAt = new Date(message.timestamp).toISOString();
    const senderType = message.fromMe ? 'user' : 'contact';
    const senderName = message.senderName || (message.fromMe ? 'Me' : message.chatId.split('@')[0]);

    // Call atomic database procedure with transaction advisory lock and deduplication
    const { data, error } = await supabase.rpc('add_message_atomic', {
      p_tenant_id: tenantId,
      p_channel_id: channelId,
      p_chat_id: message.chatId,
      p_provider_message_id: message.id,
      p_sender_type: senderType,
      p_from_me: message.fromMe,
      p_sender_name: senderName,
      p_text: message.text,
      p_metadata: { chatId: message.chatId, provider: 'baileys' },
      p_created_at: createdAt,
    });

    if (error) {
      if (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('uk_messages_tenant_provider_id')) {
        console.warn(`[DIAGNOSTIC] Atomic idempotency: Duplicate provider_message_id rejected by DB: ${message.id}`);
        return { success: false, duplicate: true };
      }
      console.error('[DIAGNOSTIC] Failed to insert message via add_message_atomic:', error);
      return { success: false, duplicate: false };
    }

    if (data?.duplicate) {
      console.warn(`[DIAGNOSTIC] Atomic idempotency: Duplicate provider_message_id rejected by DB: ${message.id}`);
      return { success: false, duplicate: true };
    }

    return { success: true, duplicate: false };
  } catch (err) {
    console.error('[DIAGNOSTIC] Error in addMessage:', err);
    return { success: false, duplicate: false };
  }
}

// --- Stats ---

export async function getStats(): Promise<Stats> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const [sentRes, recvRes, agentsRes, errorsRes] = await Promise.all([
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('from_me', true),
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('from_me', false),
      supabase
        .from('agents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'active'),
      supabase
        .from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('log_type', 'error'),
    ]);

    return {
      sent: sentRes.count || 0,
      received: recvRes.count || 0,
      activeAgents: agentsRes.count || 0,
      errors: errorsRes.count || 0,
    };
  } catch (err) {
    console.error('Error calculating stats from Supabase:', err);
    return { sent: 0, received: 0, activeAgents: 0, errors: 0 };
  }
}

export async function incrementStat(key: 'sent' | 'received' | 'errors') {
  // Stats are dynamically calculated via SQL queries in getStats()
  return;
}

// --- Agents ---

export async function getAgents(): Promise<Agent[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: agentsData, error } = await supabase
      .from('agents')
      .select(`
        id,
        name,
        description,
        mode,
        fallback_response,
        status,
        agent_settings (
          provider,
          system_prompt,
          max_len,
          temperature,
          rules
        ),
        agent_knowledge_sources (
          knowledge_source_id
        )
      `)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Failed to fetch agents from Supabase:', error);
      return [];
    }

    if (!agentsData) return [];

    return agentsData.map((a: any) => {
      const settings = Array.isArray(a.agent_settings) ? a.agent_settings[0] : a.agent_settings;
      const knowledgeFileIds = (a.agent_knowledge_sources || []).map((k: any) => k.knowledge_source_id);

      const rules = settings?.rules || [];

      const aiSettings = a.mode === 'ai' || settings ? {
        provider: settings?.provider || 'gemini',
        systemPrompt: settings?.system_prompt || 'You are a helpful assistant.',
        maxLen: settings?.max_len || 500,
        temperature: settings?.temperature !== undefined ? Number(settings.temperature) : 0.7,
        knowledgeFileIds,
      } : undefined;

      return {
        id: a.id,
        name: a.name,
        description: a.description || '',
        mode: (a.mode as 'rule' | 'ai') || 'rule',
        rules,
        fallbackResponse: a.fallback_response || "Sorry, I didn't understand that.",
        status: (a.status as any) || 'active',
        aiSettings,
      };
    });
  } catch (err) {
    console.error('Error in getAgents:', err);
    return [];
  }
}

export async function getAgent(id: string): Promise<Agent | undefined> {
  const agents = await getAgents();
  return agents.find((a) => a.id === id);
}

export async function addAgent(agent: Omit<Agent, 'id' | 'mode'> & Partial<Pick<Agent, 'mode'>>): Promise<Agent> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const mode = agent.mode || 'rule';
  const status = agent.status || 'active';
  const fallbackResponse = agent.fallbackResponse || "Sorry, I didn't understand that.";

  // 1. Insert agent
  const { data: newAgent, error: agentErr } = await supabase
    .from('agents')
    .insert({
      tenant_id: tenantId,
      name: agent.name,
      description: agent.description || '',
      mode,
      fallback_response: fallbackResponse,
      status,
    })
    .select('id')
    .single();

  if (agentErr || !newAgent) {
    console.error('Failed to insert agent into Supabase:', agentErr);
    throw new Error('Failed to create agent');
  }

  const agentId = newAgent.id;

  // 2. Insert agent_settings
  const aiSettings = agent.aiSettings;
  const rules = agent.rules || [];

  const { error: settingsErr } = await supabase.from('agent_settings').insert({
    agent_id: agentId,
    tenant_id: tenantId,
    provider: aiSettings?.provider || 'gemini',
    system_prompt: aiSettings?.systemPrompt || 'You are a helpful assistant.',
    max_len: aiSettings?.maxLen || 500,
    temperature: aiSettings?.temperature || 0.7,
    rules: JSON.parse(JSON.stringify(rules)),
  });

  if (settingsErr) {
    console.error('Failed to insert agent settings into Supabase:', settingsErr);
  }

  // 3. Insert agent_knowledge_sources if any
  const knowledgeFileIds = aiSettings?.knowledgeFileIds || [];
  if (knowledgeFileIds.length > 0) {
    const knowledgeInserts = knowledgeFileIds.map((ksId) => ({
      tenant_id: tenantId,
      agent_id: agentId,
      knowledge_source_id: ksId,
    }));
    await supabase.from('agent_knowledge_sources').insert(knowledgeInserts);
  }

  const created = await getAgent(agentId);
  if (!created) {
    return {
      id: agentId,
      name: agent.name,
      description: agent.description || '',
      mode,
      rules,
      fallbackResponse,
      status,
      aiSettings,
    };
  }
  return created;
}

export const createAgent = addAgent;

export async function updateAgent(id: string, update: Partial<Omit<Agent, 'id'>>) {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    // 0. Verify agent ownership strictly before touching core row or child settings
    const { data: targetAgent, error: agentLookupErr } = await supabase
      .from('agents')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (agentLookupErr || !targetAgent) {
      console.warn(`[SECURITY] updateAgent blocked: agent ${id} does not belong to tenant ${tenantId}`);
      return undefined;
    }

    // 1. Update agent core fields
    const agentFields: any = {};
    if (update.name !== undefined) agentFields.name = update.name;
    if (update.description !== undefined) agentFields.description = update.description;
    if (update.mode !== undefined) agentFields.mode = update.mode;
    if (update.fallbackResponse !== undefined) agentFields.fallback_response = update.fallbackResponse;
    if (update.status !== undefined) agentFields.status = update.status;
    agentFields.updated_at = new Date().toISOString();

    if (Object.keys(agentFields).length > 0) {
      await supabase.from('agents').update(agentFields).eq('id', id).eq('tenant_id', tenantId);
    }

    // 2. Update agent_settings
    const settingsFields: any = {};
    if (update.rules !== undefined) settingsFields.rules = JSON.parse(JSON.stringify(update.rules));
    if (update.aiSettings) {
      if (update.aiSettings.provider) settingsFields.provider = update.aiSettings.provider;
      if (update.aiSettings.systemPrompt !== undefined) settingsFields.system_prompt = update.aiSettings.systemPrompt;
      if (update.aiSettings.maxLen !== undefined) settingsFields.max_len = update.aiSettings.maxLen;
      if (update.aiSettings.temperature !== undefined) settingsFields.temperature = update.aiSettings.temperature;
    }
    settingsFields.updated_at = new Date().toISOString();

    const { data: existingSettings } = await supabase
      .from('agent_settings')
      .select('id')
      .eq('agent_id', id)
      .maybeSingle();

    if (existingSettings) {
      await supabase.from('agent_settings').update(settingsFields).eq('agent_id', id);
    } else {
      settingsFields.agent_id = id;
      settingsFields.tenant_id = tenantId;
      await supabase.from('agent_settings').insert(settingsFields);
    }

    // 3. Update agent_knowledge_sources if aiSettings.knowledgeFileIds is present
    if (update.aiSettings?.knowledgeFileIds) {
      await supabase.from('agent_knowledge_sources').delete().eq('agent_id', id);

      const knowledgeInserts = update.aiSettings.knowledgeFileIds.map((ksId) => ({
        tenant_id: tenantId,
        agent_id: id,
        knowledge_source_id: ksId,
      }));
      if (knowledgeInserts.length > 0) {
        await supabase.from('agent_knowledge_sources').insert(knowledgeInserts);
      }
    }

    return await getAgent(id);
  } catch (err) {
    console.error('Error in updateAgent:', err);
    return undefined;
  }
}

export async function deleteAgent(id: string) {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { error } = await supabase
      .from('agents')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Failed to delete agent from Supabase:', error);
    }
  } catch (err) {
    console.error('Error in deleteAgent:', err);
  }
}

// --- Knowledge Base ---

export async function getKnowledgeFiles(): Promise<KnowledgeFile[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: filesData, error } = await supabase
      .from('knowledge_sources')
      .select('id, file_name, file_type, file_size, content, enabled, status, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch knowledge sources from Supabase:', error);
      return [];
    }

    if (!filesData) return [];

    return filesData.map((f: any) => ({
      id: f.id,
      fileName: f.file_name,
      fileType: f.file_type,
      size: Number(f.file_size || 0),
      content: f.content,
      enabled: f.enabled !== false,
      status: (f.status as any) || 'ready',
      createdAt: new Date(f.created_at).getTime(),
      updatedAt: f.updated_at ? new Date(f.updated_at).getTime() : undefined,
    }));
  } catch (err) {
    console.error('Error in getKnowledgeFiles:', err);
    return [];
  }
}

export async function getKnowledgeFile(id: string): Promise<KnowledgeFile | undefined> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: f, error } = await supabase
      .from('knowledge_sources')
      .select('id, file_name, file_type, file_size, content, enabled, status, created_at, updated_at')
      .eq('id', id)
      .eq('tenant_id', tenantId)  // TENANT ISOLATION ENFORCED AT DB BOUNDARY
      .maybeSingle();

    if (error) {
      console.error(`Failed to fetch knowledge source ${id}:`, error);
      return undefined;
    }
    if (!f) return undefined;

    return {
      id: f.id,
      fileName: f.file_name,
      fileType: f.file_type,
      size: Number(f.file_size || 0),
      content: f.content,
      enabled: f.enabled !== false,
      status: (f.status as any) || 'ready',
      createdAt: new Date(f.created_at).getTime(),
      updatedAt: f.updated_at ? new Date(f.updated_at).getTime() : undefined,
    };
  } catch (err) {
    console.error('Error in getKnowledgeFile:', err);
    return undefined;
  }
}

export async function addKnowledgeFile(
  fileData: Omit<KnowledgeFile, 'id' | 'createdAt'>
): Promise<KnowledgeFile> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const enabled = fileData.enabled !== false;
  const status = fileData.status || 'ready';

  const { data: newFile, error } = await supabase
    .from('knowledge_sources')
    .insert({
      tenant_id: tenantId,
      file_name: fileData.fileName,
      file_type: fileData.fileType,
      file_size: fileData.size,
      content: fileData.content,
      enabled,
      status,
    })
    .select('id, file_name, file_type, file_size, content, enabled, status, created_at')
    .single();

  if (error || !newFile) {
    console.error('Failed to insert knowledge source into Supabase:', error);
    throw new Error('Failed to create knowledge source');
  }

  return {
    id: newFile.id,
    fileName: newFile.file_name,
    fileType: newFile.file_type,
    size: Number(newFile.file_size || 0),
    content: newFile.content,
    enabled: newFile.enabled,
    status: newFile.status,
    createdAt: new Date(newFile.created_at).getTime(),
  };
}

export async function updateKnowledgeFile(
  id: string,
  update: Partial<Omit<KnowledgeFile, 'id' | 'createdAt'>>
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const payload: any = { updated_at: new Date().toISOString() };
    if (update.fileName !== undefined) payload.file_name = update.fileName;
    if (update.fileType !== undefined) payload.file_type = update.fileType;
    if (update.size !== undefined) payload.file_size = update.size;
    if (update.content !== undefined) payload.content = update.content;
    if (update.enabled !== undefined) payload.enabled = update.enabled;
    if (update.status !== undefined) payload.status = update.status;

    await supabase
      .from('knowledge_sources')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId);
  } catch (err) {
    console.error('Error in updateKnowledgeFile:', err);
  }
}

export async function deleteKnowledgeFile(id: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { error } = await supabase
      .from('knowledge_sources')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Failed to delete knowledge source from Supabase:', error);
    }
  } catch (err) {
    console.error('Error in deleteKnowledgeFile:', err);
  }
}

// --- Logs ---

export async function getLogs(): Promise<LogEntry[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: logsData, error } = await supabase
      .from('audit_logs')
      .select('id, user_name, action, details, log_type, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Failed to fetch audit logs from Supabase:', error);
      return [];
    }

    if (!logsData) return [];

    return logsData.map((l: any) => ({
      id: l.id,
      timestamp: new Date(l.created_at).getTime(),
      user: l.user_name,
      action: l.action,
      details: l.details,
      type: l.log_type as any,
    }));
  } catch (err) {
    console.error('Error in getLogs:', err);
    return [];
  }
}

export async function getPaginatedLogs(options?: {
  page?: number;
  pageSize?: number;
  type?: string;
  search?: string;
}): Promise<{ logs: LogEntry[]; total: number; page: number; pageSize: number; totalPages: number }> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const page = Math.max(1, options?.page || 1);
    const pageSize = Math.max(1, Math.min(100, options?.pageSize || 10));
    const offset = (page - 1) * pageSize;

    let query = supabase
      .from('audit_logs')
      .select('id, user_name, action, details, log_type, created_at', { count: 'exact' })
      .eq('tenant_id', tenantId);

    if (options?.type && options.type !== 'all') {
      query = query.eq('log_type', options.type);
    }

    if (options?.search && options.search.trim()) {
      const s = options.search.trim();
      query = query.or(`action.ilike.%${s}%,details.ilike.%${s}%,user_name.ilike.%${s}%`);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    const { data: logsData, error, count } = await query;

    if (error) {
      console.error('Failed to fetch paginated audit logs from Supabase:', error);
      return { logs: [], total: 0, page, pageSize, totalPages: 0 };
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / pageSize) || 1;

    const logs: LogEntry[] = (logsData || []).map((l: any) => ({
      id: l.id,
      timestamp: new Date(l.created_at).getTime(),
      user: l.user_name,
      action: l.action,
      details: l.details,
      type: l.log_type as any,
    }));

    return {
      logs,
      total,
      page,
      pageSize,
      totalPages,
    };
  } catch (err) {
    console.error('Error in getPaginatedLogs:', err);
    return { logs: [], total: 0, page: 1, pageSize: 10, totalPages: 0 };
  }
}

export async function addLog(logData: Omit<LogEntry, 'id' | 'timestamp'>) {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { error } = await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      user_name: logData.user,
      action: logData.action,
      details: logData.details,
      log_type: logData.type,
    });

    if (error) {
      console.error('Failed to insert audit log into Supabase:', error);
    }
  } catch (err) {
    console.error('Error in addLog:', err);
  }
}

// --- Team Members & RBAC ---

// tenant_members is the single source of truth for who has access to a
// tenant. A "team member" is just a tenant_members row joined with its
// public.users profile -- there is no way to create one directly; access is
// only ever granted via signup (owner) or invitation acceptance (see below).

function tenantMemberRowToTeamMember(row: any): TeamMember {
  const user = Array.isArray(row.users) ? row.users[0] : row.users;
  const rawRole = row.role === 'agent' ? 'operator' : (row.role || 'operator');
  return {
    id: row.user_id,
    fullName: user?.full_name || user?.email || 'Unknown',
    email: user?.email || undefined,
    avatarUrl: row.avatar_url || undefined,
    role: rawRole as UserRole,
    status: (row.status || 'offline') as UserStatus,
    assignedQueues: row.assigned_queues || [],
    createdAt: row.created_at,
  };
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data, error } = await supabase
      .from('tenant_members')
      .select('user_id, role, status, avatar_url, assigned_queues, created_at, users(full_name, email)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to fetch tenant_members from Supabase:', error);
      return [];
    }

    return (data || []).map(tenantMemberRowToTeamMember);
  } catch (err) {
    console.error('Error in getTeamMembers:', err);
    return [];
  }
}

export async function getTeamMember(userId: string): Promise<TeamMember | undefined> {
  const members = await getTeamMembers();
  return members.find((m) => m.id === userId);
}

export async function updateTeamMember(
  userId: string,
  update: { role?: UserRole; status?: UserStatus; assignedQueues?: string[]; avatarUrl?: string },
  options?: { confirmLastAdmin?: boolean }
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    // change_team_member_atomic locks the tenant's membership rows for the
    // duration of the check-then-act sequence (existence/owner/last-admin
    // guards + the mutation itself), so two concurrent role changes for the
    // same tenant can no longer both independently pass the last-admin
    // guard and together zero out every non-owner admin.
    const { data: errorMessage, error } = await supabase.rpc('change_team_member_atomic', {
      p_tenant_id: tenantId,
      p_user_id: userId,
      p_action: 'update',
      p_new_role: update.role ?? null,
      p_new_status: update.status ?? null,
      p_new_assigned_queues: update.assignedQueues ?? null,
      p_new_avatar_url: update.avatarUrl ?? null,
      p_confirm_last_admin: !!options?.confirmLastAdmin,
    });

    if (error) {
      console.error(`Failed to update tenant member ${userId}:`, error);
      throw error;
    }
    if (errorMessage) {
      throw new Error(errorMessage as string);
    }

    // Synchronize Supabase Auth app_metadata live so active sessions reflect the new role immediately
    if (update.role !== undefined) {
      try {
        await supabase.auth.admin.updateUserById(userId, {
          app_metadata: {
            tenant_id: tenantId,
            role: update.role,
          },
        });
      } catch (authErr) {
        console.warn(`[WARN] Could not sync app_metadata for user ${userId}:`, authErr);
      }
    }
  } catch (err) {
    console.error(`Error in updateTeamMember(${userId}):`, err);
    throw err;
  }
}

export async function deleteTeamMember(
  userId: string,
  options?: { confirmLastAdmin?: boolean }
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    // Same atomic guard as updateTeamMember -- see comment there.
    const { data: errorMessage, error } = await supabase.rpc('change_team_member_atomic', {
      p_tenant_id: tenantId,
      p_user_id: userId,
      p_action: 'delete',
      p_confirm_last_admin: !!options?.confirmLastAdmin,
    });

    if (error) {
      console.error(`Failed to delete tenant member ${userId}:`, error);
      throw error;
    }
    if (errorMessage) {
      throw new Error(errorMessage as string);
    }

    // Re-synchronize or revoke Auth app_metadata live
    try {
      const { data: remainingMemberships } = await supabase
        .from('tenant_members')
        .select('tenant_id, role')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (remainingMemberships && remainingMemberships.length > 0) {
        // User is still a member of other workspaces; reassign active workspace claim to their next workspace
        const nextTenant = remainingMemberships[0];
        await supabase.auth.admin.updateUserById(userId, {
          app_metadata: {
            tenant_id: nextTenant.tenant_id,
            role: nextTenant.role,
          },
        });
      } else {
        // User has no remaining workspaces; revoke tenant access immediately
        await supabase.auth.admin.updateUserById(userId, {
          app_metadata: {
            tenant_id: null,
            role: null,
          },
        });
      }
    } catch (authErr) {
      console.warn(`[WARN] Could not update app_metadata for removed user ${userId}:`, authErr);
    }
  } catch (err) {
    console.error(`Error in deleteTeamMember(${userId}):`, err);
    throw err;
  }
}

// --- Tenant Invitations ---
// Accepting one creates a real Supabase Auth account (or links an existing
// one) and a tenant_members row -- the only way anyone ever joins a tenant.

function invitationRowToInvitation(row: any): TenantInvitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by || undefined,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at || undefined,
  };
}

export async function createTenantInvitation(params: {
  email: string;
  role: InvitationRole;
  invitedBy?: string;
}): Promise<TenantInvitation & { token: string }> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();
  const token = crypto.randomBytes(32).toString('hex');
  const email = params.email.trim().toLowerCase();

  const { data, error } = await supabase
    .from('tenant_invitations')
    .insert({
      tenant_id: tenantId,
      email,
      role: params.role,
      token,
      invited_by: params.invitedBy || null,
    })
    .select('*')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      throw new Error(`An invitation is already pending for ${email}`);
    }
    console.error('Failed to create tenant invitation:', error);
    throw error || new Error('Failed to create invitation');
  }

  return { ...invitationRowToInvitation(data), token: data.token };
}

export async function getTenantInvitations(): Promise<TenantInvitation[]> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const { data, error } = await supabase
    .from('tenant_invitations')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch tenant invitations:', error);
    return [];
  }
  // Surface expiry in the admin's list even though we only flip the DB
  // status lazily (on the next accept/join attempt against that row).
  return (data || []).map((row: any) => {
    const invitation = invitationRowToInvitation(row);
    if (invitation.status === 'pending' && new Date(invitation.expiresAt).getTime() < Date.now()) {
      invitation.status = 'expired';
    }
    return invitation;
  });
}

export async function revokeTenantInvitation(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const { error } = await supabase
    .from('tenant_invitations')
    .update({ status: 'revoked' })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('status', 'pending');

  if (error) {
    console.error(`Failed to revoke invitation ${id}:`, error);
    throw error;
  }
}

/**
 * Looks up a pending, unexpired invitation by its raw token. Used by the
 * public /invite/[token] accept flow, so it is intentionally NOT scoped to
 * the caller's RequestContext (the caller has no session yet).
 */
export async function getPendingInvitationByToken(
  token: string
): Promise<(TenantInvitation & { tenantId: string; tenantName: string }) | undefined> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('tenant_invitations')
    .select('*, tenants(name)')
    .eq('token', token)
    .eq('status', 'pending')
    .maybeSingle();

  if (error || !data) return undefined;
  if (new Date(data.expires_at).getTime() < Date.now()) return undefined;

  return {
    ...invitationRowToInvitation(data),
    tenantId: data.tenant_id,
    tenantName: (data as any).tenants?.name || 'Workspace',
  };
}

/**
 * Atomically transitions a pending invitation to 'accepted' -- the
 * conditional `.eq('status', 'pending')` means only one concurrent caller
 * can ever win this update (Postgres serializes the row update), which is
 * what makes token use-once and race-free. Call this BEFORE creating any
 * account/membership, and only proceed if it returns true; on any later
 * failure, call revertInvitationClaim to release the claim.
 */
export async function claimInvitation(id: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('tenant_invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (error) {
    console.error(`Failed to claim invitation ${id}:`, error);
    return false;
  }
  return !!data;
}

/**
 * Releases a claim taken by claimInvitation when a downstream step
 * (account creation, tenant_members insert, app_metadata update) failed,
 * so the invitation can be retried instead of being stranded as
 * "accepted" with no membership ever actually created.
 */
export async function revertInvitationClaim(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('tenant_invitations')
    .update({ status: 'pending', accepted_at: null })
    .eq('id', id)
    .eq('status', 'accepted');

  if (error) {
    console.error(`Failed to revert invitation claim ${id}:`, error);
  }
}

// --- Handoff & Routing Rules ---

const DEFAULT_HANDOFF_RULES: Array<Omit<HandoffRule, 'id' | 'createdAt' | 'updatedAt'>> = [
  {
    name: 'Customer Requesting Human Specialist',
    description: 'Triggers when a customer explicitly asks to talk to a real person, agent, or supervisor.',
    isEnabled: true,
    ruleType: 'keyword_match',
    conditions: {
      keywords: ['human', 'agent', 'operator', 'representative', 'real person', 'talk to someone', 'urgent', 'person', 'supervisor', 'speak to a human'],
    },
    actions: {
      assignToUserId: undefined,
      autoPauseAi: true,
      transitionMessage: "I am connecting you with one of our human support specialists who will assist you shortly.",
      notificationType: 'in_app',
    },
    priority: 100,
  },
  {
    name: 'Low AI Confidence Guardrail',
    description: 'Automatically pauses AI and notifies human agents when AI answer confidence falls below 65%.',
    isEnabled: true,
    ruleType: 'confidence_threshold',
    conditions: {
      threshold: 0.65,
    },
    actions: {
      assignToUserId: undefined,
      autoPauseAi: true,
      transitionMessage: "I'm escalating this conversation to a team member to make sure you get accurate information.",
      notificationType: 'in_app',
    },
    priority: 90,
  },
  {
    name: 'Escalate Frustration & Customer Complaints',
    description: 'Detects angry sentiment, complaint intents, refund disputes, or account cancellation demands.',
    isEnabled: true,
    ruleType: 'intent_detected',
    conditions: {
      intents: ['complaint_frustration', 'billing_refund', 'cancellation', 'technical_escalation'],
    },
    actions: {
      assignToUserId: undefined,
      autoPauseAi: true,
      transitionMessage: "I understand this is important. I've flagged this for our senior team member who is reviewing your chat now.",
      notificationType: 'in_app',
    },
    priority: 80,
  },
  {
    name: 'Consecutive Fallback Protection',
    description: 'Triggers handoff if 2 consecutive customer messages trigger fallback responses without clear resolution.',
    isEnabled: true,
    ruleType: 'consecutive_fallback',
    conditions: {
      consecutiveFallbacks: 2,
    },
    actions: {
      assignToUserId: undefined,
      autoPauseAi: true,
      transitionMessage: "I want to ensure you get the best possible help. I'm connecting you with a human team member.",
      notificationType: 'in_app',
    },
    priority: 70,
  },
];

export async function getHandoffRules(): Promise<HandoffRule[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: rulesData, error } = await supabase
      .from('handoff_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to fetch handoff rules from Supabase:', error);
      return [];
    }

    // Auto-seed default rules if none exist
    if (!rulesData || rulesData.length === 0) {
      console.log('No handoff rules found for tenant. Seeding default initial rules...');
      const createdRules: HandoffRule[] = [];
      for (const defRule of DEFAULT_HANDOFF_RULES) {
        try {
          const rule = await createHandoffRule(defRule);
          createdRules.push(rule);
        } catch (seedErr) {
          console.error('Failed to seed default rule:', seedErr);
        }
      }
      return createdRules.length > 0 ? createdRules : [];
    }

    return rulesData.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description || '',
      isEnabled: r.is_enabled !== false,
      ruleType: r.rule_type,
      conditions: r.conditions || {},
      actions: r.actions || { autoPauseAi: true },
      priority: r.priority || 0,
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : undefined,
    }));
  } catch (err) {
    console.error('Error in getHandoffRules:', err);
    return [];
  }
}

export async function getHandoffRule(id: string): Promise<HandoffRule | undefined> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: r, error } = await supabase
      .from('handoff_rules')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error || !r) return undefined;

    return {
      id: r.id,
      name: r.name,
      description: r.description || '',
      isEnabled: r.is_enabled !== false,
      ruleType: r.rule_type,
      conditions: r.conditions || {},
      actions: r.actions || { autoPauseAi: true },
      priority: r.priority || 0,
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : undefined,
    };
  } catch (err) {
    console.error(`Error in getHandoffRule(${id}):`, err);
    return undefined;
  }
}

export async function createHandoffRule(
  ruleData: Omit<HandoffRule, 'id' | 'createdAt' | 'updatedAt'>
): Promise<HandoffRule> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const { data: newRule, error } = await supabase
    .from('handoff_rules')
    .insert({
      tenant_id: tenantId,
      name: ruleData.name,
      description: ruleData.description || '',
      is_enabled: ruleData.isEnabled !== false,
      rule_type: ruleData.ruleType,
      conditions: ruleData.conditions || {},
      actions: ruleData.actions || { autoPauseAi: true },
      priority: ruleData.priority || 0,
    })
    .select('*')
    .single();

  if (error || !newRule) {
    console.error('Failed to insert handoff rule:', error);
    throw new Error('Failed to create handoff rule');
  }

  return {
    id: newRule.id,
    name: newRule.name,
    description: newRule.description || '',
    isEnabled: newRule.is_enabled !== false,
    ruleType: newRule.rule_type,
    conditions: newRule.conditions || {},
    actions: newRule.actions || { autoPauseAi: true },
    priority: newRule.priority || 0,
    createdAt: new Date(newRule.created_at).getTime(),
    updatedAt: newRule.updated_at ? new Date(newRule.updated_at).getTime() : undefined,
  };
}

export async function updateHandoffRule(
  id: string,
  update: Partial<Omit<HandoffRule, 'id' | 'createdAt'>>
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const payload: any = { updated_at: new Date().toISOString() };
    if (update.name !== undefined) payload.name = update.name;
    if (update.description !== undefined) payload.description = update.description;
    if (update.isEnabled !== undefined) payload.is_enabled = update.isEnabled;
    if (update.ruleType !== undefined) payload.rule_type = update.ruleType;
    if (update.conditions !== undefined) payload.conditions = update.conditions;
    if (update.actions !== undefined) payload.actions = update.actions;
    if (update.priority !== undefined) payload.priority = update.priority;

    const { error } = await supabase
      .from('handoff_rules')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error(`Failed to update handoff rule ${id}:`, error);
      throw error;
    }
  } catch (err) {
    console.error(`Error in updateHandoffRule(${id}):`, err);
    throw err;
  }
}

export async function deleteHandoffRule(id: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { error } = await supabase
      .from('handoff_rules')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error(`Failed to delete handoff rule ${id}:`, error);
      throw error;
    }
  } catch (err) {
    console.error(`Error in deleteHandoffRule(${id}):`, err);
    throw err;
  }
}

// --- Canned Responses (Quick Replies) ---

const DEFAULT_CANNED_RESPONSES: Array<Omit<CannedResponse, 'id' | 'createdAt' | 'updatedAt'>> = [
  {
    title: 'Customer Introduction & Greeting',
    shortcut: 'intro',
    content: 'Hello! Thank you for contacting our support team. How can I assist you today?',
    category: 'greeting',
  },
  {
    title: 'Standard Operating Hours',
    shortcut: 'hours',
    content: 'Our business hours are Monday through Friday, 9:00 AM – 6:00 PM (EST). We are also on call for urgent requests on weekends.',
    category: 'general',
  },
  {
    title: 'Pricing & Plans Information',
    shortcut: 'pricing',
    content: 'You can explore our available plans and packages on our pricing page, or let me know your requirements for a customized quote.',
    category: 'sales',
  },
  {
    title: 'Human Specialist Takeover Intro',
    shortcut: 'handoff',
    content: 'I have taken over this conversation and reviewed your previous messages. I am here to help resolve this for you directly.',
    category: 'support',
  },
  {
    title: 'Issue Resolved Closing',
    shortcut: 'resolved',
    content: 'Thank you for reaching out to us today! If you have any further questions in the future, please feel free to message us again. Have a great day!',
    category: 'closing',
  },
];

export async function getCannedResponses(): Promise<CannedResponse[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: list, error } = await supabase
      .from('canned_responses')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to fetch canned responses from Supabase:', error);
      return [];
    }

    // Auto-seed default initial canned responses if empty
    if (!list || list.length === 0) {
      console.log('No canned responses found. Auto-seeding default templates...');
      const created: CannedResponse[] = [];
      for (const def of DEFAULT_CANNED_RESPONSES) {
        try {
          const item = await createCannedResponse(def);
          created.push(item);
        } catch (seedErr) {
          console.error('Failed to seed default canned response:', seedErr);
        }
      }
      return created.length > 0 ? created : [];
    }

    return list.map((r: any) => ({
      id: r.id,
      title: r.title,
      shortcut: r.shortcut,
      content: r.content,
      category: r.category || 'general',
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : undefined,
    }));
  } catch (err) {
    console.error('Error in getCannedResponses:', err);
    return [];
  }
}

export async function getCannedResponse(id: string): Promise<CannedResponse | undefined> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: r, error } = await supabase
      .from('canned_responses')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error || !r) return undefined;

    return {
      id: r.id,
      title: r.title,
      shortcut: r.shortcut,
      content: r.content,
      category: r.category || 'general',
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : undefined,
    };
  } catch (err) {
    console.error(`Error in getCannedResponse(${id}):`, err);
    return undefined;
  }
}

export async function createCannedResponse(
  data: Omit<CannedResponse, 'id' | 'createdAt' | 'updatedAt'>
): Promise<CannedResponse> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const cleanShortcut = data.shortcut.replace(/^\//, '').trim().toLowerCase();

  const { data: newRow, error } = await supabase
    .from('canned_responses')
    .insert({
      tenant_id: tenantId,
      title: data.title.trim(),
      shortcut: cleanShortcut,
      content: data.content.trim(),
      category: data.category || 'general',
    })
    .select('*')
    .single();

  if (error || !newRow) {
    console.error('Failed to create canned response in Supabase:', error);
    throw new Error('Failed to create canned response');
  }

  return {
    id: newRow.id,
    title: newRow.title,
    shortcut: newRow.shortcut,
    content: newRow.content,
    category: newRow.category || 'general',
    createdAt: new Date(newRow.created_at).getTime(),
    updatedAt: newRow.updated_at ? new Date(newRow.updated_at).getTime() : undefined,
  };
}

export async function updateCannedResponse(
  id: string,
  update: Partial<Omit<CannedResponse, 'id' | 'createdAt'>>
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const payload: any = { updated_at: new Date().toISOString() };
    if (update.title !== undefined) payload.title = update.title.trim();
    if (update.shortcut !== undefined) payload.shortcut = update.shortcut.replace(/^\//, '').trim().toLowerCase();
    if (update.content !== undefined) payload.content = update.content.trim();
    if (update.category !== undefined) payload.category = update.category;

    const { error } = await supabase
      .from('canned_responses')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error(`Failed to update canned response ${id}:`, error);
      throw error;
    }
  } catch (err) {
    console.error(`Error in updateCannedResponse(${id}):`, err);
    throw err;
  }
}

export async function deleteCannedResponse(id: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { error } = await supabase
      .from('canned_responses')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error(`Failed to delete canned response ${id}:`, error);
      throw error;
    }
  } catch (err) {
    console.error(`Error in deleteCannedResponse(${id}):`, err);
    throw err;
  }
}

// --- Internal Conversation Notes ---

export async function getConversationNotes(chatId: string): Promise<ConversationNote[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data, error } = await supabase
      .from('conversation_notes')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error(`Failed to fetch conversation notes for ${chatId}:`, error);
      return [];
    }

    return (data || []).map((n: any) => ({
      id: n.id,
      chatId: n.chat_id,
      userId: n.user_id || undefined,
      userName: n.user_name || 'Agent',
      userAvatar: n.user_avatar || undefined,
      content: n.content,
      createdAt: new Date(n.created_at).getTime(),
    }));
  } catch (err) {
    console.error(`Error in getConversationNotes(${chatId}):`, err);
    return [];
  }
}

export async function createConversationNote(
  data: Omit<ConversationNote, 'id' | 'createdAt'>
): Promise<ConversationNote> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const { data: newRow, error } = await supabase
    .from('conversation_notes')
    .insert({
      tenant_id: tenantId,
      chat_id: data.chatId,
      user_id: data.userId || null,
      user_name: data.userName || 'Agent',
      user_avatar: data.userAvatar || null,
      content: data.content.trim(),
    })
    .select('*')
    .single();

  if (error || !newRow) {
    console.error('Failed to create conversation note in Supabase:', error);
    throw new Error('Failed to create internal note');
  }

  return {
    id: newRow.id,
    chatId: newRow.chat_id,
    userId: newRow.user_id || undefined,
    userName: newRow.user_name,
    userAvatar: newRow.user_avatar || undefined,
    content: newRow.content,
    createdAt: new Date(newRow.created_at).getTime(),
  };
}

export async function deleteConversationNote(id: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { error } = await supabase
      .from('conversation_notes')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error(`Failed to delete conversation note ${id}:`, error);
      throw error;
    }
  } catch (err) {
    console.error(`Error in deleteConversationNote(${id}):`, err);
    throw err;
  }
}

// --- Contact CRM & Profile ---

export async function getContactProfile(chatId: string): Promise<ContactProfile | undefined> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId, channelId } = await ensureDefaultTenantAndChannel();

    // Find contact channel
    const { data: cc, error: ccErr } = await supabase
      .from('contact_channels')
      .select('contact_id')
      .eq('tenant_id', tenantId)
      .eq('channel_id', channelId)
      .eq('external_id', chatId)
      .maybeSingle();

    if (ccErr || !cc) {
      return undefined;
    }

    const { data: contact, error: cErr } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', cc.contact_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (cErr || !contact) return undefined;

    // Get message count
    let msgCount = 0;
    const { data: convo } = await supabase
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('contact_id', cc.contact_id)
      .maybeSingle();

    if (convo) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('conversation_id', convo.id);
      msgCount = count || 0;
    }

    return {
      id: contact.id,
      name: contact.name || chatId.split('@')[0],
      avatarUrl: contact.avatar_url || undefined,
      phone: chatId.split('@')[0],
      email: contact.email || undefined,
      company: contact.company || undefined,
      stage: (contact.stage as LeadStage) || 'lead',
      tags: contact.tags || [],
      notes: contact.notes || '',
      customAttributes: contact.custom_attributes || {},
      createdAt: new Date(contact.created_at).getTime(),
      updatedAt: contact.updated_at ? new Date(contact.updated_at).getTime() : undefined,
      messageCount: msgCount || 0,
    };
  } catch (err) {
    console.error(`Error in getContactProfile(${chatId}):`, err);
    return undefined;
  }
}

export async function getAllContactProfiles(options?: {
  stage?: LeadStage | 'all';
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  clients: ClientDetailItem[];
  total: number;
  stageCounts: Record<string, number>;
}> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    // Query all contacts in the tenant with contact_channels and conversations
    const { data: contactsData, error } = await supabase
      .from('contacts')
      .select(`
        *,
        contact_channels (
          id,
          channel_id,
          external_id,
          phone_number,
          created_at
        ),
        conversations (
          id,
          last_message_at,
          last_message_text,
          status
        )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error || !contactsData) {
      console.error('Failed to fetch contact profiles:', error);
      return { clients: [], total: 0, stageCounts: { all: 0, lead: 0, prospect: 0, customer: 0, vip: 0, churned: 0 } };
    }

    // Get all conversation IDs to aggregate message counts
    const convoIds: string[] = [];
    const convoToContactMap = new Map<string, string>();
    for (const c of contactsData) {
      const convos = c.conversations || [];
      for (const cv of convos) {
        if (cv.id) {
          convoIds.push(cv.id);
          convoToContactMap.set(cv.id, c.id);
        }
      }
    }

    const contactMsgCountMap = new Map<string, number>();
    if (convoIds.length > 0) {
      const { data: msgs, error: msgErr } = await supabase
        .from('messages')
        .select('conversation_id')
        .eq('tenant_id', tenantId)
        .in('conversation_id', convoIds);

      if (!msgErr && msgs) {
        for (const m of msgs) {
          const cid = convoToContactMap.get(m.conversation_id);
          if (cid) {
            contactMsgCountMap.set(cid, (contactMsgCountMap.get(cid) || 0) + 1);
          }
        }
      }
    }

    const stageCounts: Record<string, number> = {
      all: 0,
      lead: 0,
      prospect: 0,
      customer: 0,
      vip: 0,
      churned: 0,
    };

    const allProcessedClients: ClientDetailItem[] = [];

    for (const contact of contactsData) {
      const channels = contact.contact_channels || [];
      const phoneChannel = channels.find((ch: any) => ch.external_id?.endsWith('@s.whatsapp.net'));
      const rawExtId = phoneChannel?.external_id || channels[0]?.external_id || contact.phone || contact.name || contact.id;

      // Skip internal WhatsApp system broadcasts
      if (
        rawExtId === 'status@broadcast' ||
        rawExtId.endsWith('@broadcast') ||
        rawExtId.endsWith('@newsletter') ||
        rawExtId === 'status'
      ) {
        continue;
      }

      const externalId = rawExtId;
      const formattedPhone = formatPhoneNumber(externalId || contact.phone || '');
      const displayName = formatContactName(contact.name, externalId);
      const stage: LeadStage = (contact.stage as LeadStage) || 'lead';
      const msgCount = contactMsgCountMap.get(contact.id) || 0;
      const initials = getAvatarInitials(displayName, externalId);

      const convos = contact.conversations || [];
      let lastActiveTime: number | undefined = undefined;
      if (convos.length > 0 && convos[0].last_message_at) {
        lastActiveTime = new Date(convos[0].last_message_at).getTime();
      }

      // Increment stage counter
      stageCounts.all = (stageCounts.all || 0) + 1;
      if (stageCounts[stage] !== undefined) {
        stageCounts[stage] = (stageCounts[stage] || 0) + 1;
      }

      allProcessedClients.push({
        id: contact.id,
        name: displayName,
        avatarUrl: contact.avatar_url || undefined,
        phone: contact.phone || (externalId.includes('@') ? externalId.split('@')[0] : externalId),
        email: contact.email || undefined,
        company: contact.company || undefined,
        stage,
        tags: contact.tags || [],
        notes: contact.notes || '',
        customAttributes: contact.custom_attributes || {},
        createdAt: new Date(contact.created_at).getTime(),
        updatedAt: contact.updated_at ? new Date(contact.updated_at).getTime() : undefined,
        messageCount: msgCount,
        externalId,
        formattedPhone,
        lastActiveAt: lastActiveTime,
        initials,
      });
    }

    let filteredClients = allProcessedClients;

    // Filter by stage if requested
    if (options?.stage && options.stage !== 'all') {
      filteredClients = filteredClients.filter(c => c.stage === options.stage);
    }

    // Filter by search query if requested
    if (options?.search) {
      const q = options.search.toLowerCase().trim();
      filteredClients = filteredClients.filter(c => {
        return (
          c.name.toLowerCase().includes(q) ||
          c.formattedPhone.toLowerCase().includes(q) ||
          (c.email && c.email.toLowerCase().includes(q)) ||
          (c.company && c.company.toLowerCase().includes(q)) ||
          (c.tags && c.tags.some((t: string) => t.toLowerCase().includes(q)))
        );
      });
    }

    const total = filteredClients.length;

    // Pagination: the function has always accepted limit/offset, but they
    // were silently ignored -- every call returned the full filtered list
    // regardless of what page was requested. `total` still reflects the
    // full filtered count (for page-count UI); `clients` is now the actual
    // requested page.
    let pagedClients = filteredClients;
    if (options?.offset || options?.limit) {
      const start = options?.offset || 0;
      const end = options?.limit ? start + options.limit : undefined;
      pagedClients = filteredClients.slice(start, end);
    }

    return {
      clients: pagedClients,
      total,
      stageCounts,
    };
  } catch (err) {
    console.error('Error in getAllContactProfiles:', err);
    return { clients: [], total: 0, stageCounts: { all: 0, lead: 0, prospect: 0, customer: 0, vip: 0, churned: 0 } };
  }
}

export async function updateContactProfile(
  chatId: string,
  update: Partial<ContactProfile>
): Promise<ContactProfile> {
  const supabase = getSupabaseAdmin();
  const { tenantId, channelId } = await ensureDefaultTenantAndChannel();

  // 1. Get or create contact_channel & contact
  let { data: cc } = await supabase
    .from('contact_channels')
    .select('contact_id')
    .eq('tenant_id', tenantId)
    .eq('channel_id', channelId)
    .eq('external_id', chatId)
    .maybeSingle();

  let contactId = cc?.contact_id;

  if (!contactId) {
    const contactName = update.name || chatId.split('@')[0];
    const { data: newContact, error: insertErr } = await supabase
      .from('contacts')
      .insert({
        tenant_id: tenantId,
        name: contactName,
        stage: update.stage || 'lead',
        tags: update.tags || [],
        notes: update.notes || '',
        email: update.email || null,
        company: update.company || null,
        custom_attributes: update.customAttributes || {},
      })
      .select('id')
      .single();

    if (insertErr || !newContact) {
      throw new Error('Failed to create contact');
    }
    contactId = newContact.id;

    await supabase.from('contact_channels').insert({
      tenant_id: tenantId,
      contact_id: contactId,
      channel_id: channelId,
      external_id: chatId,
      phone_number: chatId.split('@')[0],
    });
  } else {
    const payload: any = { updated_at: new Date().toISOString() };
    if (update.name !== undefined) payload.name = update.name.trim();
    if (update.avatarUrl !== undefined) payload.avatar_url = update.avatarUrl;
    if (update.stage !== undefined) payload.stage = update.stage;
    if (update.tags !== undefined) payload.tags = update.tags;
    if (update.notes !== undefined) payload.notes = update.notes;
    if (update.email !== undefined) payload.email = update.email ? update.email.trim() : null;
    if (update.company !== undefined) payload.company = update.company ? update.company.trim() : null;
    if (update.customAttributes !== undefined) payload.custom_attributes = update.customAttributes;

    const { error: updateErr } = await supabase
      .from('contacts')
      .update(payload)
      .eq('id', contactId)
      .eq('tenant_id', tenantId);

    if (updateErr) {
      console.error(`Failed to update contact ${contactId}:`, updateErr);
      throw updateErr;
    }
  }

  const refreshed = await getContactProfile(chatId);
  if (!refreshed) throw new Error('Contact not found after update');
  return refreshed;
}

export async function deleteContactProfiles(options: {
  ids?: string[];
  externalIds?: string[];
}): Promise<{ count: number }> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const idsToDelete = new Set<string>(options.ids || []);

  if (options.externalIds && options.externalIds.length > 0) {
    const { data: ccData } = await supabase
      .from('contact_channels')
      .select('contact_id')
      .eq('tenant_id', tenantId)
      .in('external_id', options.externalIds);

    for (const cc of ccData || []) {
      if (cc.contact_id) {
        idsToDelete.add(cc.contact_id);
      }
    }
  }

  const finalIds = Array.from(idsToDelete);
  if (finalIds.length === 0) {
    return { count: 0 };
  }

  const { error, count } = await supabase
    .from('contacts')
    .delete({ count: 'exact' })
    .eq('tenant_id', tenantId)
    .in('id', finalIds);

  if (error) {
    console.error('Failed to bulk delete contacts:', error);
    throw new Error(error.message || 'Failed to delete contacts');
  }

  return { count: count || finalIds.length };
}

export async function addContactTag(chatId: string, tag: string): Promise<string[]> {
  const profile = await getContactProfile(chatId);
  const cleanTag = tag.trim();
  if (!cleanTag) return profile?.tags || [];

  const existingTags = profile?.tags || [];
  if (existingTags.includes(cleanTag)) return existingTags;

  const updatedTags = [...existingTags, cleanTag];
  await updateContactProfile(chatId, { tags: updatedTags });
  return updatedTags;
}

export async function removeContactTag(chatId: string, tag: string): Promise<string[]> {
  const profile = await getContactProfile(chatId);
  const cleanTag = tag.trim();
  const existingTags = profile?.tags || [];
  const updatedTags = existingTags.filter(t => t.toLowerCase() !== cleanTag.toLowerCase());

  await updateContactProfile(chatId, { tags: updatedTags });
  return updatedTags;
}

// --- Outbound Webhooks ---

export async function getWebhooks(): Promise<WebhookConfig[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch webhooks from Supabase:', error);
      return [];
    }

    return (data || []).map((w: any) => ({
      id: w.id,
      name: w.name,
      url: w.url,
      secret: w.secret,
      events: w.events as WebhookEventType[],
      isActive: !!w.is_active,
      createdAt: new Date(w.created_at).getTime(),
      updatedAt: w.updated_at ? new Date(w.updated_at).getTime() : undefined,
      lastTriggeredAt: w.last_triggered_at ? new Date(w.last_triggered_at).getTime() : undefined,
      lastStatusCode: w.last_status_code || undefined,
      failureCount: w.failure_count || 0,
    }));
  } catch (err) {
    console.error('Error in getWebhooks:', err);
    return [];
  }
}

export async function getWebhook(id: string): Promise<WebhookConfig | undefined> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: w, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error || !w) return undefined;

    return {
      id: w.id,
      name: w.name,
      url: w.url,
      secret: w.secret,
      events: w.events as WebhookEventType[],
      isActive: !!w.is_active,
      createdAt: new Date(w.created_at).getTime(),
      updatedAt: w.updated_at ? new Date(w.updated_at).getTime() : undefined,
      lastTriggeredAt: w.last_triggered_at ? new Date(w.last_triggered_at).getTime() : undefined,
      lastStatusCode: w.last_status_code || undefined,
      failureCount: w.failure_count || 0,
    };
  } catch (err) {
    console.error(`Error in getWebhook(${id}):`, err);
    return undefined;
  }
}

export async function createWebhook(
  data: Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt' | 'failureCount'>
): Promise<WebhookConfig> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const { data: newRow, error } = await supabase
    .from('webhooks')
    .insert({
      tenant_id: tenantId,
      name: data.name.trim(),
      url: data.url.trim(),
      secret: data.secret.trim(),
      events: data.events,
      is_active: data.isActive ?? true,
      failure_count: 0,
    })
    .select('*')
    .single();

  if (error || !newRow) {
    console.error('Failed to create webhook in Supabase:', error);
    throw new Error('Failed to create webhook');
  }

  return {
    id: newRow.id,
    name: newRow.name,
    url: newRow.url,
    secret: newRow.secret,
    events: newRow.events as WebhookEventType[],
    isActive: !!newRow.is_active,
    createdAt: new Date(newRow.created_at).getTime(),
    updatedAt: newRow.updated_at ? new Date(newRow.updated_at).getTime() : undefined,
    lastTriggeredAt: newRow.last_triggered_at ? new Date(newRow.last_triggered_at).getTime() : undefined,
    lastStatusCode: newRow.last_status_code || undefined,
    failureCount: newRow.failure_count || 0,
  };
}

export async function updateWebhook(
  id: string,
  update: Partial<WebhookConfig>
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const payload: any = { updated_at: new Date().toISOString() };
    if (update.name !== undefined) payload.name = update.name.trim();
    if (update.url !== undefined) payload.url = update.url.trim();
    if (update.secret !== undefined) payload.secret = update.secret.trim();
    if (update.events !== undefined) payload.events = update.events;
    if (update.isActive !== undefined) payload.is_active = update.isActive;

    const { error } = await supabase
      .from('webhooks')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error(`Failed to update webhook ${id}:`, error);
      throw error;
    }
  } catch (err) {
    console.error(`Error in updateWebhook(${id}):`, err);
    throw err;
  }
}

export async function deleteWebhook(id: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { error } = await supabase
      .from('webhooks')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error(`Failed to delete webhook ${id}:`, error);
      throw error;
    }
  } catch (err) {
    console.error(`Error in deleteWebhook(${id}):`, err);
    throw err;
  }
}

export async function recordWebhookDelivery(
  id: string,
  statusCode: number,
  isSuccess: boolean
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: existing } = await supabase
      .from('webhooks')
      .select('failure_count')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const currentFailures = existing?.failure_count || 0;
    const newFailures = isSuccess ? 0 : currentFailures + 1;

    await supabase
      .from('webhooks')
      .update({
        last_triggered_at: new Date().toISOString(),
        last_status_code: statusCode,
        failure_count: newFailures,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId);
  } catch (err) {
    console.error(`Error recording webhook delivery for ${id}:`, err);
  }
}

// --- Dashboard Analytics Reset Checkpoint ---

// Reading/writing a single per-tenant "reset" timestamp lets an admin zero
// out the dashboard without deleting real conversation/message/audit_log
// history that Inbox, Client Details, and Activity still depend on.
export async function getAnalyticsResetAt(tenantId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('tenants')
      .select('analytics_reset_at')
      .eq('id', tenantId)
      .maybeSingle();
    return (data as { analytics_reset_at: string | null } | null)?.analytics_reset_at || null;
  } catch (err) {
    console.error('Error in getAnalyticsResetAt:', err);
    return null;
  }
}

export async function resetAnalyticsBaseline(tenantId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('tenants')
    .update({ analytics_reset_at: new Date().toISOString() })
    .eq('id', tenantId);

  if (error) {
    throw new Error(`Failed to reset analytics baseline: ${error.message}`);
  }
}

// --- SLA & Agent Performance Metrics ---

const SLA_METRICS_LOOKBACK_DAYS = 90;

export async function getSLAMetrics(): Promise<SLAMetrics> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    // SLA/agent performance is inherently about recent activity -- bound the
    // scan instead of fetching a tenant's entire conversation history on
    // every dashboard load.
    const lookbackSince = new Date(Date.now() - SLA_METRICS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const resetAt = await getAnalyticsResetAt(tenantId);
    const effectiveSince = resetAt && resetAt > lookbackSince ? resetAt : lookbackSince;

    const { data: convos, error } = await supabase
      .from('conversations')
      .select('assigned_user_id, status, sentiment, first_response_time_ms, resolution_duration_ms')
      .eq('tenant_id', tenantId)
      .gte('created_at', effectiveSince);

    const teamMembers = await getTeamMembers();
    const teamMemberMap = new Map<string, TeamMember>();
    teamMembers.forEach(m => teamMemberMap.set(m.id, m));

    if (error || !convos) {
      return {
        avgFirstResponseTimeMs: 0,
        avgResolutionDurationMs: 0,
        totalResolved: 0,
        sentimentBreakdown: { positive: 0, neutral: 0, negative: 0, frustrated: 0 },
        agentLeaderboard: [],
      };
    }

    let frtSum = 0;
    let frtCount = 0;
    let durationSum = 0;
    let resolvedCount = 0;

    const sentimentCounts = {
      positive: 0,
      neutral: 0,
      negative: 0,
      frustrated: 0,
    };

    const agentStatsMap = new Map<string, { count: number; totalDuration: number; resolvedCount: number }>();

    for (const c of convos) {
      if (c.first_response_time_ms && c.first_response_time_ms > 0) {
        frtSum += c.first_response_time_ms;
        frtCount++;
      }

      if (c.status === 'resolved') {
        resolvedCount++;
        if (c.resolution_duration_ms && c.resolution_duration_ms > 0) {
          durationSum += c.resolution_duration_ms;
        }
      }

      const s = (c.sentiment || 'neutral') as keyof typeof sentimentCounts;
      if (sentimentCounts[s] !== undefined) {
        sentimentCounts[s]++;
      } else {
        sentimentCounts.neutral++;
      }

      if (c.assigned_user_id) {
        const existing = agentStatsMap.get(c.assigned_user_id) || { count: 0, totalDuration: 0, resolvedCount: 0 };
        existing.count++;
        if (c.status === 'resolved' && c.resolution_duration_ms) {
          existing.totalDuration += c.resolution_duration_ms;
          existing.resolvedCount++;
        }
        agentStatsMap.set(c.assigned_user_id, existing);
      }
    }

    const avgFirstResponseTimeMs = frtCount > 0 ? Math.round(frtSum / frtCount) : 0;
    const avgResolutionDurationMs = resolvedCount > 0 ? Math.round(durationSum / resolvedCount) : 0;

    const agentLeaderboard = Array.from(agentStatsMap.entries()).map(([userId, stats]) => {
      const member = teamMemberMap.get(userId);
      return {
        userId,
        fullName: member?.fullName || userId,
        avatarUrl: member?.avatarUrl,
        conversationsHandled: stats.count,
        avgResolutionTimeMs: stats.resolvedCount > 0 ? Math.round(stats.totalDuration / stats.resolvedCount) : 0,
      };
    }).sort((a, b) => b.conversationsHandled - a.conversationsHandled);

    return {
      avgFirstResponseTimeMs,
      avgResolutionDurationMs,
      totalResolved: resolvedCount,
      sentimentBreakdown: sentimentCounts,
      agentLeaderboard,
    };
  } catch (err) {
    console.error('Error in getSLAMetrics:', err);
    return {
      avgFirstResponseTimeMs: 0,
      avgResolutionDurationMs: 0,
      totalResolved: 0,
      sentimentBreakdown: { positive: 0, neutral: 0, negative: 0, frustrated: 0 },
      agentLeaderboard: [],
    };
  }
}

// --- Web Chat Widget Configuration ---

const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  title: 'Chat with Support',
  primaryColor: '#6366F1',
  greeting: 'Hi there! 👋 How can we help you today?',
  botAvatar: '🤖',
  botName: 'AI Assistant',
  placeholder: 'Type your message...',
  allowedOrigins: ['*'],
};

export async function getWidgetConfig(explicitTenantId?: string): Promise<WidgetConfig> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel(explicitTenantId);

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('widget_settings')
      .eq('id', tenantId)
      .maybeSingle();

    if (error || !tenant?.widget_settings) {
      return DEFAULT_WIDGET_CONFIG;
    }

    return {
      ...DEFAULT_WIDGET_CONFIG,
      ...tenant.widget_settings,
    };
  } catch (err) {
    console.error('Error in getWidgetConfig:', err);
    return DEFAULT_WIDGET_CONFIG;
  }
}

export async function updateWidgetConfig(config: Partial<WidgetConfig>, explicitTenantId?: string): Promise<WidgetConfig> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel(explicitTenantId);

  const current = await getWidgetConfig(tenantId);
  const updated: WidgetConfig = {
    ...current,
    ...config,
  };

  const { error } = await supabase
    .from('tenants')
    .update({ widget_settings: updated })
    .eq('id', tenantId);

  if (error) {
    console.error('Failed to update widget_settings:', error);
    throw error;
  }

  return updated;
}

/**
 * Executes stored procedure to merge existing duplicate ghost contacts within the current tenant.
 */
export async function mergeDuplicateContacts(): Promise<{ success: boolean; mergedGroups: number }> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();
    const { data, error } = await supabase.rpc('merge_duplicate_contacts_atomic', {
      p_tenant_id: tenantId,
    });
    if (!error && data?.success) {
      return { success: true, mergedGroups: data?.merged_groups || 0 };
    }

    // Resilient fallback: in-app merge query if remote RPC is pending migration
    const { data: channels } = await supabase
      .from('contact_channels')
      .select('contact_id, phone_number, external_id')
      .eq('tenant_id', tenantId)
      .not('phone_number', 'is', null);

    if (!channels || channels.length === 0) {
      return { success: true, mergedGroups: 0 };
    }

    const phoneGroups: Record<string, string[]> = {};
    for (const c of channels) {
      if (!c.phone_number) continue;
      if (!phoneGroups[c.phone_number]) phoneGroups[c.phone_number] = [];
      if (!phoneGroups[c.phone_number].includes(c.contact_id)) {
        phoneGroups[c.phone_number].push(c.contact_id);
      }
    }

    let mergedCount = 0;
    for (const [, contactIds] of Object.entries(phoneGroups)) {
      if (contactIds.length <= 1) continue;
      const primaryId = contactIds[0];
      const dupIds = contactIds.slice(1);

      await supabase
        .from('contact_channels')
        .update({ contact_id: primaryId })
        .in('contact_id', dupIds)
        .eq('tenant_id', tenantId);

      await supabase
        .from('conversations')
        .delete()
        .in('contact_id', dupIds)
        .eq('tenant_id', tenantId);

      await supabase
        .from('contacts')
        .delete()
        .in('id', dupIds)
        .eq('tenant_id', tenantId);

      mergedCount++;
    }

    return { success: true, mergedGroups: mergedCount };
  } catch (err) {
    console.error('Error in mergeDuplicateContacts:', err);
    return { success: false, mergedGroups: 0 };
  }
}

/**
 * Manually merges a specific duplicate contact (identified by its chat/JID) into a target
 * contact identified by another chat/JID or a phone number. Used as the fallback for @lid-based
 * contacts, which cannot be reconciled automatically since Baileys has no LID->phone resolution API.
 */
export async function mergeContactByChatId(
  sourceChatId: string,
  targetIdentifier: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: sourceChannel } = await supabase
      .from('contact_channels')
      .select('contact_id')
      .eq('tenant_id', tenantId)
      .eq('external_id', sourceChatId)
      .maybeSingle();

    if (!sourceChannel?.contact_id) {
      return { success: false, message: `No contact found for "${sourceChatId}".` };
    }

    let targetContactId: string | undefined;

    if (targetIdentifier.includes('@')) {
      const { data: targetChannel } = await supabase
        .from('contact_channels')
        .select('contact_id')
        .eq('tenant_id', tenantId)
        .eq('external_id', targetIdentifier)
        .maybeSingle();
      targetContactId = targetChannel?.contact_id;
    } else {
      const normalizedPhone = targetIdentifier.replace(/[^0-9]/g, '');
      const { data: targetChannel } = await supabase
        .from('contact_channels')
        .select('contact_id')
        .eq('tenant_id', tenantId)
        .eq('phone_number', normalizedPhone)
        .maybeSingle();
      targetContactId = targetChannel?.contact_id;
    }

    if (!targetContactId) {
      return { success: false, message: `No contact found for "${targetIdentifier}".` };
    }

    if (targetContactId === sourceChannel.contact_id) {
      return { success: false, message: 'Source and target already resolve to the same contact.' };
    }

    const { data, error } = await supabase.rpc('merge_two_contacts_atomic', {
      p_tenant_id: tenantId,
      p_primary_contact_id: targetContactId,
      p_duplicate_contact_id: sourceChannel.contact_id,
    });

    if (error || !data?.success) {
      console.error('Error running merge_two_contacts_atomic:', error || data?.error);
      return { success: false, message: data?.error || error?.message || 'Merge failed.' };
    }

    return { success: true };
  } catch (err: any) {
    console.error('Error in mergeContactByChatId:', err);
    return { success: false, message: err.message || 'Merge failed.' };
  }
}

// --- Proactive Re-Engagement & Auto Follow-Up ---

export const DEFAULT_REENGAGEMENT_CONFIG: ReEngagementConfig = {
  isEnabled: false,
  inactivityHoursThreshold: 24,
  maxFollowUpsPerConversation: 1,
  followUpMessageTemplate: 'Hi {{name}}, just checking in to see if you needed any further assistance with your inquiry?',
  onlyUnresolved: true,
  aiGeneratedContextual: true,
  scanIntervalMinutes: 60,
};

export async function getReEngagementConfig(): Promise<ReEngagementConfig> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('widget_settings')
      .eq('id', tenantId)
      .maybeSingle();

    if (error || !tenant?.widget_settings?.re_engagement) {
      return DEFAULT_REENGAGEMENT_CONFIG;
    }

    return {
      ...DEFAULT_REENGAGEMENT_CONFIG,
      ...tenant.widget_settings.re_engagement,
    };
  } catch (err) {
    console.error('Error in getReEngagementConfig:', err);
    return DEFAULT_REENGAGEMENT_CONFIG;
  }
}

export async function updateReEngagementConfig(config: Partial<ReEngagementConfig>): Promise<ReEngagementConfig> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const current = await getReEngagementConfig();
  const updated: ReEngagementConfig = {
    ...current,
    ...config,
  };

  const { data: tenant } = await supabase
    .from('tenants')
    .select('widget_settings')
    .eq('id', tenantId)
    .maybeSingle();

  const currentSettings = tenant?.widget_settings || {};
  const newSettings = {
    ...currentSettings,
    re_engagement: updated,
  };

  const { error } = await supabase
    .from('tenants')
    .update({ widget_settings: newSettings })
    .eq('id', tenantId);

  if (error) {
    console.error('Failed to update re_engagement settings in Supabase:', error);
    throw error;
  }

  return updated;
}

/**
 * Finds open conversations where the last message was sent earlier than the threshold
 * and re-engagement hasn't exceeded the max follow-ups.
 */
export async function getStaleConversationsForReEngagement(
  inactivityHours = 24,
  maxFollowUps = 1
): Promise<Conversation[]> {
  try {
    const thresholdMs = Date.now() - (inactivityHours * 60 * 60 * 1000);
    // Push the "older than threshold" filter down to the DB instead of
    // scanning every conversation the tenant has ever had.
    const staleConvos = await getConversations({ beforeLastMessageAt: new Date(thresholdMs).toISOString() });

    return staleConvos.filter((c) => {
      if (c.status === 'resolved') return false;
      const count = c.reEngagementCount || (c.handoffMetadata?.reEngagementCount as number) || 0;
      if (count >= maxFollowUps) return false;
      return true;
    });
  } catch (err) {
    console.error('Error in getStaleConversationsForReEngagement:', err);
    return [];
  }
}

// ============================================================================
// Scheduled Messages Database Layer
// ============================================================================

function mapScheduledMessageRow(row: any): ScheduledMessage {
  return {
    id: row.id,
    recipientJid: row.recipient_jid,
    recipientName: row.recipient_name || undefined,
    messageType: row.message_type || 'text',
    content: row.content || undefined,
    mediaUrl: row.media_url || undefined,
    mediaMimeType: row.media_mime_type || undefined,
    mediaFileName: row.media_file_name || undefined,
    scheduledAt: row.scheduled_at,
    status: row.status || 'pending',
    errorMessage: row.error_message || undefined,
    sentAt: row.sent_at || undefined,
    baileysMessageId: row.baileys_message_id || undefined,
    createdByUserId: row.created_by_user_id || undefined,
    createdByName: row.created_by_name || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
  };
}

export async function getScheduledMessages(options?: {
  status?: ScheduledMessageStatus;
  limit?: number;
  offset?: number;
}): Promise<ScheduledMessage[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    let query = supabase
      .from('scheduled_messages')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('scheduled_at', { ascending: true });

    if (options?.status) {
      query = query.eq('status', options.status);
    }
    if (options?.limit) {
      query = query.limit(options.limit);
    }
    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching scheduled messages:', error);
      return [];
    }

    return (data || []).map(mapScheduledMessageRow);
  } catch (err) {
    console.error('Unexpected error in getScheduledMessages:', err);
    return [];
  }
}

export async function getScheduledMessage(id: string): Promise<ScheduledMessage | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data, error } = await supabase
      .from('scheduled_messages')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error || !data) return null;
    return mapScheduledMessageRow(data);
  } catch (err) {
    console.error('Error in getScheduledMessage:', err);
    return null;
  }
}

export async function createScheduledMessage(input: {
  recipientJid: string;
  recipientName?: string;
  messageType: ScheduledMessageType;
  content?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaFileName?: string;
  scheduledAt: string;
  createdByUserId?: string;
  createdByName?: string;
}): Promise<ScheduledMessage> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const insertPayload = {
    tenant_id: tenantId,
    recipient_jid: input.recipientJid,
    recipient_name: input.recipientName || null,
    message_type: input.messageType,
    content: input.content || null,
    media_url: input.mediaUrl || null,
    media_mime_type: input.mediaMimeType || null,
    media_file_name: input.mediaFileName || null,
    scheduled_at: input.scheduledAt,
    status: 'pending',
    created_by_user_id: input.createdByUserId || null,
    created_by_name: input.createdByName || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('scheduled_messages')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error || !data) {
    console.error('Failed to insert scheduled message:', error);
    throw new Error(error?.message || 'Failed to create scheduled message');
  }

  await addLog({
    user: input.createdByName || 'Operator',
    action: 'Message Scheduled',
    details: `Scheduled ${input.messageType} message for ${input.recipientName || input.recipientJid} at ${new Date(input.scheduledAt).toLocaleString()}`,
    type: 'info',
  });

  return mapScheduledMessageRow(data);
}

export async function updateScheduledMessage(
  id: string,
  updates: Partial<{
    recipientJid: string;
    recipientName: string;
    messageType: ScheduledMessageType;
    content: string;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    mediaFileName: string | null;
    scheduledAt: string;
    status: ScheduledMessageStatus;
    errorMessage: string | null;
    sentAt: string | null;
    baileysMessageId: string | null;
  }>
): Promise<ScheduledMessage | null> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const payload: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.recipientJid !== undefined) payload.recipient_jid = updates.recipientJid;
  if (updates.recipientName !== undefined) payload.recipient_name = updates.recipientName;
  if (updates.messageType !== undefined) payload.message_type = updates.messageType;
  if (updates.content !== undefined) payload.content = updates.content;
  if (updates.mediaUrl !== undefined) payload.media_url = updates.mediaUrl;
  if (updates.mediaMimeType !== undefined) payload.media_mime_type = updates.mediaMimeType;
  if (updates.mediaFileName !== undefined) payload.media_file_name = updates.mediaFileName;
  if (updates.scheduledAt !== undefined) payload.scheduled_at = updates.scheduledAt;
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.errorMessage !== undefined) payload.error_message = updates.errorMessage;
  if (updates.sentAt !== undefined) payload.sent_at = updates.sentAt;
  if (updates.baileysMessageId !== undefined) payload.baileys_message_id = updates.baileysMessageId;

  const { data, error } = await supabase
    .from('scheduled_messages')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('*')
    .single();

  if (error || !data) {
    console.error('Failed to update scheduled message:', error);
    return null;
  }

  return mapScheduledMessageRow(data);
}

export async function deleteScheduledMessage(id: string): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { error } = await supabase
      .from('scheduled_messages')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Failed to delete scheduled message:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error deleting scheduled message:', err);
    return false;
  }
}

export async function getScheduledMessageStats(): Promise<{
  pending: number;
  sentToday: number;
  failed: number;
  total: number;
}> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('scheduled_messages')
      .select('status, sent_at')
      .eq('tenant_id', tenantId);

    if (error || !data) {
      return { pending: 0, sentToday: 0, failed: 0, total: 0 };
    }

    let pending = 0;
    let sentToday = 0;
    let failed = 0;

    for (const row of data) {
      if (row.status === 'pending') pending++;
      else if (row.status === 'failed') failed++;
      else if (row.status === 'sent') {
        if (row.sent_at && new Date(row.sent_at) >= startOfDay) {
          sentToday++;
        }
      }
    }

    return {
      pending,
      sentToday,
      failed,
      total: data.length,
    };
  } catch (err) {
    console.error('Error fetching scheduled message stats:', err);
    return { pending: 0, sentToday: 0, failed: 0, total: 0 };
  }
}










