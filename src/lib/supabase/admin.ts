import "server-only";

import { createClient } from "@supabase/supabase-js";

export function createAdminClient(requestTimeoutMs?: number) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Configuração administrativa do Supabase ausente.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(requestTimeoutMs ? { global: { fetch: (url: RequestInfo | URL, options?: RequestInit) => fetch(url, {
      ...options, signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(requestTimeoutMs)])
        : AbortSignal.timeout(requestTimeoutMs),
    }) } } : {}),
  });
}
