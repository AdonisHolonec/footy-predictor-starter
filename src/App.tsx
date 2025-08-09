import { useState } from "react";
import { getPrediction, type Prediction } from "./services/predictions";

// Arătăm debug doar în dev sau dacă setăm VITE_SHOW_DEBUG=1
const SHOW_DEBUG =
  import.meta.env.MODE !== "production" ||
  import.meta.env.VITE_SHOW_DEBUG === "1";

export default function App() {
  const [fixtureId, setFixtureId] = useState("215662");
  const [data, setData] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFetch(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    setData(null);
    try {
      const res = await getPrediction(Number(fixtureId));
      setData(res);
    } catch (err: any) {
      setError(err?.message || "Eroare necunoscută");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-bold">Footy Predictor Starter</h1>

        <form onSubmit={handleFetch} className="flex gap-3 items-center">
          <input
            value={fixtureId}
            onChange={(e) => setFixtureId(e.target.value)}
            className="px-3 py-2 border rounded w-52 bg-white"
            placeholder="ID meci (fixtureId)"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            disabled={loading || !fixtureId}
          >
            {loading ? "Se încarcă..." : "Vezi predicțiile"}
          </button>
        </form>

        {error && (
          <div className="p-3 rounded border border-red-300 bg-red-50 text-red-700">
            {error}
          </div>
        )}

        {data && (
          <div className="p-5 rounded-2xl bg-white shadow">
            <p className="text-sm text-gray-500 mb-4">Fixture #{data.fixtureId}</p>

            <div className="grid grid-cols-3 gap-6 items-center text-lg">
              <div className="text-right">
                <div className="font-semibold">{data.teams.home ?? "—"}</div>
                <div className="text-sm text-gray-500">1: {data.oneXTwo.home ?? "—"}</div>
              </div>

              <div className="text-center text-gray-400">vs</div>

              <div>
                <div className="font-semibold">{data.teams.away ?? "—"}</div>
                <div className="text-sm text-gray-500">2: {data.oneXTwo.away ?? "—"}</div>
              </div>
            </div>

            <div className="mt-4 space-y-1 text-sm">
              <div>X: {data.oneXTwo.draw ?? "—"}</div>
              <div>
                Recomandat:{" "}
                <span className="font-semibold">
                  {data.oneXTwo.recommended ?? "—"}
                </span>
              </div>
              <div>
                GG/NG:{" "}
                <span className="font-semibold">
                  {data.bothTeamsToScore
                    ? `${data.bothTeamsToScore.label} (${data.bothTeamsToScore.confidence})`
                    : "—"}
                </span>
              </div>
              <div>
                O/U 2.5:{" "}
                <span className="font-semibold">
                  {data.overUnder25
                    ? `${data.overUnder25.label} (${data.overUnder25.confidence})`
                    : "—"}
                </span>
              </div>
            </div>

            {SHOW_DEBUG && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-gray-500">
                  Vezi detalii (raw)
                </summary>
                <pre className="mt-2 text-xs overflow-auto bg-gray-50 p-3 rounded">
                  {JSON.stringify(data.raw ?? data, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
