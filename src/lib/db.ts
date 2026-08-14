if (typeof window !== 'undefined') {
  throw new Error('CRITICAL SECURITY ERROR: src/lib/db.ts is a server-only module and cannot be imported in client components.');
}

import { getSupabaseAdmin } from './supabase';
import type { Conversation, Message, Agent, Stats, KnowledgeFile, LogEntry } from '@/types';

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
        contacts (
          id,
          name,
          avatar_url,
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
      .select('id, unread_count')
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
