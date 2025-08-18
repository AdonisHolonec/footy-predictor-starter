import { useEffect, useMemo, useState } from "react";

type Params = {
  date: string;          // yyyy-mm-dd
  league: number;        // ex. 283 (Liga 1)
  season: number;        // ex. 2025
  limit: number;         // câte carduri afişăm în UI
  pauseMs?: number;      // delay mic între fetchuri (opţional)
};

export function useCardsByDate({ date, league, season, limit, pauseMs = 0 }: Params) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        // -> construim corect query-ul, fără "limit" către upstream
        const qs = new URLSearchParams();
        qs.set("path", "/fixtures");
        qs.set("date", date);
        qs.set("league", String(league));
        qs.set("season", String(season));

        const res = await fetch(`/api/footy-predictor?${qs.toString()}`);
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status} • ${txt}`);
        }
        const data = await res.json();

        const rows: any[] = Array.isArray(data?.response) ? data.response : [];
        if (!cancelled) setItems(rows.slice(0, Math.max(0, limit)));
      } catch (err: any) {
        if (!cancelled) setError(err?.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (pauseMs > 0) {
      const t = setTimeout(run, pauseMs);
      return () => { cancelled = true; clearTimeout(t); };
    } else {
      run();
      return () => { cancelled = true; };
    }
  }, [date, league, season, limit, pauseMs]);

  const result = useMemo(() => items, [items]);
  return { items: result, loading, error } as const;
}
