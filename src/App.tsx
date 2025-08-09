import { useEffect, useState } from 'react'
import { getPrediction } from './services/predictions'

function PredictionCard({ fixtureId }: { fixtureId: number }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getPrediction(fixtureId)
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [fixtureId]);

  return (
    <div className="rounded-2xl p-5 shadow bg-white border border-gray-100">
      <div className="text-sm text-gray-500">Fixture #{fixtureId}</div>
      {loading && <div className="text-gray-500 mt-2">Se încarcă…</div>}
      {err && <div className="text-red-600 mt-2">Eroare: {err}</div>}
      {!loading && !err && data && (
        <div className="mt-3 space-y-2">
          <div className="font-semibold text-gray-800">
            {data?.teams?.home} vs {data?.teams?.away}
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>1: {data?.oneXTwo?.home ?? '—'}</div>
            <div>X: {data?.oneXTwo?.draw ?? '—'}</div>
            <div>2: {data?.oneXTwo?.away ?? '—'}</div>
          </div>
          <div className="text-sm">Recomandat: <b>{data?.oneXTwo?.recommended ?? '—'}</b></div>
          <div className="text-sm">GG/NG: <b>{data?.bothTeamsToScore?.label ?? '—'} {data?.bothTeamsToScore?.confidence ?? ''}</b></div>
          <div className="text-sm">O/U 2.5: <b>{data?.overUnder25?.label ?? '—'} {data?.overUnder25?.confidence ?? ''}</b></div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  // Poți schimba id-ul cu un fixture real
  const [fixtureId, setFixtureId] = useState<number>(215662);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Footy Predictor Starter</h1>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={fixtureId}
            onChange={(e) => setFixtureId(Number(e.target.value))}
            className="px-3 py-2 border rounded-lg w-48"
            placeholder="fixtureId"
          />
          <span className="text-sm text-gray-500">Introdu un fixtureId și vezi predicțiile</span>
        </div>
        <PredictionCard fixtureId={fixtureId} />
      </div>
    </div>
  );
}
