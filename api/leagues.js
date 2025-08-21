// api/leagues.js  —  lists leagues via API-FOOTBALL (RapidAPI)
const BASE = process.env.UPSTREAM_BASE_URL || "https://api-football-v1.p.rapidapi.com/v3";
const KEY  = process.env.X_RAPIDAPI_KEY;
const HOST = process.env.X_RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com";
const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || "7000");

function norm(s = "") { return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim(); }

async function rapid(path) {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), TIMEOUT);
  const r = await fetch(`${BASE}${path}`, {
    headers: { "X-RapidAPI-Key": KEY, "X-RapidAPI-Host": HOST, Accept: "application/json" },
    cache: "no-store",
    signal: ctl.signal,
  });
  clearTimeout(id);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0,180)}`);
  const j = JSON.parse(text);
  return j.response || [];
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  try {
    if (!KEY) return res.status(200).send(JSON.stringify([]));

    const u = new URL(req.url, `http://${req.headers.host}`);
    const countryQ = norm(u.searchParams.get("country") || ""); // ex: romania
    const nameQ    = norm(u.searchParams.get("name") || "");    // ex: liga

    const rows = await rapid("/leagues"); // mare dar sigur
    let out = rows.map(x => ({
      league_id: String(x.league?.id),
      league_name: x.league?.name,
      country_name: x.country?.name,
    }));

    if (countryQ) out = out.filter(x => norm(x.country_name).includes(countryQ));
    if (nameQ)    out = out.filter(x => norm(x.league_name).includes(nameQ));

    return res.status(200).send(JSON.stringify(out));
  } catch {
    return res.status(200).send(JSON.stringify([]));
  }
}
