// api/leagues.js
const BASE = process.env.APIFOOTBALL_BASE || "https://apiv3.apifootball.com/?action=";
const KEY  = process.env.APIFOOTBALL_KEY;

function norm(s = "") { return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim(); }

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${t.slice(0,180)}`);
  let j; try { j = JSON.parse(t); } catch { throw new Error("Invalid JSON"); }
  if (j && !Array.isArray(j) && (j.error || j.message || j.success === 0)) throw new Error(String(j.error || j.message));
  return j;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type","application/json");
  res.setHeader("Cache-Control","no-store");

  const u = new URL(req.url, `http://${req.headers.host}`);
  const countryQ = norm(u.searchParams.get("country") || "");
  const nameQ    = norm(u.searchParams.get("name") || "");
  const debug    = u.searchParams.get("debug") === "1";

  const meta = {};
  try {
    if (!KEY) { meta.reason = "missing_key"; return send(res, [], debug, meta); }

    let leagues = [];
    let used = "";

    // 1) încercăm varianta corectă: country -> country_id -> get_leagues
    if (countryQ) {
      try {
        used = "countries+leagues_by_country_id";
        const countries = await fetchJSON(`${BASE}get_countries&APIkey=${KEY}`);
        const match = countries.find(c => {
          const n = norm(c.country_name || "");
          return n === countryQ || n.includes(countryQ);
        });
        if (match) {
          const countryId = match.country_id || match.id;
          leagues = await fetchJSON(`${BASE}get_leagues&country_id=${countryId}&APIkey=${KEY}`);
        } else {
          meta.countryNotFound = true;
        }
      } catch (e) {
        meta.firstPathError = String(e);
      }
    }

    // 2) fallback: ia TOATE ligile și filtrează local
    if (!leagues.length) {
      used = "all_leagues_fallback";
      try {
        leagues = await fetchJSON(`${BASE}get_leagues&APIkey=${KEY}`);
      } catch (e) {
        meta.fallbackError = String(e);
        return send(res, [], debug, { ...meta, used });
      }
    }

    if (nameQ) leagues = leagues.filter(l => norm(l.league_name || "").includes(nameQ));
    const out = leagues.map(l => ({
      league_id: String(l.league_id || l.leagueid || l.id),
      league_name: l.league_name,
      country_name: l.country_name
    }));
    return send(res, out, debug, { ...meta, used, count: out.length });
  } catch (e) {
    return send(res, [], debug, { catch: String(e) });
  }
}

function send(res, data, debug, meta) {
  if (debug) return res.status(200).send(JSON.stringify({ meta, data }));
  return res.status(200).send(JSON.stringify(data));
}
