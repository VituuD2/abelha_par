import "server-only";

import { createClient } from "@/lib/supabase/server";
import { cache } from "react";
import { readSupabaseUser } from "@/lib/supabase/auth-user";

// Share authentication within one server render; never cache across requests/users.
export const getAuthenticatedUser = cache(async () => {
  const supabase = await createClient();
  return readSupabaseUser(supabase);
});
