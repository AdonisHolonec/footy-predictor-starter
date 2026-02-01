import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Footy Predictor – UI (Vite + React + Tailwind)
 * - păstrează selecțiile (ligile) și ultimele rezultate în localStorage
 * - ligile favorite rămân mereu primele, restul vin în ordinea primită de la API (care e deja "quality sorted")
 * - carduri cu logo-uri, nume echipe (fără tăiere agresivă), bară 1X2 colorată cu culorile dominante din logo-uri (fallback hash)
 */

type Usage = { date: string; count: number; limit: number };
type DayDebug = { fromCache?: boolean; stale?: boolean; budgetBlocked?: boolean };
type League = { id: number; name: string; country: string; matches: number };

type Probs = {
  p1: number; pX: number; p2: number;
  pGG: number; pO25: number; pU35: number; pO15: number;
  p12?: number; p1X?: number; pX2?: number;
};

type PredictionRow = {
  id: number;
  leagueId: number;
  league: string;
  teams: { home: string; away: string };
  logos?: { league?: string; home?: string; away?: string };
  kickoff: string;
  status: string;
  referee?: string | null;
  lambdas: { home: number; away: number };
  probs: Probs;
  predictions: { oneXtwo: string; gg: string; over25: string; correctScore: string };
  recommended: { pick: string; confidence: number };
  _debug?: Record<string, any>;
};

type DayResponse = {
  ok: boolean;
  date: string;
  totalFixtures: number;
  leagues: League[];
  usage: Usage;
  _debug?: DayDebug;
};

function isoToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function inferSeason(dateISO: string): number {
  // sezonul fotbalistic (Europa): Aug–Mai
  const [y, m] = dateISO.split("-").map(Number);
  if (!y || !m) return new Date().getFullYear() - 1;
  return (m >= 7) ? y : (y - 1);
}

function useLocalStorageState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
  }, [key, v]);

  return [v, setV] as const;
}

function hashColor(seed: string): string {
  // deterministic fallback (nu e "culoarea reală" a echipei, dar evită monotonia)
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const r = (h >>> 16) & 255;
  const g = (h >>> 8) & 255;
  const b = h & 255;
  // normalize spre culori mai "vii"
  const rr = Math.floor(80 + (r / 255) * 150);
  const gg = Math.floor(80 + (g / 255) * 150);
  const bb = Math.floor(80 + (b / 255) * 150);
  return `rgb(${rr}, ${gg}, ${bb})`;
}

