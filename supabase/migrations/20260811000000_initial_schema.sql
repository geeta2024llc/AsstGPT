-- ============================================================================
-- AIWhisper Phase 2: Supabase Initial Database Schema
-- Migration File: 20260811000000_initial_schema.sql
-- 
-- Tenant Isolation Architecture:
-- Every tenant-owned table contains a `tenant_id` foreign key referencing `tenants(id)`.
-- Note: Tenant consistency across foreign-key relationships (e.g., ensuring an agent's
-- assigned conversation belongs to the same tenant) is enforced at the application layer.
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. USERS (App Users extending auth.users)
-- ============================================================================
CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================================
-- 2. TENANTS (Organizations / Workspaces)
-- ============================================================================
CREATE TABLE public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX idx_tenants_slug ON public.tenants(slug);

-- ============================================================================
-- 3. TENANT MEMBERS (Multi-tenant User Roles)
-- ============================================================================
CREATE TABLE public.tenant_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member' NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uk_tenant_members UNIQUE (tenant_id, user_id)
);
CREATE INDEX idx_tenant_members_user ON public.tenant_members(user_id);
CREATE INDEX idx_tenant_members_tenant ON public.tenant_members(tenant_id);

-- ============================================================================
-- 4. CHANNELS (Channel Abstraction: WhatsApp, Instagram, Messenger)
-- ============================================================================
CREATE TABLE public.channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('whatsapp', 'instagram', 'messenger')),
    status TEXT DEFAULT 'disconnected' NOT NULL CHECK (status IN ('connecting', 'connected', 'disconnected', 'error')),
    external_account_id TEXT,
    display_name TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX idx_channels_tenant ON public.channels(tenant_id);
CREATE INDEX idx_channels_type ON public.channels(tenant_id, type);

-- ============================================================================
-- 5. AGENTS (AI & Rule-based Bot Personalities)
-- ============================================================================
CREATE TABLE public.agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '' NOT NULL,
    mode TEXT DEFAULT 'rule' NOT NULL CHECK (mode IN ('rule', 'ai')),
    fallback_response TEXT DEFAULT 'Sorry, I did not understand that.' NOT NULL,
    status TEXT DEFAULT 'active' NOT NULL CHECK (status IN ('active', 'paused', 'errored', 'disconnected')),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX idx_agents_tenant ON public.agents(tenant_id);

-- ============================================================================
-- 6. AGENT SETTINGS (LLM & Rule Configurations - API Key in Server Env)
-- ============================================================================
CREATE TABLE public.agent_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL UNIQUE REFERENCES public.agents(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    provider TEXT DEFAULT 'gemini' NOT NULL CHECK (provider IN ('openai', 'gemini', 'anthropic')),
    system_prompt TEXT DEFAULT 'You are a helpful assistant.' NOT NULL,
    max_len INTEGER DEFAULT 500 NOT NULL,
    temperature NUMERIC(3,2) DEFAULT 0.70 NOT NULL,
    rules JSONB DEFAULT '[]'::jsonb NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX idx_agent_settings_agent ON public.agent_settings(agent_id);
CREATE INDEX idx_agent_settings_tenant ON public.agent_settings(tenant_id);

-- ============================================================================
-- 7. CONTACTS (Channel-Agnostic Core Contacts)
-- ============================================================================
CREATE TABLE public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    push_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX idx_contacts_tenant ON public.contacts(tenant_id);

-- ============================================================================
-- 8. CONTACT CHANNELS (Channel-Specific External Identifiers)
-- ============================================================================
CREATE TABLE public.contact_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL, -- e.g., WhatsApp JID ('1234567890@s.whatsapp.net')
    phone_number TEXT,
    username TEXT,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uk_contact_channels_tenant_channel_ext UNIQUE (tenant_id, channel_id, external_id)
);
CREATE INDEX idx_contact_channels_lookup ON public.contact_channels(tenant_id, channel_id, external_id);
CREATE INDEX idx_contact_channels_contact ON public.contact_channels(contact_id);

