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
    console.log('Testing GET /pedidos with token...');
    
    const params = new URLSearchParams({
      dataInicial: '2023-01-01',
      limit: '1',
      offset: '0',
    });

    const response = await fetch(`https://api.tiny.com.br/public-api/v3/pedidos?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    console.log('Pedidos endpoint status:', response.status);
    console.log('Pedidos endpoint body:', await response.text());
  }
}

run();
