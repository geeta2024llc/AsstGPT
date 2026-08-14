-- ============================================================================
-- AIWhisper Phase B: Embeddable Live Web Chat Widget Schema
-- Migration File: 20260814060000_webchat_widget.sql
-- ============================================================================

-- 1. Add widget_settings JSONB column to tenants table
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS widget_settings JSONB DEFAULT '{
        "title": "Chat with Support",
        "primaryColor": "#6366F1",
        "greeting": "Hi there! 👋 How can we help you today?",
        "botAvatar": "🤖",
        "botName": "AI Assistant",
        "placeholder": "Type your message..."
    }'::jsonb;
