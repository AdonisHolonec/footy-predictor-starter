// /api/predict.js
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

    const { fixtureId, debug } = req.query;
    if (!fixtureId || !/^\d+$/.test(String(fixtureId))) {
      return res.status(400).json({ error: "Parametrul ?fixtureId este obligatoriu și numeric." });
    }

    // 🔑 cheia din Vercel
    const API_KEY = process.env.API_FOOTBALL_KEY;
    if (!API_KEY) {
      return res.status(500).json({
        error: "Lipsește API_FOOTBALL_KEY în Project → Settings → Environment Variables.",
      });
    }

    // 👉 folosim RAPIDAPI (ai cheia de pe rapidapi.com)
    const url = `https://api-football-v1.p.rapidapi.com/v3/predictions?fixture=${fixtureId}`;
    const headers = {
      "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
      "x-rapidapi-key": API_KEY,
    };

    // cache pe edge (30s)
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");

    // fetch + debug
    const upstream = await fetch(url, { headers });
    const status = upstream.status;
    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!upstream.ok) {
      return res.status(status).json({
        error: "Eroare de la API-FOOTBALL",
        status,
        upstream: data ?? text,
      });
    }

    // mapăm minim pentru UI
    const raw = Array.isArray(data?.response) ? data.response[0] : null;
    const homeTeam = raw?.teams?.home?.name ?? null;
    const awayTeam = raw?.teams?.away?.name ?? null;
    const winHome = raw?.predictions?.percent?.home ?? null;
    const winDraw = raw?.predictions?.percent?.draw ?? null;
    const winAway = raw?.predictions?.percent?.away ?? null;
    const advice = raw?.predictions?.advice ?? null;
    con
