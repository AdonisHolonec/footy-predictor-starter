// api/cron/update-reco.js
// Calculează „predictia recomandată” per meci și scrie rezultatul în Redis (dacă e disponibil).
// GET /api/cron/update-reco?token=...&date=YYYY-MM-DD&leagues=283,39

import { createClient } from "redis";

export const config = { runtime: "nodejs" };
export default async function handler(req, res) {
  // ... codul tău ...
}

function todayISO() {
  // YYYY-MM-DD (UTC)
  return new Date().toISOString().slice(0, 10);
}
function parseLeagues(q, fallback) {
  const raw = (q || fallback || "").toString();
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// alege recomandarea cu încrederea cea mai mare peste prag
function pickRecommended(match) {
  const p = match?.predictions || {};
  const cands = [];

  if (p.oneXtwo?.pick) cands.push({ market: "1X2", pick: p.oneXtwo.pick, conf: toNum(p.oneXtwo.conf) });
  if (p.gg?.pick)     cands.push({ market: "GG", pick: p.gg.pick, conf: toNum(p.gg.conf) });
  if (p.over25?.pick) cands.push({ market: "Over/Under 2.5", pick: p.over25.pick, conf: toNum(p.over25.conf) });
  if (p.correctScore?.pick)
    cands.push({ market: "Correct Score", pick: p.correctScore.pick, conf: toNum(p.correctScore.conf) });

  cands.sort((a, b) => (b.conf || 0) - (a.conf || 0));
  const best = cands[0];
  if (!best) return null;

  const MIN = toNum(process.env.RECO_MIN_CONF || 55);
  if (best.conf < MIN) return null;

  return {
    id: match.id || match.fixtureId || match.match_id,
    league: match.league || match.league_name,
    home: match.home,
    away: match.away,
    kickoff: match.kickoff || match.date || match.datetime,
    recommendation: best,
  };
}

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  const client = createClient({ url: process.env.REDIS_URL });
  client.on("error", () => {});
  await client.connect();
  return client;
}

function baseUrl(req) {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return req?.headers?.host ? `http://${req.headers.host}` : "http://localhost:5173";
}

export default async function handler(req, res) {
  try {
    const { token, date, leagues } = req.query;
    if (!token || token !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const iso = (date || todayISO()).slice(0, 10);
    const defaultLeagues = process.env.DEFAULT_LEAGUE_IDS || "283"; // ex: "283,39,140"
    const leagueIds = parseLeagues(leagues, defaultLeagues);
    if (leagueIds.length === 0) {
      return res.status(400).json({ ok: false, error: "no leagues provided" });
    }

    const base = baseUrl(req);
    const out = { ok: true, date: iso, leagues: leagueIds, results: [] };

    const redis = await getRedis().catch(() => null);
    const exSeconds = 60 * 60 * 24; // 24h

    for (const id of leagueIds) {
      try {
        const url = `${base}/api/predict?leagueId=${encodeURIComponent(id)}&date=${encodeURIComponent(
          iso
        )}&ts=${Date.now()}`;
        const r = await fetch(url);
        const data = await r.json().catch(() => []);

        const recos = (Array.isArray(data) ? data : data?.data || [])
          .map(pickRecommended)
          .filter(Boolean);

        // salvează în Redis
        if (redis) {
          const key = `reco:${iso}:${id}`;
          await redis.set(key, JSON.stringify(recos), { EX: exSeconds });
          // agregat pe toată ziua
          const allKey = `reco:${iso}:all`;
          await redis.set(allKey, JSON.stringify([...(JSON.parse((await redis.get(allKey)) || "[]")), ...recos]), {
            EX: exSeconds,
          });
        }

        out.results.push({ leagueId: id, count: recos.length });
      } catch (e) {
        out.results.push({ leagueId: id, error: String(e) });
      }
    }

    if (redis) await redis.quit().catch(() => {});
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}
