-- ============================================================================
-- AIWhisper Phase I: Missing index for the inbox's actual sort key
--
-- getConversations() sorts by last_message_at, but every existing composite
-- index on conversations covers updated_at instead. As per-tenant
-- conversation volume grows, every inbox load forces a non-index-assisted
-- sort.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_last_message
    ON public.conversations (tenant_id, last_message_at DESC);

-- Supports the new bounded lookback window in getSLAMetrics() and the
-- beforeLastMessageAt filter used by getStaleConversationsForReEngagement().
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_created
    ON public.conversations (tenant_id, created_at DESC);
