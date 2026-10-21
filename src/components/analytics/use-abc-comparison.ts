"use client";

import { useEffect, useMemo, useState } from "react";
import type { KPIComparison } from "@/lib/analytics/comparison";
import type { ABCFilters } from "@/lib/analytics/types";

export function useABCComparison(filters: ABCFilters, refresh: number, dataRefresh: number) {
  const key = useMemo(() => JSON.stringify({ filters, refresh, dataRefresh }), [filters, refresh, dataRefresh]);
  const [state, setState] = useState<{ key: string; data?: KPIComparison; error?: string } | null>(null);
  useEffect(() => {
    const { filters: requestFilters } = JSON.parse(key) as { filters: ABCFilters };
    const abort = new AbortController();
    setState(null);
    fetch("/api/analytics/comparison", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters: requestFilters }), signal: abort.signal, cache: "no-store",
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Comparação indisponível.");
      if (!data.previous || !data.period) throw new Error("Comparação indisponível.");
      if (!abort.signal.aborted) setState({ key, data });
    }).catch(reason => {
      if (!abort.signal.aborted) setState({ key, error: reason instanceof Error ? reason.message : "Comparação indisponível." });
    });
    return () => abort.abort();
    // key includes applied filters and explicit/progress refreshes, never table pagination or sort.
  }, [key]);
  const current = state?.key === key ? state : null;
  return {
    data: current?.data,
    loading: !current,
    message: current?.error ? `Comparação indisponível: ${current.error}` : null,
  };
}
