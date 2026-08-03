import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const supabase = createClient(supabaseUrl!, supabaseKey!);
  const { data } = await supabase.from('tiny_integrations').select('*');
  const token = data![0].access_token;
    
  console.log('Testing api.erp.olist.com...');
  try {
    const res = await fetch(`https://api.erp.olist.com/public-api/v3/info`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    console.log('status:', res.status, await res.text());
  } catch (e) {
    console.log('Failed:', e);
  }
}

run();
