export type ApiUsageMinute = {
  minute: string; source: "orders" | "costs" | "operational" | "identity";
  requests: number; responses: number; retries: number; throttled: number; server_errors: number;
  timeouts: number; network_errors: number; duration_ms: number; max_duration_ms: number;
};
export type ApiUsageAccount = {
  connection_id: string; name: string; plan: string; plan_limit: number; app_limit: number;
  effective_limit: number; monitoring_since: string | null;
  cooldown_until: string | null; slow_until: string | null;
  provider_limit: number | null; provider_remaining: number | null;
  provider_reset_at: string | null; observed_at: string | null; minutes: ApiUsageMinute[];
  samples?: {minute:string;provider_limit:number;provider_remaining:number;provider_reset_at:string;observed_at:string;sample_count:number}[];
};
export type ApiUsage = {
  available: boolean; error?: string; generated_at?: string; accounts?: ApiUsageAccount[];
};

export function summarizeApiUsage(account: ApiUsageAccount, generatedAt: string) {
  const currentMinute = Math.floor(Date.parse(generatedAt) / 60000) * 60000;
  const complete = account.minutes.filter(m => Date.parse(m.minute) < currentMinute);
  const last = complete.filter(m => Date.parse(m.minute) === currentMinute - 60000);
  const sum = (rows: ApiUsageMinute[], key: "requests" | "responses" | "throttled" | "retries" | "duration_ms") => rows.reduce((n,m) => n + Number(m[key]), 0);
  const totals = new Map<number, number>();
  for (const m of complete) { const time = Date.parse(m.minute); totals.set(time, (totals.get(time) || 0) + m.requests); }
  return { lastMinute: sum(last, "requests"), peak: Math.max(0, ...totals.values()),
    lastMinuteMeasured: !!account.monitoring_since && Date.parse(account.monitoring_since)<currentMinute,
    failures: complete.reduce((n,m) => n + m.server_errors + m.timeouts + m.network_errors,0),
    throttled: sum(complete, "throttled"), retries: sum(complete, "retries"),
    averageMs: sum(complete, "responses") ? Math.round(sum(complete, "duration_ms") / sum(complete, "responses")) : null,
    pendingResults: account.minutes.reduce((n,m) => n + Math.max(0,m.requests-m.responses),0),
    sources: Object.fromEntries(["orders","costs","operational","identity"].map(source => [source,
      sum(complete.filter(m => m.source === source), "requests")])),
    bars: Array.from({length:15}, (_,i) => { const time = currentMinute - (15-i)*60000; return {time, requests: totals.get(time) || 0,
      covered: !!account.monitoring_since && time >= Math.floor(Date.parse(account.monitoring_since)/60000)*60000}; }),
  };
}
