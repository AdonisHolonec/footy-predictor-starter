// /api/predict.mjs
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const { fixtureId, debug } = req.query || {};
    if (!fixtureId || !/^\d+$/.test(String(fixtureId))) {
      return res.status(400).json({ error: "Parametrul ?fixtureId este obligatoriu și numeric." });
    }

    const API_KEY = process.env.API_FOOTBALL_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: "Lipsește API_FOOTBALL_KEY în Environment Variables." });
    }

    const doFetch = typeof fetch === "function" ? fetch : (await import("node-fetch")).default;
    const url = `https://api-football-v1.p.rapidapi.com/v3/predictions?fixture=${fixtureId}`;
    const headers = {
      "X-RapidAPI-Key": API_KEY,
      "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com",
    };

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");

    const upstream = await doFetch(url, { headers });
    const status = upstream.status;
    const txt = await upstream.text();
    let data; try { data = JSON.parse(txt); } catch { data = null; }

    if (!upstream.ok) {
      return res.status(status).json({ error: "Eroare de la API-FOOTBALL", status, upstream: data ?? txt });
    }

    const raw = Array.isArray(data?.response) ? data.response[0] : null;

    const homeTeam = raw?.teams?.home?.name ?? null;
    const awayTeam = raw?.teams?.away?.name ?? null;

    const winHome = raw?.predictions?.percent?.home ?? null; // "45%"
    const winDraw = raw?.predictions?.percent?.draw ?? null;
    const winAway = raw?.predictions?.percent?.away ?? null;

    const advice = raw?.predictions?.advice ?? null;
    const goalsAvg = raw?.predictions?.goals?.average ?? null; // { home: "1.6", away: "1.1" }

    const mapped = {
      fixtureId: Number(fixtureId),
      teams: { home: homeTeam, away: awayTeam },
      oneXTwo: {
        home: winHome,
        draw: winDraw,
        away: winAway,
        recommended: pick1X2(winHome, winDraw, winAway) || (advice ? adviceTo1X2(advice) : null),
      },
      bothTeamsToScore: inferGG(goalsAvg),
      overUnder25: inferOU25(goalsAvg),
      correctScore: null,
      halfTimeGoals: null,
      cardsOver45: null,
      cornersOver125: null,
      raw,
    };

    if (debug === "1" || !raw) {
      return res.status(200).json({ ...mapped, debug: { upstreamStatus: status, upstream: data ?? txt } });
    }

    return res.status(200).json(mapped);
  } catch (err) {
    console.error("[/api/predict] crash:", err);
    return res.status(500).json({ error: "Internal error", details: String(err?.message || err) });
  }
}

/* ===== helpers ===== */
function pctToNum(p) {
  if (p == null) return null;
  const n = Number(String(p).replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}
function pick1X2(homePct, drawPct, awayPct) {
  const h = pctToNum(homePct), d = pctToNum(drawPct), a = pctToNum(awayPct);
  const arr = [{k:"1",v:h},{k:"X",v:d},{k:"2",v:a}].filter(x=>x.v!=null);
  if (!arr.length) return null;
  arr.sort((x,y)=>y.v-x.v);
  return `${arr[0].k} (${arr[0].v}%)`;
}
function adviceTo1X2(advice) {
  const s = String(advice).toLowerCase();
  if (s.includes("home") && s.includes("win")) return "1";
  if (s.includes("away") && s.includes("win")) return "2";
  if (s.includes("draw")) return "X";
  if (s.includes("double chance")) return "1X / X2";
  return null;
}
function inferGG(goalsAvg) {
  const h = Number(goalsAvg?.home ?? NaN), a = Number(goalsAvg?.away ?? NaN);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const total = h + a;
  // reguli simple, lizibile:
  if (h >= 1.0 && a >= 1.0) return { label: "GG", confidence: "≈60%" };
  if (total >= 2.4 && h >= 0.9 && a >= 0.9) return { label: "GG", confidence: "≈55%" };
  return { label: "NGG", confidence: "≈55%" };
}
function inferOU25(goalsAvg) {
  const h = Number(goalsAvg?.home ?? NaN), a = Number(goalsAvg?.away ?? NaN);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const total = h + a;
  if (total >= 2.6) return { label: "Peste 2.5", confidence: "≈62%" };
  if (total <= 2.3) return { label: "Sub 2.5", confidence: "≈58%" };
  return { label: total >= 2.5 ? "Peste 2.5" : "Sub 2.5", confidence: "≈52%" };
}
