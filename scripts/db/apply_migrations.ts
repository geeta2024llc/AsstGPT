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

  // Ensure migration tracking table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS public._schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const { rows: appliedRows } = await client.query('SELECT version FROM public._schema_migrations');
  const appliedSet = new Set(appliedRows.map((r: any) => r.version));

  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const isForce = process.argv.includes('--force');

  console.log(`Found ${migrationFiles.length} migration file(s) (${appliedSet.size} previously applied).`);

  for (const fileName of migrationFiles) {
    if (appliedSet.has(fileName) && !isForce) {
      console.log(`Skipping already applied migration: ${fileName}`);
      continue;
    }

    const fullPath = path.join(migrationsDir, fileName);
    console.log(`Executing migration: ${fileName}...`);
    const sql = fs.readFileSync(fullPath, 'utf8');

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO public._schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [fileName]);
      await client.query('COMMIT');
      console.log(`Migration ${fileName} executed successfully!`);
    } catch (err: any) {
      await client.query('ROLLBACK');
      // If error is table already exists or column already exists, record as applied
      if (err.code === '42P07' || err.code === '42701' || err.message?.includes('already exists')) {
        console.warn(`Migration ${fileName} objects already exist in DB; marking as applied.`);
        await client.query('INSERT INTO public._schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [fileName]);
      } else {
        throw err;
      }
    }
  }

  await client.end();
  console.log('All migrations applied successfully!');
}

runMigrations().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
