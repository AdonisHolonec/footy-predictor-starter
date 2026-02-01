// /api/predict.js — zi + multi-ligă + vreme + arbitru + sigle + odds + recomandare per meci
// + cache în Vercel KV (odds 6h, coordonate stadion 24h)

import { kv } from "@vercel/kv";

export const config = { runtime: "nodejs" };

const BASE = process.env.UPSTREAM_BASE_URL || "https://api-football-v1.p.rapidapi.com/v3";
const KEY  = process.env.X_RAPIDAPI_KEY;
const HOST = process.env.X_RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com";
const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || "8000");

// -------------- fetch helpers --------------
function aFetch(url, headers) {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), TIMEOUT);
  return fetch(url, { headers, cache: "no-store", signal: ctl.signal })
    .finally(() => clearTimeout(id));
}
async function rapid(path) {
  const r = await aFetch(`${BASE}${path}`, {
    "X-RapidAPI-Key": KEY,
    "X-RapidAPI-Host": HOST,
    Accept: "application/json",
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  const j = JSON.parse(t);
  return j.response || [];
}

// -------------- math / models --------------
function poisson(l, k) { let f=1; for (let i=2;i<=k;i++) f*=i; return Math.exp(-l)*Math.pow(l,k)/f; }
function joint(lh, la, max=6){
  const H=[...Array(max+1)].map((_,k)=>poisson(lh,k));
  const A=[...Array(max+1)].map((_,k)=>poisson(la,k));
  return H.map(ph => A.map(pa => ph*pa));
}
function probs(M){
  let pH=0,pD=0,pA=0,pO25=0,pGG=0,b={s:"0-0",p:0};
  for (let i=0;i<M.length;i++) for (let j=0;j<M[i].length;j++){
    const p=M[i][j];
    if (i>j) pH+=p; else if (i<j) pA+=p; else pD+=p;
    if (i+j>=3) pO25+=p;
    if (i>0 && j>0) pGG+=p;
    if (p>b.p) b={s:`${i}-${j}`,p};
  }
  return { pH,pD,pA,pO25,pGG,b };
}
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function teamGFGA(rows, teamId, N=8){
  const take = rows.slice(0,N);
  if (!take.length) return { att:1, def:1, form:0.5 };
  let gf=0, ga=0, f=0;
  for (const r of take){
    const th=r.teams?.home?.id, ta=r.teams?.away?.id;
    const gh=r.goals?.home ?? 0, ga1=r.goals?.away ?? 0;
    const isH=String(th)===String(teamId);
    const _gf=isH?gh:ga1, _ga=isH?ga1:gh;
    gf+=_gf; ga+=_ga;
    if (_gf>_ga) f+=3; else if (_gf===_ga) f+=1;
  }
  const mp=take.length, avgGF=gf/mp, avgGA=ga/mp, leagueAvg=1.3;
  return { att:clamp(avgGF/leagueAvg,0.6,1.6), def:clamp(avgGA/leagueAvg,0.6,1.6), form:f/(3*mp) };
}
function computePrediction(fx, homeLast, awayLast){
  const H=teamGFGA(homeLast, fx.home_id), A=teamGFGA(awayLast, fx.away_id);
  const baseH=1.45, baseA=1.15;
  const lH=clamp(baseH*H.att*(1/Math.max(0.6,A.def))*(1+(H.form-0.5)*0.2),0.2,5);
  const lA=clamp(baseA*A.att*(1/Math.max(0.6,H.def))*(1+(A.form-0.5)*0.2),0.2,5);
  const P=probs(joint(lH,lA,6));
  const best=[{k:"1",v:P.pH},{k:"X",v:P.pD},{k:"2",v:P.pA}].sort((a,b)=>b.v-a.v)[0];
  const pred={
    oneXtwo:   { pick:best.k, conf:Math.round(best.v*100) },
    gg:        { pick:P.pGG>=0.5?"GG":"NGG",      conf:Math.round(Math.max(P.pGG,1-P.pGG)*100) },
    over25:    { pick:P.pO25>=0.5?"Peste 2.5":"Sub 2.5", conf:Math.round(Math.max(P.pO25,1-P.pO25)*100) },
    correctScore:{ pick:P.b.s, conf:Math.round(P.b.p*100) }
  };
  return { pred, probs:{ p1:+P.pH.toFixed(3), pX:+P.pD.toFixed(3), p2:+P.pA.toFixed(3), pGG:+P.pGG.toFixed(3), pO25:+P.pO25.toFixed(3) }, lambdas:{ home:+lH.toFixed(2), away:+lA.toFixed(2) } };
}

// -------------- odds / venue / weather --------------
async function getOddsForFixture(fixtureId){
  try{
    const key = `odds:${fixtureId}`;
    const cached = await kv.get(key);
    if (cached) return cached;

    const rows = await rapid(`/odds?fixture=${fixtureId}`);
    const out = { "1":null, "X":null, "2":null, GG:null, NGG:null, O25:null, U25:null };

    const bk = rows?.[0]?.bookmakers?.[0]; // primul disponibil; poți filtra după nume dacă vrei
    if (bk) {
      for (const bet of (bk.bets||[])) {
        const n = (bet.name||"").toLowerCase();
        if (n.includes("match winner")) {
          for (const v of bet.values||[]) {
            const nm=(v.value||"").toLowerCase();
            if (nm.includes("home")) out["1"]=+v.odd||null;
            if (nm.includes("draw")) out["X"]=+v.odd||null;
            if (nm.includes("away")) out["2"]=+v.odd||null;
          }
        }
        if (n.includes("both teams to score")) {
          for (const v of bet.values||[]) {
            const nm=(v.value||"").toLowerCase();
            if (nm==="yes") out.GG=+v.odd||null;
            if (nm==="no")  out.NGG=+v.odd||null;
          }
        }
        if (n.includes("over/under")) {
          for (const v of bet.values||[]) {
            const nm=(v.value||"").toLowerCase();
            if (nm.includes("over 2.5")) out.O25=+v.odd||null;
            if (nm.includes("under 2.5")) out.U25=+v.odd||null;
          }
        }
      }
    }
    await kv.set(key, out, { ex: 60*60*6 }); // 6h
    return out;
  } catch {
    return { "1":null, "X":null, "2":null, GG:null, NGG:null, O25:null, U25:null };
  }
}

async function venueCoords(venueId){
  if (!venueId) return null;
  const key = `venue:${venueId}`;
  const cached = await kv.get(key);
  if (cached) return cached;

  try {
    const rows = await rapid(`/venues?id=${venueId}`);
    const v = rows?.[0];
    const lat = v?.latitude ?? v?.location?.latitude ?? null;
    const lon = v?.longitude ?? v?.location?.longitude ?? null;
    const val = lat && lon ? { lat:+lat, lon:+lon } : null;
    if (val) await kv.set(key, val, { ex: 60*60*24 }); // 24h
    return val;
  } catch { return null; }
}

async function weatherAt(lat, lon, iso){
  try{
    const date = iso.slice(0,10);
    const hourUTC = new Date(iso).getUTCHours().toString().padStart(2,"0")+":00";
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,weathercode&start_date=${date}&end_date=${date}&timezone=UTC`;
    const r = await fetch(url, { cache:"no-store" });
    const j = await r.json();
    const H = j?.hourly || {};
    const idx = (H.time||[]).indexOf(`${date}T${hourUTC}`);
    if (idx>=0) {
      return {
        temp: H.temperature_2m?.[idx] ?? null,
        pop:  H.precipitation_probability?.[idx] ?? null,
        code: H.weathercode?.[idx] ?? null
      };
    }
    return null;
  } catch { return null; }
}

// -------------- upstream adapters --------------
async function fixturesByDateLeague(leagueId, dateISO){
  const rows = await rapid(`/fixtures?league=${leagueId}&date=${dateISO}`);
  return rows.map(x => ({
    id:x.fixture?.id,
    leagueId:x.league?.id,
    league:x.league?.name,
    leagueLogo:x.league?.logo || null,
    home_id:x.teams?.home?.id, away_id:x.teams?.away?.id,
    home:x.teams?.home?.name, away:x.teams?.away?.name,
    homeLogo:x.teams?.home?.logo || null,
    awayLogo:x.teams?.away?.logo || null,
    kickoff:x.fixture?.date,
    status:x.fixture?.status?.short,
    referee:x.fixture?.referee || null,
    venueId:x.fixture?.venue?.id || null,
    goals:{ home:x.goals?.home ?? null, away:x.goals?.away ?? null }
  }));
}
const lastTeam = (teamId, n=8) => rapid(`/fixtures?team=${teamId}&last=${n}`);

// -------------- main handler --------------
export default async function handler(req, res) {
  res.setHeader("Content-Type","application/json");
  // Edge cache (server) 10 minute; clientul ține până la 23:59
  res.setHeader("Cache-Control","s-maxage=600, stale-while-revalidate=120");

  try {
    if (!KEY) return res.status(200).send(JSON.stringify([]));

    const u = new URL(req.url, `http://${req.headers.host}`);
    const date = u.searchParams.get("date") || new Date().toISOString().slice(0,10);
    const leagueIds = (u.searchParams.get("leagueIds")||"")
      .split(",").map(s=>s.trim()).filter(Boolean);
    const limit = Math.min(Number(u.searchParams.get("limit")||"120"), 120);

    if (!leagueIds.length) return res.status(200).send(JSON.stringify([]));

    // 1) fixtures pentru ligile selectate, doar în ziua aleasă
    const perLeague = await Promise.all(leagueIds.map(id => fixturesByDateLeague(id, date).catch(()=>[])));
    const fixtures = perLeague.flat().slice(0, limit);

    // 2) enrich per meci: ultimele meciuri, model, odds, vreme, recomandare
    const out = [];
    for (const fx of fixtures) {
      const [homeLast, awayLast] = await Promise.all([
        lastTeam(fx.home_id, 8).catch(()=>[]),
        lastTeam(fx.away_id, 8).catch(()=>[]),
      ]);

      const { pred, probs, lambdas } = computePrediction(fx, homeLast, awayLast);
      const odds = await getOddsForFixture(fx.id);

      // Recomandare (edge-based)
      const candidates = [
        { market:"1X2", pick:"1",   prob:probs.p1,  odd:odds["1"]  },
        { market:"1X2", pick:"X",   prob:probs.pX,  odd:odds["X"]  },
        { market:"1X2", pick:"2",   prob:probs.p2,  odd:odds["2"]  },
        { market:"GG",  pick:"GG",  prob:probs.pGG, odd:odds.GG   },
        { market:"GG",  pick:"NGG", prob:1-probs.pGG, odd:odds.NGG },
        { market:"O25", pick:"Peste 2.5", prob:probs.pO25, odd:odds.O25 },
        { market:"O25", pick:"Sub 2.5",   prob:1-probs.pO25, odd:odds.U25 },
      ].filter(c => c.odd && c.prob>0);

      const withEdge = candidates.map(c => ({
        ...c, edge:+(c.prob*c.odd - 1).toFixed(2), conf:Math.round(c.prob*100)
      })).sort((a,b)=> (b.edge - a.edge) || (b.conf - a.conf));

      const recommended = withEdge[0]
        ? { market:withEdge[0].market, pick:withEdge[0].pick, conf:withEdge[0].conf, odd:withEdge[0].odd, edge:withEdge[0].edge }
        : null;

      // vreme la ora meciului (dacă avem coordonate stadion)
      let weather=null;
      const coords = await venueCoords(fx.venueId);
      if (coords) weather = await weatherAt(coords.lat, coords.lon, fx.kickoff);

      out.push({
        id:String(fx.id),
        leagueId:fx.leagueId, league:fx.league, leagueLogo:fx.leagueLogo,
        homeId:fx.home_id, awayId:fx.away_id,
        home:fx.home, away:fx.away, homeLogo:fx.homeLogo, awayLogo:fx.awayLogo,
        kickoff:fx.kickoff, status:fx.status, referee:fx.referee, goals:fx.goals,
        predictions: pred, probs, lambdas, odds, weather, recommended
      });
    }

    out.sort((a,b)=> new Date(a.kickoff) - new Date(b.kickoff));
    return res.status(200).send(JSON.stringify(out));
  } catch {
    return res.status(200).send(JSON.stringify([]));
  }
}
