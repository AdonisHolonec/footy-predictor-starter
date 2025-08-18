import { useEffect, useState } from "react";

export type OddsResponse = any;

export function useOddsForFixture(fixtureId: number) {
  const [data, setData] = useState<OddsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/footy-predictor?path=/odds&fixture=${fixtureId}`
        );
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        const json = await res.json();
        if (alive) setData(json);
      } catch (e: any) {
        console.error("[useOddsForFixture]", e);
        if (alive) setError(e?.message ?? "Unknown error");
      } finally {
        if (alive) setLoading(false);
      }
    }
    if (fixtureId) run();
    return () => { alive = false; };
  }, [fixtureId]);

  return { data, loading, error };
}
