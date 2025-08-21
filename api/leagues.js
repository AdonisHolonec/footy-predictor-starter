// api/leagues.js
// Proxy simplu peste apifootball: caută country_id după nume, apoi întoarce ligile din țara respectivă.
// Poți filtra și după parte din numele ligii cu ?name=super
// Variabile necesare în Vercel: APIFOOTBALL_BASE, APIFOOTBALL_KEY

const BASE = process.env.APIFOOTBALL_BASE || "https://apiv3.apifootball.com/?action=";
const KEY  = process.env.APIFOOTBALL_KEY;

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${t.slice(0, 200)}`);
  let j;
  try { j = JSON.parse(t); } catch { throw new Error("Invalid JSON from upstream"); }
  // apifootball poate întoarce obiect cu eroare
  if (j && typeof j === "object" && !Array.isArray(j) && (j.error || j.message || j.success === 0)) {
    throw new Error(`Upstream error: ${j.error || j.message || "unknown"}`);
  }
  return j;
}

function norm(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "") // scapă de diacritice
    .trim();
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  try {
    if (!KEY) return res.status(200).send(JSON.stringify([]));

    const u = new URL(req.url, `http://${req.headers.host}`);
    const countryQ = norm(u.searchParams.get("country") || "");
    const nameQ    = norm(u.searchParams.get("name") || "");
    const debug    = u.searchParams.get("debug") === "1";

    let leagues = [];

    if (countryQ) {
      // 1) ia lista de țări și găsește country_id
      const countriesUrl = `${BASE}get_countries&APIkey=${KEY}`;
      const countries = await fetchJSON(countriesUrl);

      const match = countries.find(c => norm(c.country_name) === countryQ || norm(c.country_name).includes(countryQ));
      if (!match) {
        return res.status(200).send(JSON.stringify(debug ? { meta: { why: "country_not_found", countryQ }, data: [] } : []));
      }

      const countryId = match.country_id || match.countryId || match.id;
      // 2) adu ligile pentru country_id
      const leaguesUrl = `${BASE}get_leagues&country_id=${countryId}&APIkey=${KEY}`;
      leagues = await fetchJSON(leaguesUrl);
    } else {
      // fără country -> adu toate ligile (poate fi listă mare)
      const leaguesUrl = `${BASE}get_leagues&APIkey=${KEY}`;
      leagues = await fetchJSON(leaguesUrl);
    }

    // filtrează opțional după nume de ligă
    if (nameQ) {
      leagues = leagues.filter(l => norm(l.league_name || "").includes(nameQ));
    }

    const out = leagues.map(l => ({
      league_id: String(l.league_id || l.leagueid || l.id),
      league_name: l.league_name,
      country_name: l.country_name
    }));

    if (debug) {
      return res.status(200).send(JSON.stringify({ meta: { count: out.length }, data: out }));
    }
    return res.status(200).send(JSON.stringify(out));
  } catch (e) {
    // pentru depanare poți switch-ui pe mesaj în clar punând ?debug=1
    return res.status(200).send(JSON.stringify([]));
  }
}
