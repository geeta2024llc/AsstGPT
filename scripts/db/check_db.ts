import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

console.log('Testing Supabase JS connection to:', url);

const supabase = createClient(url, key);

async function main() {
  const { data: tenants, error: tErr } = await supabase.from('tenants').select('*');
  if (tErr) {
    console.error('Tenants query error:', tErr);
    return;
  }
  console.log('Tenants table:', tenants);

  const { data: channels, error: cErr } = await supabase.from('channels').select('*');
  if (cErr) {
    console.error('Channels query error:', cErr);
    return;
  }
  console.log('Channels table:', channels);
}

main().catch(console.error);
