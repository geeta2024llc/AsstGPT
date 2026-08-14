import 'dotenv/config';
import { Client } from 'pg';

async function applyMigration() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('SUPABASE_DB_URL is missing in process.env');
    return;
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  console.log('Connected to Supabase PostgreSQL...');

  try {
    await client.query(`
      ALTER TABLE public.knowledge_sources ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT true NOT NULL;
      ALTER TABLE public.knowledge_sources ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ready' NOT NULL;
    `);
    console.log('Migration 20260811000002_knowledge_sources_status applied successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

applyMigration().catch(console.error);
