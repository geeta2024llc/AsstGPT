-- ============================================================================
-- AIWhisper Phase 3: Contact CRM & Customer Profile Metadata Schema
-- Migration File: 20260814030000_contact_crm.sql
-- ============================================================================

-- 1. Extend contacts table with CRM fields
ALTER TABLE public.contacts
    ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'lead' NOT NULL,
    ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::text[] NOT NULL,
    ADD COLUMN IF NOT EXISTS custom_attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '' NOT NULL,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS company TEXT;

-- 2. Add check constraint for stage if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_contacts_stage'
    ) THEN
        ALTER TABLE public.contacts
            ADD CONSTRAINT chk_contacts_stage CHECK (stage IN ('lead', 'prospect', 'customer', 'vip', 'churned'));
    END IF;
END $$;

-- 3. Create Indexes for stage and tags
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_stage ON public.contacts(tenant_id, stage);
CREATE INDEX IF NOT EXISTS idx_contacts_tags ON public.contacts USING GIN (tags);
