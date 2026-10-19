import "server-only";

import { createClient } from "@/lib/supabase/server";
import { cache } from "react";

// Share authentication within one server render; never cache across requests/users.
export const getAuthenticatedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
});
