import { useEffect, useState } from "react";
import { getPredictions } from "./lib/api";
import { formatRO } from "./lib/date";

type Item = {
  id: string;
  home: string;
  away: string;
  kickoff: string;
  predictions: {
    oneXtwo: { pick: string; conf: number };
    gg: { pick: string; conf: number };
    over25: { pick: string; conf: number };
    correctScore: { pick: string; conf: number };
  };
};

export default function App() {
  const [data, setData] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const res = await getPredictions();
      setData(res);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-[#F9FAFB] p-6" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Footy Predictor — Demo</h1>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-50"
          aria-busy={loading}
        >
          {loading ? "Se actualizează…" : "Actualizează"}
        </button>
      </div>

      {error && <div className="p-3 rounded bg-red-50 text-red-700 mb-4">Eroare: {error}</div>}
      {!data && !error && <div className="text-gray-600">Se încarcă…</div>}

      {data && (
        <div className="grid gap-4 md:grid-cols-3">
          {data.map((m) => (
            <div key={m.id} className="bg-white rounded-2xl shadow p-4 transition-transform hover:scale-[1.01]">
              <div className="text-sm text-gray-500">{formatRO(m.kickoff)}</div>
              <div className="text-lg font-medium mt-1">{m.home} vs {m.away}</div>
              <div className="mt-3 space-y-2">
                <Badge label={`${m.predictions.oneXtwo.pick} (${m.predictions.oneXtwo.conf}%)`} tone="green" />
                <Badge label={`${m.predictions.gg.pick} (${m.predictions.gg.conf}%)`} tone="blue" />
                <Badge label={`${m.predictions.over25.pick} (${m.predictions.over25.conf}%)`} tone="gray" />
                <Badge label={`${m.predictions.correctScore.pick} (${m.predictions.correctScore.conf}%)`} tone="red" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: "green"|"blue"|"gray"|"red" }) {
  const map = {
    green: "bg-green-100 text-green-700",
    blue:  "bg-blue-100 text-blue-700",
    gray:  "bg-gray-100 text-gray-700",
    red:   "bg-red-100 text-red-700"
  } as const;
  return <span className={`inline-block text-sm px-2 py-1 rounded ${map[tone]}`}>{label}</span>;
}
