import { useEffect, useMemo, useState } from "react";
import { getPredictions, saveGlobalReco, getGlobalRecoStats } from "./lib/api";
import { formatRO, todayISO, addDays } from "./lib/date";
import StandingsTable from "./components/StandingsTable";

// ligi populare (poți modifica)
const POPULAR_LEAGUES = [
  { id:"283", name:"Romania — Liga I" },
  { id:"39",  name:"England — Premier League" },
  { id:"140", name:"Spain — La Liga" },
  { id:"135", name:"Italy — Serie A" },
  { id:"61",  name:"France — Ligue 1" },
  { id:"78",  name:"Germany — Bundesliga" },
];

type OnePick = { pick:string; conf:number };
type PredictionSet = { oneXtwo:OnePick; gg:OnePick; over25:OnePick; correctScore:OnePick };
type Item = {
  id:string; leagueId:string; league:string; leagueLogo?:string|null;
  home:string; away:string; homeLogo?:string|null; awayLogo?:string|null;
  kickoff:string; status?:string; referee?:string|null;
  goals?:{home:number|null; away:number|null};
  predictions:PredictionSet;
  probs?:{p1:number;pX:number;p2:number;pGG:number;pO25:number};
  lambdas?:{home:number;away:number};
  odds?:{[k:string]:number|null};
  weather?:{temp:number|null; pop:number|null; code:number|null}|null;
  recommended?:{market:"1X2"|"GG"|"O25"; pick:string; conf:number; odd:number; edge:number}|null;
};

// ---------- storage helpers ----------
const lsGet=<T,>(k:string, d:T):T=>{ try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch{return d;} };
const lsSet=(k:string,v:any)=>localStorage.setItem(k,JSON.stringify(v));
const endOfDayTs=()=>{ const e=new Date(); e.setHours(23,59,59,999); return e.getTime(); };
function cacheKey(date:string, leagues:string[]){ return `footy:${date}:${leagues.sort().join(",")}`; }

// ---------- UI ----------
export default function App(){
  const [view, setView] = useState<"predictions"|"standings">("predictions");
  const [date, setDate] = useState<string>(todayISO());
  const [selected, setSelected] = useState<string[]>(() => lsGet("footy:selectedLeagues", ["283"]));
  useEffect(()=>{ lsSet("footy:selectedLeagues", selected); },[selected]);

  const [rows, setRows] = useState<Item[]|null>(null);
  const [source, setSource] = useState<"CACHE"|"API"|"NONE">("NONE");

  async function load(force=false){
    const key = cacheKey(date, selected);
    const cache = !force ? lsGet<{exp:number;items:Item[]}|null>(key,null) : null;
    const now=Date.now();
    if(cache && cache.exp>now){ setRows(cache.items); setSource("CACHE"); return; }
    if(!selected.length){ setRows([]); setSource("API"); return; }
    const data = await getPredictions({ date, leagueIds: selected, limit: 120 });
    setRows(data); setSource("API");
    lsSet(key, { exp:endOfDayTs(), items:data });

    // salvează “recomandate” global (doar sumarul necesar)
    const recos = (data||[])
      .filter(x => !!x.recommended)
      .map(x => ({ 
        fixtureId:x.id, leagueId:x.leagueId, market:x.recommended!.market,
        pick:x.recommended!.pick, conf:x.recommended!.conf, odd:x.recommended!.odd, edge:x.recommended!.edge,
        kickoff:x.kickoff
      }));
    if (recos.length) { await saveGlobalReco(date, recos); }
  }

  useEffect(()=>{ load(false); },[date, selected]);

  // stats globale demo (ultimele 7 zile)
  const [stats, setStats] = useState<any>(null);
  useEffect(()=>{ 
    const from = addDays(todayISO(), -7);
    getGlobalRecoStats(from, todayISO()).then(setStats).catch(()=>{});
  },[]);

  return (
    <div className="min-h-screen bg-[#F5F6F8] p-4 md:p-6"
      style={{ fontFamily:"Inter, ui-sans-serif, system-ui, sans-serif" }}>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold">Footy Predictor — Demo</h1>
        <div className="flex items-center gap-2">
          <div className="bg-white rounded-2xl shadow p-1 flex gap-1">
            <button
              onClick={()=>setView("predictions")}
              className={`px-3 py-1.5 rounded-lg text-sm ${view==="predictions"?"bg-blue-600 text-white":"bg-white"}`}>
              Predicții
            </button>
            <button
              onClick={()=>setView("standings")}
              className={`px-3 py-1.5 rounded-lg text-sm ${view==="standings"?"bg-blue-600 text-white":"bg-white"}`}>
              Clasament
            </button>
          </div>
          {view === "predictions" && (
            <>
              <DaySelector date={date} onChange={setDate} />
              <LeaguePicker selected={selected} onChange={setSelected} />
              <button className="px-3 py-1.5 rounded-lg bg-blue-600 text-white" onClick={()=>load(true)}>
                Actualizează
              </button>
            </>
          )}
        </div>
      </div>

      {view === "predictions" && stats && (
        <div className="bg-white rounded-2xl shadow p-3 mb-4 text-sm text-gray-700">
          <b>Istoric recomandate</b> (ultimele 7 zile): W {stats?.stats?.win} / L {stats?.stats?.lose} — Succes {stats?.stats?.rate}% (total {stats?.stats?.total})
        </div>
      )}

      {view === "predictions" && <MatchesTable rows={rows} />}

      {view === "standings" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow p-3">
            <LeaguePicker selected={selected} onChange={setSelected} />
          </div>
          {selected.map(id => (
            <div key={id}>
              <h2 className="text-lg font-semibold mb-2 text-gray-700">
                {POPULAR_LEAGUES.find(l=>l.id===id)?.name || `Liga ${id}`}
              </h2>
              <StandingsTable leagueId={id} season={new Date().getFullYear().toString()} />
            </div>
          ))}
        </div>
      )}

      {view === "predictions" && (
        <div className="mt-3 text-xs text-gray-400">
          Sursă: {source==="API"?"API live":source==="CACHE"?"cache ziua curentă":"—"} • Data: {date}
        </div>
      )}
    </div>
  );
}

