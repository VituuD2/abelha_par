import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl!, anonKey!);
  
  const { data: selectData } = await supabase.from('tiny_integrations').select('*');
  console.log('Select with anon key:', selectData);

  if (selectData && selectData.length > 0) {
    const { error: updateError, data: updateData } = await supabase
      .from('tiny_integrations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', selectData[0].id)
      .select(); // force returning the updated row to see if it actually updated
    
    console.log('Update with anon key:', updateData, updateError);
  }
}

run();
