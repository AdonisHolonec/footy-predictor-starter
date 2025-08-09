// /api/predict.mjs
// GET /api/predict?fixtureId=123456[&debug=1]

export default async function handler(req, res) {
  // CORS simplu
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { fixtureId, debug } = req.query || {};
    if (!fixtureId || !/^\d+$/.test(String(fixtureId))) {
      return res.status(400).json({ error: "Parametrul ?fixtureId este obligatoriu și numeric." });
    }

    // Cheia din Vercel
    const API_KEY = process.env.API_FOOTBALL_KEY;
    if (!API_KEY) {
      return res.status(500).json({
        error: "Lipsește API_FOOTBALL_KEY în Project → Settings → Environment Variables.",
      });
    }

    // Fallback pentru fetch (în caz că runtime-ul nu îl oferă nativ)
    const doFetch =
      typeof fetch === "function" ? fetch : (await import("node-fetch")).default;

    const url = `https://api-football-v1.p.rapidapi.com/v3/predictions?fixture=${fixtureId}`;
    const headers = {
      "X-RapidAPI-Key": API_KEY,
      "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com",
    };

    // mic cache edge
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");

    const upstream = await doFetch(url, { headers });
    const status = upstream.status;
    const txt = await upstream.text();
    let data; try { data = JSON.parse(txt); } catch { data = null; }

    if (!upstream.ok) {
      return res.status(status).json({
        error: "Eroare de la API-FOOTBALL",
        status,
        upstream: data ?? txt,
      });
    }

    const raw = Array.isArray(data?.response) ? data.response[0] : null;
    const mapped = {
      fixtureId: Number(fixtureId),
      teams: { home: raw?.teams?.home?.name ?? null, away: raw?.teams?.away?.name ?? null },
      oneXTwo: {
        home: raw?.predictions?.percent?.home ?? null,
        draw: raw?.predictions?.percent?.draw ?? null,
        away: raw?.predictions?.percent?.away ?? null,
        recommended: null,
      },
      bothTeamsToScore: null,
      overUnder25: null,
      correctScore: null,
      halfTimeGoals: null,
      cardsOver45: null,
      cornersOver125: null,
      raw,
    };

    if (debug === "1" || !raw) {
      return res.status(200).json({
        ...mapped,
        debug: { upstreamStatus: status, upstream: data ?? txt },
      });
    }

    return res.status(200).json(mapped);
  } catch (err) {
    console.error("[/api/predict] crash:", err);
    return res.status(500).json({ error: "Internal error", details: String(err?.message || err) });
  }
}
