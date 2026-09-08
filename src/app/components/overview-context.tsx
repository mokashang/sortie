"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Overview } from "@/app/lib/overview-types";
import { getJson, errorMessage } from "@/app/lib/api";

interface OverviewApi {
  data: Overview | null;
  error: string | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<OverviewApi | null>(null);

// Polls GET /api/overview every 5s (only while the tab is visible) and hands the result to the
// sidebar badges, the assistant pill, the 今日 page and anything else that wants live counts.
export function OverviewProvider({ children, initial = null }: { children: React.ReactNode; initial?: Overview | null }) {
  const [data, setData] = useState<Overview | null>(initial);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await getJson<Overview>("/api/overview"));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const value = useMemo(() => ({ data, error, refresh }), [data, error, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const NOOP: OverviewApi = { data: null, error: null, refresh: async () => {} };

export function useOverview(): OverviewApi {
  return useContext(Ctx) ?? NOOP;
}
