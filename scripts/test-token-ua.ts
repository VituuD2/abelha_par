import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase URL or Key");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase.from('tiny_integrations').select('*');

  if (data && data.length > 0) {
    const token = data[0].access_token;
    console.log('Testing GET /info with headers...');
    
    const response = await fetch(`https://api.tiny.com.br/public-api/v3/info`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'AbelhaPar/1.0 (Integration; vitor@soulbm.com.br)'
      },
    });

    console.log('endpoint status:', response.status);
    console.log('endpoint body:', await response.text());
  }
}

run();
