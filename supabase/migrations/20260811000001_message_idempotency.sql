-- Migration: 20260811000001_message_idempotency.sql
-- Enforce database-level uniqueness on (tenant_id, provider_message_id) for message idempotency

ALTER TABLE public.messages
ADD CONSTRAINT uk_messages_tenant_provider_id UNIQUE (tenant_id, provider_message_id);
