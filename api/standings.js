import { kv } from "@vercel/kv";

export const config = { runtime: "nodejs" };

const BASE = process.env.UPSTREAM_BASE_URL || "https://api-football-v1.p.rapidapi.com/v3";
const KEY  = process.env.X_RAPIDAPI_KEY;
const HOST = process.env.X_RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com";
const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || "8000");

async function rapid(path) {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), TIMEOUT);

  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: {
        "X-RapidAPI-Key": KEY,
        "X-RapidAPI-Host": HOST,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: ctl.signal,
    });

    clearTimeout(id);
    const t = await r.text();

    if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);

    const j = JSON.parse(t);
    return j.response || [];
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");

  try {
    if (!KEY) {
      return res.status(200).json({ error: "missing_api_key", data: [] });
    }

    const u = new URL(req.url, `http://${req.headers.host}`);
    const leagueId = u.searchParams.get("leagueId") || u.searchParams.get("league");
    const season = u.searchParams.get("season") || new Date().getFullYear().toString();

    if (!leagueId) {
      return res.status(400).json({ error: "leagueId_required", data: [] });
    }

    const cacheKey = `standings:${leagueId}:${season}`;
    const cached = await kv.get(cacheKey).catch(() => null);

    if (cached) {
      return res.status(200).json({ cached: true, data: cached });
    }

    const rows = await rapid(`/standings?league=${leagueId}&season=${season}`);

    const standings = [];
    for (const item of rows) {
      const league = item?.league || {};

      for (const standing of (league.standings || [])) {
        for (const team of standing) {
          standings.push({
            rank: team.rank,
            team: team.team?.name || "Unknown",
            teamId: team.team?.id,
            teamLogo: team.team?.logo || null,
            points: team.points,
            played: team.all?.played || 0,
            win: team.all?.win || 0,
            draw: team.all?.draw || 0,
            lose: team.all?.lose || 0,
            goalsFor: team.all?.goals?.for || 0,
            goalsAgainst: team.all?.goals?.against || 0,
            goalsDiff: team.goalsDiff,
            form: team.form || null,
            status: team.status || null,
            description: team.description || null,
          });
        }
      }
    }

    standings.sort((a, b) => a.rank - b.rank);

    if (standings.length > 0) {
      await kv.set(cacheKey, standings, { ex: 60 * 60 * 12 }).catch(() => {});
    }

    return res.status(200).json({ cached: false, data: standings });
  } catch (err) {
    console.error("[standings] error:", err);
    return res.status(500).json({
      error: "fetch_failed",
      message: err?.message || String(err),
      data: []
    });
  }
}