-- ============================================================================
-- 9. CONVERSATIONS (Channel-Aware Chat Threads)
-- ============================================================================
CREATE TABLE public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    assigned_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    unread_count INTEGER DEFAULT 0 NOT NULL,
    last_message_text TEXT,
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uk_conversations_tenant_channel_contact UNIQUE (tenant_id, channel_id, contact_id)
);
CREATE INDEX idx_conversations_tenant ON public.conversations(tenant_id);
CREATE INDEX idx_conversations_channel ON public.conversations(channel_id);
CREATE INDEX idx_conversations_contact ON public.conversations(contact_id);
CREATE INDEX idx_conversations_assigned_agent ON public.conversations(assigned_agent_id);

-- ============================================================================
-- 10. MESSAGES (Channel-Agnostic Message History)
-- ============================================================================
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    provider_message_id TEXT NOT NULL, -- Baileys ID or external provider message ID
    sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'contact', 'agent', 'system')),
    from_me BOOLEAN NOT NULL,
    sender_name TEXT,
    text TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL, -- WhatsApp / provider specific details
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_tenant ON public.messages(tenant_id);
CREATE INDEX idx_messages_provider_id ON public.messages(tenant_id, provider_message_id);

-- ============================================================================
-- 11. KNOWLEDGE SOURCES (Uploaded Documents / RAG Assets)
-- ============================================================================
CREATE TABLE public.knowledge_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL, -- 'pdf' | 'docx' | 'txt'
    file_size BIGINT NOT NULL,
    content TEXT NOT NULL,
    storage_path TEXT,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX idx_knowledge_sources_tenant ON public.knowledge_sources(tenant_id);

-- ============================================================================
-- 12. AGENT KNOWLEDGE SOURCES (Junction Table)
-- ============================================================================
CREATE TABLE public.agent_knowledge_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    knowledge_source_id UUID NOT NULL REFERENCES public.knowledge_sources(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uk_agent_knowledge UNIQUE (agent_id, knowledge_source_id)
);
CREATE INDEX idx_aks_agent ON public.agent_knowledge_sources(agent_id);
CREATE INDEX idx_aks_knowledge ON public.agent_knowledge_sources(knowledge_source_id);

-- ============================================================================
-- 13. AUDIT LOGS (System & Activity Audit Trail)
-- ============================================================================
CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    log_type TEXT NOT NULL CHECK (log_type IN ('info', 'warning', 'error', 'success')),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX idx_audit_logs_tenant_date ON public.audit_logs(tenant_id, created_at DESC);

-- ============================================================================
-- 14. ROW LEVEL SECURITY (RLS) & HELPER FUNCTIONS
-- ============================================================================

-- Helper function to fetch tenant IDs for a user without recursion
CREATE OR REPLACE FUNCTION public.get_user_tenant_ids(lookup_user_id UUID)
RETURNS TABLE (tenant_id UUID) AS $$
BEGIN
    RETURN QUERY
    SELECT tm.tenant_id
    FROM public.tenant_members tm
    WHERE tm.user_id = lookup_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. Users RLS Policy
CREATE POLICY "Users can view own profile"
ON public.users FOR SELECT TO authenticated
USING (id = auth.uid());

-- 2. Tenants RLS Policy
CREATE POLICY "Users can view their tenants"
ON public.tenants FOR SELECT TO authenticated
USING (id IN (SELECT public.get_user_tenant_ids(auth.uid())));

-- 3. Tenant Members RLS Policy
CREATE POLICY "Users can view members of their tenants"
ON public.tenant_members FOR SELECT TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));

-- 4-13. Generic Tenant-Isolation Policies for Tenant-Owned Tables
CREATE POLICY "Tenant isolation for channels" ON public.channels FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())))
WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));

CREATE POLICY "Tenant isolation for agents" ON public.agents FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())))
WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));

CREATE POLICY "Tenant isolation for agent_settings" ON public.agent_settings FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())))
WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));

CREATE POLICY "Tenant isolation for contacts" ON public.contacts FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())))
WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));

CREATE POLICY "Tenant isolation for contact_channels" ON public.contact_channels FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())))
WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));

CREATE POLICY "Tenant isolation for conversations" ON public.conversations FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())))
WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));

CREATE POLICY "Tenant isolation for messages" ON public.messages FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())))
WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));

CREATE POLICY "Tenant isolation for knowledge_sources" ON public.knowledge_sources FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())))
WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));

CREATE POLICY "Tenant isolation for agent_knowledge_sources" ON public.agent_knowledge_sources FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())))
WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));

CREATE POLICY "Tenant isolation for audit_logs" ON public.audit_logs FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())))
WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));
