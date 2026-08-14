import 'dotenv/config';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const dbUrl = process.env.SUPABASE_DB_URL;

if (!dbUrl) {
  console.error('SUPABASE_DB_URL is missing in environment');
  process.exit(1);
}

console.log('Connecting to Supabase PostgreSQL database...');

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

async function runMigrations() {
  await client.connect();
  console.log('Connected to PostgreSQL successfully!');

  const migrationFiles = [
    'supabase/migrations/20260811000000_initial_schema.sql',
    'supabase/migrations/20260811000001_message_idempotency.sql',
  ];

  for (const relPath of migrationFiles) {
    const fullPath = path.join(process.cwd(), relPath);
    console.log(`Executing migration: ${relPath}...`);
    const sql = fs.readFileSync(fullPath, 'utf8');
    await client.query(sql);
    console.log(`Migration ${relPath} executed successfully!`);
  }

  await client.end();
  console.log('All migrations applied successfully!');
}

runMigrations().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
