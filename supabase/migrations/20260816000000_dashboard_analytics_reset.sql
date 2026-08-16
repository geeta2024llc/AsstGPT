-- ============================================================================
-- Dashboard Analytics Reset Checkpoint
--
-- Lets an admin "reset" the AI Command Center dashboard back to zero without
-- deleting real conversation/message/audit_log history (Inbox, Client
-- Details, and Activity all still need that history intact). Analytics
-- queries bound their `created_at >=` filters to whichever is later: the
-- selected date range, or this checkpoint.
-- ============================================================================

ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS analytics_reset_at TIMESTAMPTZ;
