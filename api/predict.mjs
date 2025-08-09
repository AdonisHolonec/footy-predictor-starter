// /api/predict.js
export default async function handler(req, res) {
  // CORS minimal (opțional)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Acceptă ?fixture sau ?fixtureId
    const fixture = req.query?.fixture || req.query?.fixtureId;
    if (!fixture || !/^\d+$/.test(String(fixture))) {
      return res
        .status(400)
        .json({ error: "Parametrul ?fixture (sau ?fixtureId) este obligatoriu și numeric." });
    }

    const API_KEY = process.env.API_FOOTBALL_KEY;
    if (!API_KEY) {
      return res
        .status(500)
        .json({ error: "Lipsește API_FOOTBALL_KEY în Environment Variables (Vercel)." });
    }

    const url = `https://api-football-v1.p.rapidapi.com/v3/predictions?fixture=${fixture}`;
    const headers = {
      "X-RapidAPI-Key": API_KEY,
      "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com",
    };

    // cache edge
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");

    const upstream = await fetch(url, { headers });
    const status = upstream.status;
    const text = await upstream.text();

    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!upstream.ok) {
      return res
        .status(status)
        .json({ error: "Eroare de la API-FOOTBALL", status, upstream: data ?? text });
    }

    const primary = Array.isArray(data?.response) ? data.response[0] : null;

    // extrageri
    const homeTeam = primary?.teams?.home?.name ?? null;
    const awayTeam = primary?.teams?.away?.name ?? null;

    const pHome  = primary?.predictions?.percent?.home ?? null; // ex: "45%"
    const pDraw  = primary?.predictions?.percent?.draw ?? null; // ex: "30%"
    const pAway  = primary?.predictions?.percent?.away ?? null; // ex: "25%"
    const advice = primary?.predictions?.advice ?? null;         // ex: "Combo Double chance ..."
    const goalsAvg = primary?.predictions?.goals?.average ?? null; // uneori { home, away }

    const mapped = {
      fixture: Number(fixture),
      teams: { home: homeTeam, away: awayTeam },

      oneXTwo: {
        home: pHome,
        draw: pDraw,
        away: pAway,
        // alegem cel mai mare procent; dacă lipsesc, încercăm să înțelegem din 'advice'
        recommended: pick1X2(pHome, pDraw, pAway) || adviceTo1X2(advice),
      },

      // dacă API nu oferă explicit BTTS/O/U, derivăm din mediile de goluri
      bothTeamsToScore: inferGG(goalsAvg),          // { label: "GG"/"NGG", confidence: "≈60%" } | null
      overUnder25:     inferOU25(goalsAvg),         // { label: "Peste/Sub 2.5", confidence } | null

      // placeholder pentru alte piețe (le poți completa ulterior)
      correctScore: null,
      halfTimeGoals: null,
      cardsOver45: null,
      cornersOver125: null,

      // îți las și brutul pentru debug
      raw: primary ?? null,
    };

    if (req.query?.debug === "1") {
      return res.status(200).json({
        ...mapped,
        debug: { upstreamStatus: status, upstream: data ?? text },
      });
    }

    return res.status(200).json(mapped);
  } catch (err) {
    console.error("[/api/predict] crash:", err);
    return res.status(500).json({ error: "Internal error", details: String(err?.message || err) });
  }
}

/* ===== Helpers ===== */
function pctToNum(p) {
  if (p == null) return null;
  const n = Number(String(p).replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}
function pick1X2(homePct, drawPct, awayPct) {
  const h = pctToNum(homePct), d = pctToNum(drawPct), a = pctToNum(awayPct);
  const arr = [{ k: "1", v: h }, { k: "X", v: d }, { k: "2", v: a }].filter(x => x.v != null);
  if (!arr.length) return null;
  arr.sort((x, y) => y.v - x.v);
  return `${arr[0].k} (${arr[0].v}%)`;
}
function adviceTo1X2(advice) {
  if (!advice) return null;
  const s = String(advice).toLowerCase();
  if (s.includes("home") && s.includes("win")) return "1";
  if (s.includes("away") && s.includes("win")) return "2";
  if (s.includes("draw")) return "X";
  if (s.includes("double chance")) return "1X / X2";
  return null;
}
function inferGG(goalsAvg) {
  const h = Number(goalsAvg?.home ?? NaN);
  const a = Number(goalsAvg?.away ?? NaN);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const tot = h + a;
  if (h >= 1.0 && a >= 1.0) return { label: "GG", confidence: "≈60%" };
  if (tot >= 2.4 && h >= 0.9 && a >= 0.9) return { label: "GG", confidence: "≈55%" };
  return { label: "NGG", confidence: "≈55%" };
}
function inferOU25(goalsAvg) {
  const h = Number(goalsAvg?.home ?? NaN);
  const a = Number(goalsAvg?.away ?? NaN);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const tot = h + a;
  if (tot >= 2.6) return { label: "Peste 2.5", confidence: "≈62%" };
  if (tot <= 2.3) return { label: "Sub 2.5", confidence: "≈58%" };
  return { label: tot >= 2.5 ? "Peste 2.5" : "Sub 2.5", confidence: "≈52%" };
}
