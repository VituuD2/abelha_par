import type { SupabaseClient, User } from "@supabase/supabase-js";
import { AUTH_TIMEOUT_MS } from "./request";

export class AuthenticationUnavailableError extends Error {
  readonly status = 503;
  constructor() { super("A verificação da sessão está temporariamente indisponível. Tente novamente."); }
}

/** Bound the whole operation, including the SDK's refresh-token retries. */
export async function readSupabaseUser(client: SupabaseClient, timeoutMs = AUTH_TIMEOUT_MS): Promise<User | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      client.auth.getUser(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AuthenticationUnavailableError()), timeoutMs);
      }),
    ]);
    if (result.error && (!result.error.status || result.error.status === 429 || result.error.status >= 500))
      throw new AuthenticationUnavailableError();
    return result.data.user;
  } finally {
    clearTimeout(timer);
  }
}
