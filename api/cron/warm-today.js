// api/cron/warm-today.js
// Încălzește cache-ul pentru o zi (implicit azi) și pentru mai multe ligi.
// Folosește endpointul intern /api/predict ca să populeze cache-ul (reutilizează logica existentă).

export const config = { runtime: "nodejs" };
export default async function handler(req, res) {
  // ... codul tău ...
}

function todayISO() {
  // YYYY-MM-DD în UTC (poți schimba ușor dacă vrei TZ RO)
  return new Date().toISOString().slice(0, 10);
}

function parseLeagues(q, fallback) {
  const raw = (q || fallback || "").toString();
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default async function handler(req, res) {
  try {
    // securizare simplă
    const { token, date, leagues } = req.query;
    if (!token || token !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // ziua vizată (implicit azi UTC)
    const iso = (date || todayISO()).slice(0, 10);

    // ligi: 1) query ?leagues=283,39,140 sau
    //      2) KV/ENV în proiect (DEFAULT_LEAGUE_IDS), altfel fallback 283 (Liga 1 RO)
    const defaultLeagues =
      process.env.DEFAULT_LEAGUE_IDS || "283"; // ex: "283,39,140,135"
    const leaguesArr = parseLeagues(leagues, defaultLeagues);
    if (leaguesArr.length === 0) {
      return res.status(400).json({ ok: false, error: "no leagues provided" });
    }

    // base URL
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `http://localhost:5173`;

    const results = [];
    for (const id of leaguesArr) {
      const url = `${base}/api/predict?leagueId=${encodeURIComponent(
        id
      )}&date=${encodeURIComponent(iso)}&warm=1&ts=${Date.now()}`;
      try {
        const r = await fetch(url, { method: "GET" });
        const j = await r.json().catch(() => ({}));
        results.push({
          leagueId: id,
          status: r.status,
          ok: r.ok,
          size: Array.isArray(j) ? j.length : j?.data?.length ?? undefined,
        });
      } catch (e) {
        results.push({ leagueId: id, ok: false, error: String(e) });
      }
    }

    res.status(200).json({
      ok: true,
      date: iso,
      warmed: results,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}
