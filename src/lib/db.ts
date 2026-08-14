if (typeof window !== 'undefined') {
  throw new Error('CRITICAL SECURITY ERROR: src/lib/db.ts is a server-only module and cannot be imported in client components.');
}

import { getSupabaseAdmin } from './supabase';
import type { Conversation, Message, Agent, Stats, KnowledgeFile, LogEntry, TeamMember, HandoffRule, CannedResponse, ConversationNote, ContactProfile, LeadStage, WebhookConfig, WebhookEventType, WebhookPayload, SLAMetrics, SentimentType, WidgetConfig } from '@/types';

function getDefaultTenantId(): string {
  const tenantId = process.env.DEFAULT_TENANT_ID;
  if (!tenantId) {
    throw new Error('CRITICAL CONFIGURATION ERROR: DEFAULT_TENANT_ID environment variable is missing.');
  }
  return tenantId;
}

/**
 * Ensures that a default workspace tenant and WhatsApp channel exist in Supabase.
 * Returns the tenantId and channelId for tenant isolation.
 */
async function ensureDefaultTenantAndChannel(): Promise<{ tenantId: string; channelId: string }> {
  const supabase = getSupabaseAdmin();
  const tenantId = getDefaultTenantId();

  // 1. Ensure default tenant exists
  const { data: existingTenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();

  if (!existingTenant) {
    const { error: insertTenantError } = await supabase.from('tenants').insert({
      id: tenantId,
      name: 'Default Workspace',
      slug: 'default-workspace',
    });
    if (insertTenantError) {
      console.error('Failed to create default tenant in Supabase:', insertTenantError);
    }
  }

  // 2. Ensure default WhatsApp channel exists (order by created_at asc and limit 1 for single deterministic channel)
  const { data: existingChannel } = await supabase
    .from('channels')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('type', 'whatsapp')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingChannel) {
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
    console.error('Failed to create default WhatsApp channel:', channelError);
    throw new Error('Default channel initialization failed');
  }

  return { tenantId, channelId: newChannel.id };
}

// --- Conversations ---

