// src/App.tsx (fragment – arată cum se folosesc buildApiUrl + fetchJson)
import { useState } from 'react';
import { buildApiUrl, fetchJson } from './lib/fetch';

export default function App() {
  const [date, setDate] = useState('2025-08-17');
  const [leagueId, setLeagueId] = useState(283);
  const [season, setSeason] = useState(2025);
  const [limit, setLimit] = useState(10);
  const [pauseMs, setPauseMs] = useState(350);
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setItems([]);

    try {
      // 1) FIXTURES (pe /fixtures fără "limit")
      const urlFixtures = buildApiUrl('/fixtures', {
        date,
        league: leagueId,
        season
      });
      const fixtures = await fetchJson(urlFixtures);

      const list = fixtures?.response ?? [];
      const sliced = list.slice(0, limit);

      // 2) PREDS pentru fiecare fixture (cu pauză între request-uri)
      const out: any[] = [];
      for (const f of sliced) {
        const id = f?.fixture?.id;
        if (!id) continue;

        const urlPred = buildApiUrl('/predictions', { fixture: id });
        const pr = await fetchJson(urlPred);
        out.push({ fixture: f, prediction: pr?.response?.[0] });
        await new Promise(r => setTimeout(r, pauseMs));
      }
      setItems(out);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  return (
    <div className="p-4">
      {/* … UI-ul tău existent … */}
      <button onClick={run}>Rulează</button>

      {error && <p className="text-red-600 whitespace-pre-wrap">{error}</p>}
      {/* … afișare rezultate … */}
    </div>
  );
}
