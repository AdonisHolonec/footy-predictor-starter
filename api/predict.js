// /api/predict.js
// Node.js Serverless Function (CommonJS) — sigur pe Vercel fără ESM
module.exports = async function (req, res) {
  // CORS lejer pentru test
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const { fixtureId, debug } = req.query;
    if (!fixtureId || !/^\d+$/.test(String(fixtureId))) {
      return res.status(400).json({ error: "Parametrul ?fixtureId este obligatoriu și numeric." });
    }

    const API_KEY = process.env.API_FOOTBALL_KEY;
    if (!API_KEY) {
      return res.status(500).json({
        error: "Lipsește API_FOOTBALL_KEY în Project → Settings → Environment Variables.",
      });
    }

    const url = `https://api-football-v1.p.rapidapi.com/v3/predictions?fixture=${fixtureId}`;
    const headers = {
      "X-RapidAPI-Key": API_KEY,
      "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com",
    };

    // mic cache edge
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");

    const upstream = await fetch(url, { headers });
    const status = upst
