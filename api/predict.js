// /api/predict.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { fixtureId } = req.query;
    if (!fixtureId || !/^\d+$/.test(String(fixtureId))) {
      return res.status(400).json({ error: "Parametrul ?fixtureId este obligatoriu și trebuie să fie numeric." });
    }

    const API_KEY = process.env.API_FOOTBALL_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: "Lipsește variabila de mediu API_FOOTBALL_KEY pe Vercel." });
    }

    const RAPIDAPI_HOST = process.env.API_FOOTBALL_HOST || "";
    const isRapid = !!RAPIDAPI_HOST;
    const url = isRapid
      ? `https://${RAPIDAPI_HOST}/v3/predictions?fixture=${fixtureId}`
      : `https://v3.football.api-sports.io/predictions?fixture=${fixtureId}`;

    const headers = isRapid
      ? { "X-RapidAPI-Key": API_KEY, "X-RapidAPI-Host": RAPIDAPI_HOST }
      : { "x-apisports-key": API_KEY };

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");

    const r = await fetch(url, { headers });
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: "Eroare de la API-FOOTBALL", status: r.status, details: data });
    }

    const raw = Array.isArray(data?.response) ? data.response[0] : null;
    const homeTeam = raw?.teams?.home?.name ?? null;
    const awayTeam = raw?.teams?.away?.name ?? null;
    const winHome = raw?.predictions?.percent?.home ?? null;
    const winDraw = raw?.predictions?.percent?.draw ?? null;
    const winAway = raw?.predictions?.percent?.away ?? null;
    const advice = raw?.predictions?.advice ?? null;
    const goalsAvg = raw?.predictions?.goals?.average ?? null;

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

    return res.status(200).json(mapped);
  } catch (err) {
    console.error("[/api/predict] Unexpected error:", err);
    return res.status(500).json({ error: "Eroare internă neprevăzută." });
  }
}

function pctToNum(p) {
  if (p == null) return null;
  const n = Number(String(p).replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}
function pick1X2(homePct, drawPct, awayPct) {
  const h = pctToNum(homePct);
  const d = pctToNum(drawPct);
  const a = pctToNum(awayPct);
  const arr = [
    { k: "1", v: h },
    { k: "X", v: d },
    { k: "2", v: a },
  ].filter(x => x.v != null);
  if (arr.length === 0) return null;
  arr.sort((x, y) => y.v - x.v);
  return `${arr[0].k} (${arr[0].v}%)`;
}
function adviceTo1X2(advice) {
  const s = String(advice).toLowerCase();
  if (s.includes("home") && s.includes("win")) return "1";
  if (s.includes("away") && s.includes("win")) return "2";
  if (s.includes("draw")) return "X";
  return null;
}
function inferGG(goalsAvg) {
  const h = Number(goalsAvg?.home ?? NaN);
  const a = Number(goalsAvg?.away ?? NaN);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const ggLikely = h >= 0.9 && a >= 0.9;
  return ggLikely ? { label: "GG", confidence: "≈60%" } : { label: "NGG", confidence: "≈55%" };
}
function inferOU25(goalsAvg) {
  const h = Number(goalsAvg?.home ?? NaN);
  const a = Number(goalsAvg?.away ?? NaN);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const total = h + a;
  if (total >= 2.6) return { label: "Peste 2.5", confidence: "≈62%" };
  if (total <= 2.3) return { label: "Sub 2.5", confidence: "≈58%" };
  return { label: total >= 2.5 ? "Peste 2.5" : "Sub 2.5", confidence: "≈52%" };
}