async function dominantColorFromImage(url: string): Promise<string | null> {
  // încearcă să extragă o culoare dominantă din logo (canvas).
  // dacă CORS blochează, întoarce null.
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const w = 32, h = 32;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 200) continue; // ignoră transparența
          const rr = data[i], gg = data[i + 1], bb = data[i + 2];
          // ignoră pixeli aproape-albi/neutri (logo-uri cu fundal alb)
          const max = Math.max(rr, gg, bb);
          const min = Math.min(rr, gg, bb);
          if (max > 245 && (max - min) < 10) continue;
          r += rr; g += gg; b += bb; n++;
        }
        if (n < 10) return resolve(null);
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        resolve(`rgb(${r}, ${g}, ${b})`);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function pct(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

const FAV_LEAGUE_IDS = [283, 39, 140, 135, 78, 61]; // Romania + Big 5
const FAV_COUNTRIES = ["Romania", "England", "Spain", "Italy", "Germany", "France"];

export default function App() {
  const [date, setDate] = useLocalStorageState<string>("footy.date", isoToday());
  const [selectedLeagueIds, setSelectedLeagueIds] = useLocalStorageState<number[]>("footy.selectedLeagueIds", []);
  const [day, setDay] = useState<DayResponse | null>(null);
  const [preds, setPreds] = useLocalStorageState<PredictionRow[]>("footy.lastPreds", []);
  const [status, setStatus] = useState<string>("");

  const [autoRefresh, setAutoRefresh] = useLocalStorageState<boolean>("footy.autoRefresh", false);
  const refreshTimer = useRef<number | null>(null);

  // cache culori logo (localStorage)
  const [logoColors, setLogoColors] = useLocalStorageState<Record<string, string>>("footy.logoColors", {});

  const season = useMemo(() => inferSeason(date), [date]);

  const selectedSet = useMemo(() => new Set(selectedLeagueIds), [selectedLeagueIds]);

  const leaguesSorted = useMemo(() => {
    const leagues = day?.leagues ?? [];
    // sigur: favorite primele, apoi restul în ordinea API (care e deja "quality sorted")
    const fav = leagues.filter(l => FAV_LEAGUE_IDS.includes(Number(l.id)) || FAV_COUNTRIES.includes(l.country));
    const rest = leagues.filter(l => !(FAV_LEAGUE_IDS.includes(Number(l.id)) || FAV_COUNTRIES.includes(l.country)));
    // menține ordinea, dar stabilește un mic sort intern pentru favorite ca să fie consistente
    const favRank = (id: number) => {
      const idx = FAV_LEAGUE_IDS.indexOf(id);
      return idx === -1 ? 999 : idx;
    };
    fav.sort((a, b) => favRank(a.id) - favRank(b.id));
    return [...fav, ...rest];
  }, [day]);

  async function fetchDay(d: string) {
    setStatus("Încarc ligile zilei…");
    try {
      const r = await fetch(`/api/fixtures/day?date=${encodeURIComponent(d)}`);
      const j = (await r.json()) as DayResponse;
      if (!j.ok) throw new Error((j as any).error || "Eroare /fixtures/day");
      setDay(j);
      setStatus(j.totalFixtures ? `OK: ${j.totalFixtures} meciuri.` : "Nu sunt meciuri în ziua aleasă.");
    } catch (e: any) {
      setDay(null);
      setStatus(`Eroare: ${e?.message || "Failed to fetch"}`);
    }
  }

  async function warm() {
    if (!selectedLeagueIds.length) {
      setStatus("Selectează cel puțin o ligă.");
      return;
    }
    setStatus("Warm…");
    try {
      const qs = new URLSearchParams({
        date,
        leagueIds: selectedLeagueIds.join(","),
        season: String(season),
        standings: "1",
        teamstats: "1",
      });
      const r = await fetch(`/api/warm?${qs.toString()}`);
      const j = await r.json();
      if (!j.ok) {
        setStatus(`Warm a eșuat: ${j?.errors?.[0]?.error || j?.error || "unknown"}`);
        return;
      }
      setStatus(`Warm OK. calls: ${j?.usage?.count ?? "?"}/${j?.usage?.limit ?? "?"}`);
    } catch (e: any) {
      setStatus(`Warm: ${e?.message || "Failed to fetch"}`);
    }
  }

  async function predict() {
    if (!selectedLeagueIds.length) {
      setStatus("Selectează cel puțin o ligă.");
      return;
    }
    setStatus("Predict…");
    try {
      const qs = new URLSearchParams({
        date,
        leagueIds: selectedLeagueIds.join(","),
        season: String(season),
        limit: "50",
      });
      const r = await fetch(`/api/predict?${qs.toString()}`);
      const j = (await r.json()) as PredictionRow[];
      setPreds(j);
      setStatus(`Predict OK: ${j.length} meciuri.`);
      // persist "last run signature"
      try { localStorage.setItem("footy.lastSignature", JSON.stringify({ date, leagueIds: selectedLeagueIds, season })); } catch {}
      // prefetch culori logo
      void prefetchColors(j);
    } catch (e: any) {
      setStatus(`Predict: ${e?.message || "Failed to fetch"}`);
    }
  }

  async function prefetchColors(rows: PredictionRow[]) {
    const next = { ...logoColors };
    let changed = false;

    for (const row of rows) {
      const h = row.logos?.home;
      const a = row.logos?.away;
      if (h && !next[h]) {
        const c = await dominantColorFromImage(h);
        next[h] = c || hashColor(h);
        changed = true;
      }
      if (a && !next[a]) {
        const c = await dominantColorFromImage(a);
        next[a] = c || hashColor(a);
        changed = true;
      }
    }
    if (changed) setLogoColors(next);
  }

  function toggleLeague(id: number) {
    const s = new Set(selectedLeagueIds);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelectedLeagueIds(Array.from(s));
  }

  function selectFavoritesToday() {
    const todayIds = new Set((day?.leagues ?? []).map(l => Number(l.id)));
    const picks = FAV_LEAGUE_IDS.filter(id => todayIds.has(id));
    setSelectedLeagueIds(picks);
  }

  function clearSelection() {
    setSelectedLeagueIds([]);
  }

  // load day on mount + when date changes
  useEffect(() => {
    fetchDay(date);
    // IMPORTANT: nu resetăm selecția; o păstrăm, dar UI va arăta dacă nu există ligi în ziua respectivă
  }, [date]);

  // auto refresh predictions (optional) – fără să pierzi selecția
  useEffect(() => {
    if (refreshTimer.current) window.clearInterval(refreshTimer.current);

    if (autoRefresh) {
      refreshTimer.current = window.setInterval(() => {
        // rulează predict doar dacă ai selecție
        if (selectedLeagueIds.length) void predict();
      }, 10 * 60 * 1000); // 10 min
    }
    return () => {
      if (refreshTimer.current) window.clearInterval(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, date, selectedLeagueIds.join(","), season]);

  const selectedCount = selectedLeagueIds.length;
  const usageText = day?.usage ? `${day.usage.count}/${day.usage.limit}` : "-";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Top bar */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-600/20 ring-1 ring-emerald-400/30 grid place-items-center font-bold">
              FP
            </div>
            <div>
              <div className="text-xl font-semibold leading-tight">Footy Predictor</div>
              <div className="text-sm text-slate-400">Warm & Predict cu cache • stil “score app”</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl bg-slate-900/60 ring-1 ring-white/10 px-3 py-2 flex items-center gap-2">
              <span className="text-sm text-slate-400">Data</span>
              <input
                value={date}
                onChange={(e) => setDate(e.target.value)}
                type="date"
                className="bg-transparent text-slate-100 text-sm outline-none"
              />
            </div>

            <button
              onClick={warm}
              className="rounded-xl bg-slate-900/60 ring-1 ring-white/10 px-4 py-2 text-sm hover:bg-slate-900"
            >
              Warm
            </button>
            <button
              onClick={predict}
              className="rounded-xl bg-emerald-600/20 ring-1 ring-emerald-400/30 px-4 py-2 text-sm hover:bg-emerald-600/25"
            >
              Predict
            </button>

            <div className="rounded-xl bg-slate-900/60 ring-1 ring-white/10 px-3 py-2 text-sm text-slate-300">
              Selectate: <span className="font-semibold">{selectedCount}</span> • Calls:{" "}
              <span className="font-semibold">{usageText}</span>
            </div>

            <label className="rounded-xl bg-slate-900/60 ring-1 ring-white/10 px-3 py-2 text-sm text-slate-300 flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh (10 min)
            </label>
          </div>
        </div>

        {/* Status */}
        {status && (
          <div className="mt-4 rounded-xl bg-slate-900/60 ring-1 ring-white/10 px-4 py-3 text-sm text-slate-200">
            {status}
          </div>
        )}

        {/* Layout */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: leagues */}
          <div className="lg:col-span-4">
            <div className="rounded-2xl bg-slate-900/50 ring-1 ring-white/10 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold">Ligi</div>
                  <div className="text-xs text-slate-400">Favorite primele • apoi top “valoare”</div>
                </div>
                <div className="text-xs text-slate-400">{leaguesSorted.length} ligi</div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={selectFavoritesToday}
                  className="rounded-xl bg-emerald-600/15 ring-1 ring-emerald-400/25 px-3 py-2 text-xs hover:bg-emerald-600/20"
                >
                  Selectează favorite
                </button>
                <button
                  onClick={clearSelection}
                  className="rounded-xl bg-slate-800/60 ring-1 ring-white/10 px-3 py-2 text-xs hover:bg-slate-800"
                >
                  Clear
                </button>
              </div>

              <div className="mt-4 space-y-2 max-h-[70vh] overflow-auto pr-1">
                {leaguesSorted.map((lg) => {
                  const on = selectedSet.has(lg.id);
                  return (
                    <button
                      key={lg.id}
                      onClick={() => toggleLeague(lg.id)}
                      className={[
                        "w-full text-left rounded-xl px-3 py-2 ring-1 transition",
                        on
                          ? "bg-emerald-600/15 ring-emerald-400/25"
                          : "bg-slate-950/20 ring-white/10 hover:bg-slate-950/35",
                      ].join(" ")}
                      title={`${lg.name} • ${lg.country} • ${lg.matches} meciuri`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-100 truncate">
                            {lg.name}
                          </div>
                          <div className="text-xs text-slate-400 truncate">
                            {lg.country}
                          </div>
                        </div>
                        <div className="text-xs text-slate-300">{lg.matches}</div>
                      </div>
                    </button>
                  );
                })}
                {!leaguesSorted.length && (
                  <div className="text-sm text-slate-400">Nicio ligă găsită.</div>
                )}
              </div>
            </div>
          </div>

          {/* Right: matches */}
          <div className="lg:col-span-8">
            <div className="rounded-2xl bg-slate-900/50 ring-1 ring-white/10 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold">Meciuri & Predicții</div>
                  <div className="text-xs text-slate-400">Card compact • 1X2 / GG / O/U 2.5 / Scor</div>
                </div>
                <div className="text-xs text-slate-400">{preds.length} meciuri</div>
              </div>

              {!preds.length ? (
                <div className="mt-4 rounded-xl bg-slate-950/20 ring-1 ring-white/10 p-4 text-sm text-slate-300">
                  1) Selectează ligile (ideal: favoritele) • 2) apasă <b>Warm</b> • 3) apasă <b>Predict</b>.
                  <div className="mt-2 text-xs text-slate-400">
                    Selecția rămâne salvată (nu mai pierzi ligile după refresh).
                  </div>
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  {preds.map((m) => (
                    <MatchCard key={m.id} row={m} logoColors={logoColors} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer hint */}
        <div className="mt-6 text-xs text-slate-500">
          Tip: dacă atingi limita zilnică de calls, lucrezi doar cu cache până a doua zi.
        </div>
      </div>
    </div>
  );
}

function MatchCard({ row, logoColors }: { row: PredictionRow; logoColors: Record<string, string> }) {
  const homeLogo = row.logos?.home || "";
  const awayLogo = row.logos?.away || "";
  const homeColor = homeLogo ? (logoColors[homeLogo] || hashColor(homeLogo)) : hashColor(row.teams.home);
  const awayColor = awayLogo ? (logoColors[awayLogo] || hashColor(awayLogo)) : hashColor(row.teams.away);
  const drawColor = "rgb(148, 163, 184)"; // slate-400

  const p1 = pct(row.probs.p1);
  const pX = pct(row.probs.pX);
  const p2 = pct(row.probs.p2);

  const kickoff = row.kickoff ? new Date(row.kickoff) : null;
  const timeText = kickoff
    ? kickoff.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";

  // gradient bar "exact" pe segmente 1 / X / 2
  const g1 = p1;
  const gX = p1 + pX;

  const barStyle: React.CSSProperties = {
    background: `linear-gradient(to right,
      ${homeColor} 0%,
      ${homeColor} ${g1}%,
      ${drawColor} ${g1}%,
      ${drawColor} ${gX}%,
      ${awayColor} ${gX}%,
      ${awayColor} 100%)`,
  };

  return (
    <div className="rounded-2xl bg-slate-950/20 ring-1 ring-white/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-slate-400 truncate">{row.league}</div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <TeamLine
              name={row.teams.home}
              logo={homeLogo}
              align="left"
            />
            <div className="text-xs text-slate-500">vs</div>
            <TeamLine
              name={row.teams.away}
              logo={awayLogo}
              align="right"
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-900/60 ring-1 ring-white/10 px-2 py-1 text-slate-300">
              {timeText || "—"} • {row.status}
            </span>
            {row.referee ? (
              <span className="rounded-full bg-slate-900/60 ring-1 ring-white/10 px-2 py-1 text-slate-300">
                {row.referee}
              </span>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-xs text-slate-400">Recomandat</div>
          <div className="mt-1 rounded-xl bg-emerald-600/15 ring-1 ring-emerald-400/25 px-3 py-2">
            <div className="text-sm font-semibold leading-tight">{row.recommended.pick}</div>
            <div className="text-xs text-slate-200">{pct(row.recommended.confidence)}%</div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <StatBox label="1X2" value={`${row.predictions.oneXtwo} (${pct(row.probs.p1)}%/${pct(row.probs.pX)}%/${pct(row.probs.p2)}%)`} />
        <StatBox label="GG/NGG" value={`${row.predictions.gg} (${pct(row.probs.pGG)}%)`} />
        <StatBox label="O/U 2.5" value={`${row.predictions.over25} (${pct(row.probs.pO25)}%)`} />
        <StatBox label="Scor" value={row.predictions.correctScore} />
      </div>

      {/* 1X2 bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>1</span><span>X</span><span>2</span>
        </div>
        <div className="mt-1 h-2 w-full rounded-full ring-1 ring-white/10 overflow-hidden" style={barStyle} />
        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
          <span>{p1}%</span><span>{pX}%</span><span>{p2}%</span>
        </div>
      </div>
    </div>
  );
}

function TeamLine({ name, logo, align }: { name: string; logo?: string; align: "left" | "right" }) {
  return (
    <div className={"flex items-center gap-2 min-w-0 " + (align === "right" ? "justify-end" : "justify-start")}>
      {align === "left" && logo ? (
        <img src={logo} alt="" className="h-6 w-6 rounded-md ring-1 ring-white/10 bg-slate-900/40" />
      ) : null}

      <div className={"min-w-0 " + (align === "right" ? "text-right" : "text-left")}>
        {/* Nu tăiem brutal: 2 linii + tooltip cu numele complet */}
        <div
          className="text-sm font-semibold leading-tight text-slate-100"
          title={name}
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "break-word",
          }}
        >
          {name}
        </div>
      </div>

      {align === "right" && logo ? (
        <img src={logo} alt="" className="h-6 w-6 rounded-md ring-1 ring-white/10 bg-slate-900/40" />
      ) : null}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-900/40 ring-1 ring-white/10 px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}