export async function getConversations(): Promise<Conversation[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: convosData, error } = await supabase
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
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Failed to fetch conversations from Supabase:', error);
      return [];
    }

    if (!convosData) return [];

    const conversationsMap = new Map<string, Conversation>();

    for (const c of convosData) {
      const contact = c.contacts as any;
      const externalId = contact?.contact_channels?.[0]?.external_id || contact?.name || c.id;
      const lastMsgTime = c.last_message_at ? new Date(c.last_message_at).getTime() : Date.now();

      const convoObj: Conversation = {
        id: externalId,
        name: contact?.name || externalId.split('@')[0],
        unreadCount: c.unread_count || 0,
        lastMessage: {
          text: c.last_message_text || '',
          timestamp: lastMsgTime,
        },
        avatar: contact?.avatar_url || `https://placehold.co/100x100.png?text=${(contact?.name || externalId.charAt(0)).toUpperCase()}`,
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
      };

      const existing = conversationsMap.get(externalId);
      if (!existing || convoObj.lastMessage.timestamp > existing.lastMessage.timestamp) {
        conversationsMap.set(externalId, convoObj);
      }
    }

    const conversations = Array.from(conversationsMap.values());
    return conversations.sort((a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp);
  } catch (err) {
    console.error('Error in getConversations:', err);
    return [];
  }
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
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
      const contactName = update.name || id.split('@')[0];
      const avatarUrl = update.avatar || `https://placehold.co/100x100.png?text=${contactName.charAt(0).toUpperCase()}`;

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

      // Create contact_channel
      const { error: ccErr } = await supabase.from('contact_channels').insert({
        tenant_id: tenantId,
        contact_id: contactId,
        channel_id: channelId,
        external_id: id,
        phone_number: id.split('@')[0],
      });
      if (ccErr) console.error('Failed to create contact channel in Supabase:', ccErr);
    } else if (update.name || update.avatar) {
      // Update contact info if provided
      const contactUpdate: any = {};
      if (update.name) contactUpdate.name = update.name;
      if (update.avatar) contactUpdate.avatar_url = update.avatar;

      await supabase.from('contacts').update(contactUpdate).eq('id', contactId);
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

export async function getMessages(chatId?: string): Promise<Message[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId, channelId } = await ensureDefaultTenantAndChannel();

    let conversationIdFilter: string | undefined;

    if (chatId) {
      // Resolve conversation by chatId (JID)
      const { data: cc } = await supabase
        .from('contact_channels')
        .select('contact_id')
        .eq('tenant_id', tenantId)
        .eq('channel_id', channelId)
        .eq('external_id', chatId)
        .maybeSingle();

      if (cc) {
        const { data: convo } = await supabase
          .from('conversations')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('channel_id', channelId)
          .eq('contact_id', cc.contact_id)
          .maybeSingle();

        if (convo) {
          conversationIdFilter = convo.id;
        } else {
          return [];
        }
      } else {
        return [];
      }
    }

    let query = supabase
      .from('messages')
      .select(`
        id,
        provider_message_id,
        from_me,
        sender_name,
        text,
        created_at,
        conversations (
          contacts (
            contact_channels (
              external_id
            )
          )
        )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (conversationIdFilter) {
      query = query.eq('conversation_id', conversationIdFilter);
    }

    const { data: msgs, error } = await query;
    if (error) {
      console.error('Failed to fetch messages from Supabase:', error);
      return [];
    }

    if (!msgs) return [];

    return msgs.map((m: any) => {
      const externalId =
        m.conversations?.contacts?.contact_channels?.[0]?.external_id || chatId || 'unknown';
      const timestamp = new Date(m.created_at).getTime();

      return {
        id: m.provider_message_id || m.id,
        chatId: externalId,
        fromMe: m.from_me,
        text: m.text,
        timestamp,
        senderName: m.sender_name || (m.from_me ? 'Me' : externalId.split('@')[0]),
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

    // 1. Update conversation metadata: increment unread for inbound (!fromMe), reset to 0 for outbound (fromMe)
    if (!message.fromMe) {
      await updateConversation(message.chatId, {
        name: message.senderName,
        lastMessage: { text: message.text, timestamp: message.timestamp },
        incrementUnread: true,
      });
    } else {
      await updateConversation(message.chatId, {
        name: message.senderName,
        lastMessage: { text: message.text, timestamp: message.timestamp },
        unreadCount: 0,
      });
    }

    // 2. Fetch conversation ID
    const { data: cc } = await supabase
      .from('contact_channels')
      .select('contact_id')
      .eq('tenant_id', tenantId)
      .eq('channel_id', channelId)
      .eq('external_id', message.chatId)
      .maybeSingle();

    if (!cc?.contact_id) {
      console.error('[DIAGNOSTIC] Failed to find contact channel for message:', message.chatId);
      return { success: false, duplicate: false };
    }

    const { data: convo } = await supabase
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('channel_id', channelId)
      .eq('contact_id', cc.contact_id)
      .maybeSingle();

    if (!convo?.id) {
      console.error('[DIAGNOSTIC] Failed to find conversation for message:', message.chatId);
      return { success: false, duplicate: false };
    }

    const createdAt = new Date(message.timestamp).toISOString();
    const senderType = message.fromMe ? 'user' : 'contact';

    const { error } = await supabase.from('messages').insert({
      tenant_id: tenantId,
      conversation_id: convo.id,
      provider_message_id: message.id,
      sender_type: senderType,
      from_me: message.fromMe,
      sender_name: message.senderName || (message.fromMe ? 'Me' : message.chatId.split('@')[0]),
      text: message.text,
      metadata: { chatId: message.chatId, provider: 'baileys' },
      created_at: createdAt,
    });

    if (error) {
      if (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('uk_messages_tenant_provider_id')) {
        console.warn(`[DIAGNOSTIC] Atomic idempotency: Duplicate provider_message_id rejected by DB: ${message.id}`);
        return { success: false, duplicate: true };
      }
      console.error('[DIAGNOSTIC] Failed to insert message into Supabase:', error);
      return { success: false, duplicate: false };
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

export async function updateAgent(id: string, update: Partial<Omit<Agent, 'id'>>) {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

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
  } catch (err) {
    console.error('Error in updateAgent:', err);
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

const DEFAULT_INITIAL_MEMBERS: Omit<TeamMember, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    fullName: 'Sarah Jenkins',
    email: 'sarah.jenkins@company.com',
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80',
    role: 'admin',
    status: 'online',
    assignedQueues: ['billing', 'vip', 'general'],
  },
  {
    fullName: 'David Miller',
    email: 'david.miller@company.com',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80',
    role: 'agent',
    status: 'online',
    assignedQueues: ['technical', 'general'],
  },
  {
    fullName: 'Elena Rostova',
    email: 'elena.rostova@company.com',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
    role: 'viewer',
    status: 'away',
    assignedQueues: ['reporting'],
  },
];

export async function getTeamMembers(): Promise<TeamMember[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to fetch team_members from Supabase:', error);
      return [];
    }

    if (!data || data.length === 0) {
      const seededMembers: TeamMember[] = [];
      for (const def of DEFAULT_INITIAL_MEMBERS) {
        const created = await createTeamMember(def);
        seededMembers.push(created);
      }
      return seededMembers;
    }

    return data.map((m: any) => ({
      id: m.id,
      fullName: m.full_name,
      email: m.email || undefined,
      avatarUrl: m.avatar_url || undefined,
      role: m.role || 'agent',
      status: m.status || 'online',
      assignedQueues: m.assigned_queues || [],
      createdAt: new Date(m.created_at).getTime(),
      updatedAt: m.updated_at ? new Date(m.updated_at).getTime() : undefined,
    }));
  } catch (err) {
    console.error('Error in getTeamMembers:', err);
    return [];
  }
}

export async function getTeamMember(id: string): Promise<TeamMember | undefined> {
  const members = await getTeamMembers();
  return members.find(m => m.id === id);
}

export async function createTeamMember(
  data: Omit<TeamMember, 'id' | 'createdAt' | 'updatedAt'>
): Promise<TeamMember> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const { data: newRow, error } = await supabase
    .from('team_members')
    .insert({
      tenant_id: tenantId,
      full_name: data.fullName.trim(),
      email: data.email ? data.email.trim() : null,
      avatar_url: data.avatarUrl || null,
      role: data.role || 'agent',
      status: data.status || 'online',
      assigned_queues: data.assignedQueues || [],
    })
    .select('*')
    .single();

  if (error || !newRow) {
    console.error('Failed to insert team member in Supabase:', error);
    throw new Error('Failed to create team member');
  }

  return {
    id: newRow.id,
    fullName: newRow.full_name,
    email: newRow.email || undefined,
    avatarUrl: newRow.avatar_url || undefined,
    role: newRow.role,
    status: newRow.status,
    assignedQueues: newRow.assigned_queues || [],
    createdAt: new Date(newRow.created_at).getTime(),
    updatedAt: newRow.updated_at ? new Date(newRow.updated_at).getTime() : undefined,
  };
}

export async function updateTeamMember(
  id: string,
  update: Partial<TeamMember>
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const payload: any = { updated_at: new Date().toISOString() };
    if (update.fullName !== undefined) payload.full_name = update.fullName.trim();
    if (update.email !== undefined) payload.email = update.email ? update.email.trim() : null;
    if (update.avatarUrl !== undefined) payload.avatar_url = update.avatarUrl;
    if (update.role !== undefined) payload.role = update.role;
    if (update.status !== undefined) payload.status = update.status;
    if (update.assignedQueues !== undefined) payload.assigned_queues = update.assignedQueues;

    const { error } = await supabase
      .from('team_members')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error(`Failed to update team member ${id}:`, error);
      throw error;
    }
  } catch (err) {
    console.error(`Error in updateTeamMember(${id}):`, err);
    throw err;
  }
}

export async function deleteTeamMember(id: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error(`Failed to delete team member ${id}:`, error);
      throw error;
    }
  } catch (err) {
    console.error(`Error in deleteTeamMember(${id}):`, err);
    throw err;
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
      assignToUserId: 'user_agent_sarah',
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
      assignToUserId: 'user_admin_01',
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
      assignToUserId: 'user_agent_david',
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
      maxFallbacks: 2,
    },
    actions: {
      assignToUserId: 'user_admin_01',
      autoPauseAi: true,
      transitionMessage: "Let me bring in a specialist to help resolve this for you.",
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
    const { count: msgCount } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('chat_id', chatId);

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

// --- SLA & Agent Performance Metrics ---

export async function getSLAMetrics(): Promise<SLAMetrics> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

    const { data: convos, error } = await supabase
      .from('conversations')
      .select('assigned_user_id, status, sentiment, first_response_time_ms, resolution_duration_ms')
      .eq('tenant_id', tenantId);

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

export async function getWidgetConfig(): Promise<WidgetConfig> {
  try {
    const supabase = getSupabaseAdmin();
    const { tenantId } = await ensureDefaultTenantAndChannel();

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

export async function updateWidgetConfig(config: Partial<WidgetConfig>): Promise<WidgetConfig> {
  const supabase = getSupabaseAdmin();
  const { tenantId } = await ensureDefaultTenantAndChannel();

  const current = await getWidgetConfig();
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









