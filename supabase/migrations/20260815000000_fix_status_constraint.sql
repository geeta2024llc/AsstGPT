-- Migration: 20260815000000_fix_status_constraint.sql
-- Drop any conflicting older inline or named status constraints and establish clean constraint supporting open, resolved, and pending

DO $$
BEGIN
    -- Drop legacy named constraint if exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_conversations_status' 
        AND conrelid = 'public.conversations'::regclass
    ) THEN
        ALTER TABLE public.conversations DROP CONSTRAINT chk_conversations_status;
    END IF;

    -- Drop any auto-named check constraints on the status column
    EXECUTE (
        SELECT COALESCE(string_agg('ALTER TABLE public.conversations DROP CONSTRAINT ' || quote_ident(conname) || ';', ' '), '')
        FROM pg_constraint
        WHERE conrelid = 'public.conversations'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%status%IN%'
    );
END $$;

-- Add unified check constraint
ALTER TABLE public.conversations
ADD CONSTRAINT chk_conversations_status CHECK (status IN ('open', 'resolved', 'pending'));
