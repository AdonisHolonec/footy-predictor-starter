// api/leagues.js
// Mic proxy către apifootball ca să poți căuta leagueId după țară/nume.
// Necesită variabilele APIFOOTBALL_BASE și APIFOOTBALL_KEY (le ai deja).

const BASE = process.env.APIFOOTBALL_BASE || "https://apiv3.apifootball.com/?action=";
const KEY  = process.env.APIFOOTBALL_KEY;

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${t.slice(0,180)}`);
  return JSON.parse(t);
}

export default async function handler(req, res) {
  res.setHeader("Content-Type","application/json");
  res.setHeader("Cache-Control","no-store");

  try {
    if (!KEY) return res.status(200).send(JSON.stringify([]));

    // get_leagues din apifootball; filtrăm local
    const url = `${BASE}get_leagues&APIkey=${KEY}`;
    const leagues = await fetchJSON(url);

    const u = new URL(req.url, `http://${req.headers.host}`);
    const country = (u.searchParams.get("country") || "").toLowerCase(); // ex: romania
    const name    = (u.searchParams.get("name") || "").toLowerCase();    // ex: super

    const out = leagues
      .filter(l => !country || (l.country_name || "").toLowerCase().includes(country))
      .filter(l => !name || (l.league_name || "").toLowerCase().includes(name))
      .map(l => ({
        league_id: String(l.league_id || l.leagueid || l.id),
        league_name: l.league_name,
        country_name: l.country_name
      }));

    res.status(200).send(JSON.stringify(out));
  } catch {
    res.status(200).send(JSON.stringify([]));
  }
}
