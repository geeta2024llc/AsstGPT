-- ============================================================================
-- AIWhisper Phase 5: Analytics Indexes & Conversation Status Migration
-- Migration File: 20260811000003_analytics_indexes.sql
-- ============================================================================

-- Add status column to conversations for explicit open vs resolved tracking
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open' NOT NULL CHECK (status IN ('open', 'resolved'));

-- Indexes for high-performance tenant-isolated analytics queries
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_status ON public.conversations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_updated ON public.conversations(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_created ON public.messages(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action ON public.audit_logs(tenant_id, action, created_at DESC);
