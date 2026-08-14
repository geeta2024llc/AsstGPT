import 'dotenv/config';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

async function applyHandoffMigration() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('SUPABASE_DB_URL is missing in process.env');
    return;
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to Supabase PostgreSQL...');

  try {
    const migrationPath = path.join(process.cwd(), 'supabase/migrations/20260814000000_human_handoff_and_takeover.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await client.query(sql);
    console.log('Migration 20260814000000_human_handoff_and_takeover applied successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

applyHandoffMigration().catch(console.error);
