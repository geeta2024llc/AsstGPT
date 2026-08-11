-- ============================================================================
-- Migration: 20260811000002_knowledge_sources_status.sql
-- Add status and enabled flag to knowledge_sources table for production RAG
-- ============================================================================

ALTER TABLE public.knowledge_sources ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT true NOT NULL;
ALTER TABLE public.knowledge_sources ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ready' NOT NULL;