function DaySelector({ date, onChange }:{date:string; onChange:(d:string)=>void}) {
  const days = [...Array(7)].map((_,i)=> addDays(todayISO(), i));
  return (
    <div className="bg-white rounded-2xl shadow p-1 flex gap-1">
      {days.map(d=>(
        <button key={d} onClick={()=>onChange(d)}
          className={`px-2 py-1 rounded-lg text-sm ${d===date?"bg-blue-600 text-white":"bg-white"}`}>
          {new Date(d).toLocaleDateString("ro-RO",{ weekday:"short", day:"2-digit" })}
        </button>
      ))}
      <input type="date" value={date} onChange={e=>onChange(e.target.value)}
        className="ml-2 text-sm border rounded px-2 py-1"/>
    </div>
  );
}

function LeaguePicker({ selected, onChange }:{
  selected:string[]; onChange:(v:string[])=>void;
}) {
  function toggle(id:string){ onChange(selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]); }
  return (
    <div className="bg-white rounded-2xl shadow p-2">
      <div className="flex flex-wrap gap-2 max-w-[680px]">
        {POPULAR_LEAGUES.map(l=>(
          <label key={l.id} className={`px-2 py-1 rounded-lg border text-sm cursor-pointer
            ${selected.includes(l.id)?"bg-blue-600 text-white border-blue-600":"bg-white"}`}>
            <input type="checkbox" className="mr-1" checked={selected.includes(l.id)}
              onChange={()=>toggle(l.id)}/>
            {l.name} <span className="opacity-70 ml-1">({l.id})</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function MatchesTable({ rows }:{ rows:Item[]|null }){
  if (!rows) return <div className="bg-white rounded-2xl shadow p-4">Se încarcă…</div>;
  if (!rows.length) return <div className="bg-white rounded-2xl shadow p-4">Nu există meciuri pentru ziua selectată.</div>;

  return (
    <div className="bg-white rounded-2xl shadow overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-600">
            <th className="text-left p-3">Ora</th>
            <th className="text-left p-3">Liga</th>
            <th className="text-left p-3">Meci</th>
            <th className="text-center p-3" title="Predicție model">1 (%)</th>
            <th className="text-center p-3" title="Predicție model">X (%)</th>
            <th className="text-center p-3" title="Predicție model">2 (%)</th>
            <th className="text-center p-3" title="Predicție GG">GG (%)</th>
            <th className="text-center p-3" title="Predicție Over 2.5">O2.5 (%)</th>
            <th className="text-center p-3">Recomandat</th>
            <th className="text-center p-3">Arbitru</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r=>{
            const hh = new Date(r.kickoff).toLocaleTimeString("ro-RO",{hour:"2-digit",minute:"2-digit"});

            const p1 = r.probs?.p1 != null ? Math.round(r.probs.p1 * 100) : (r.predictions?.oneXtwo?.conf && r.predictions.oneXtwo.pick === "1" ? r.predictions.oneXtwo.conf : null);
            const pX = r.probs?.pX != null ? Math.round(r.probs.pX * 100) : (r.predictions?.oneXtwo?.conf && r.predictions.oneXtwo.pick === "X" ? r.predictions.oneXtwo.conf : null);
            const p2 = r.probs?.p2 != null ? Math.round(r.probs.p2 * 100) : (r.predictions?.oneXtwo?.conf && r.predictions.oneXtwo.pick === "2" ? r.predictions.oneXtwo.conf : null);
            const pGG = r.probs?.pGG != null ? Math.round(r.probs.pGG * 100) : (r.predictions?.gg?.conf && r.predictions.gg.pick === "GG" ? r.predictions.gg.conf : null);
            const pO25 = r.probs?.pO25 != null ? Math.round(r.probs.pO25 * 100) : (r.predictions?.over25?.conf && r.predictions.over25.pick === "Peste 2.5" ? r.predictions.over25.conf : null);

            const getBestClass = (val: number|null, vals: (number|null)[]) => {
              if (val == null) return "";
              const max = Math.max(...vals.filter(v => v != null) as number[]);
              return val === max && val > 0 ? "bg-green-100 font-semibold" : "";
            };

            return (
              <tr key={r.id} className="border-t hover:bg-gray-50">
                <td className="p-3">{hh}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    {r.leagueLogo && <img src={r.leagueLogo} alt="" className="h-5 w-5 rounded" />}
                    <span>{r.league}</span>
                  </div>
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    {r.homeLogo && <img src={r.homeLogo} className="h-6 w-6 rounded" alt=""/>}
                    <span className="font-medium">{r.home}</span>
                    <span className="text-gray-400">vs</span>
                    {r.awayLogo && <img src={r.awayLogo} className="h-6 w-6 rounded" alt=""/>}
                    <span className="font-medium">{r.away}</span>
                  </div>
                </td>

                <td className={`text-center p-3 ${getBestClass(p1, [p1, pX, p2])}`}>
                  {p1 != null ? `${p1}%` : "-"}
                  {r.odds?.["1"] && <div className="text-xs text-gray-500">{r.odds["1"]}</div>}
                </td>
                <td className={`text-center p-3 ${getBestClass(pX, [p1, pX, p2])}`}>
                  {pX != null ? `${pX}%` : "-"}
                  {r.odds?.["X"] && <div className="text-xs text-gray-500">{r.odds["X"]}</div>}
                </td>
                <td className={`text-center p-3 ${getBestClass(p2, [p1, pX, p2])}`}>
                  {p2 != null ? `${p2}%` : "-"}
                  {r.odds?.["2"] && <div className="text-xs text-gray-500">{r.odds["2"]}</div>}
                </td>
                <td className="text-center p-3">
                  {pGG != null ? `${pGG}%` : "-"}
                  {r.odds?.GG && <div className="text-xs text-gray-500">{r.odds.GG}</div>}
                </td>
                <td className="text-center p-3">
                  {pO25 != null ? `${pO25}%` : "-"}
                  {r.odds?.O25 && <div className="text-xs text-gray-500">{r.odds.O25}</div>}
                </td>

                <td className="text-center p-3">
                  {r.recommended ? (
                    <div className="inline-flex flex-col items-center">
                      <span className="text-xs text-gray-500">{r.recommended.market}</span>
                      <span className="font-medium">{r.recommended.pick}</span>
                      <span className="text-xs text-gray-600">
                        {r.recommended.conf}% • @{r.recommended.odd?.toFixed(2)}
                      </span>
                      <span className="text-xs text-green-600">
                        edge {(r.recommended.edge*100).toFixed(0)}%
                      </span>
                    </div>
                  ) : "-"}
                </td>

                <td className="text-center p-3 text-gray-600 text-xs">{r.referee || "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
