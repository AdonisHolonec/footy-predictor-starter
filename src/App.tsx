import { useState } from "react";

export default function App() {
  const [fixtureId, setFixtureId] = useState("198772");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setErr(null);
    setData(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/predict?fixture=${fixtureId}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setErr(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Footy Predictor Starter</h1>

      <div className="flex gap-2 mb-4">
        <input
          className="border rounded px-3 py-2 w-48"
          value={fixtureId}
          onChange={(e) => setFixtureId(e.target.value)}
          placeholder="ID meci"
        />
        <button onClick={load} className="bg-black text-white rounded px-4 py-2">
          {loading ? "Se încarcă..." : "Vezi predicțiile"}
        </button>
      </div>

      {err && <div className="bg-red-100 text-red-700 p-3 rounded">{err}</div>}

      {data && (
        <div className="border rounded p-4 space-y-2">
          <div className="text-gray-500">Fixture #{data.fixture}</div>
          <div className="text-xl font-semibold">
            {data.teams?.home ?? "—"} <span className="text-gray-400">vs</span>{" "}
            {data.teams?.away ?? "—"}
          </div>

          <div className="mt-2">
            <div><b>1:</b> {data.oneXTwo?.home ?? "—"} &nbsp; <b>X:</b> {data.oneXTwo?.draw ?? "—"} &nbsp; <b>2:</b> {data.oneXTwo?.away ?? "—"}</div>
            <div><b>Recomandat:</b> {data.oneXTwo?.recommended ?? "—"}</div>
            <div><b>GG/NG:</b> {data.bothTeamsToScore ? `${data.bothTeamsToScore.label} (${data.bothTeamsToScore.confidence})` : "—"}</div>
            <div><b>O/U 2.5:</b> {data.overUnder25 ? `${data.overUnder25.label} (${data.overUnder25.confidence})` : "—"}</div>
          </div>
        </div>
      )}
    </div>
  );
}
