-- ============================================================================
-- AIWhisper Phase A: AI Summaries, Sentiment Tracking & SLA Analytics Schema
-- Migration File: 20260814050000_analytics_and_sentiment.sql
-- ============================================================================

-- 1. Add AI Summary, Sentiment, and SLA metrics to conversations table
ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS ai_summary TEXT,
    ADD COLUMN IF NOT EXISTS sentiment TEXT DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'negative', 'frustrated')),
    ADD COLUMN IF NOT EXISTS first_response_time_ms INTEGER,
    ADD COLUMN IF NOT EXISTS resolution_duration_ms INTEGER;

-- 2. Create index on sentiment and resolution_duration for fast dashboard analytics
CREATE INDEX IF NOT EXISTS idx_conversations_sentiment ON public.conversations(tenant_id, sentiment);
CREATE INDEX IF NOT EXISTS idx_conversations_status_resolution ON public.conversations(tenant_id, status, resolution_duration_ms);
