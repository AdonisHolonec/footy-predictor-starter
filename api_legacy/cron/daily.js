// api/cron/daily.js
// Rulează o „rutină zilnică”: (1) actualizează recomandările,
// (2) încălzește cache-ul meciurilor din ziua curentă.
// Necesită CRON_SECRET în Environment Variables.

export const config = { runtime: "nodejs" };
export default async function handler(req, res) {
  // ... codul tău ...
}

function baseUrl(req) {
  // În producție, VERCEL_URL e setat (fără https://)
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  // Fallback local/dev
  return req?.headers?.host ? `http://${req.headers.host}` : "http://localhost:5173";
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

export default async function handler(req, res) {
  try {
    const { token } = req.query;
    if (!token || token !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const base = baseUrl(req);
    const out = { ok: true, steps: {} };

    // 1) UPDATE RECOMMENDATIONS (dacă ai endpointul /api/cron/update-reco)
    try {
      const r = await fetch(`${base}/api/cron/update-reco?token=${encodeURIComponent(process.env.CRON_SECRET)}`);
      out.steps.updateReco = {
        status: r.status,
        ok: r.ok,
        body: await safeJson(r),
      };
    } catch (e) {
      out.steps.updateReco = { ok: false, error: String(e) };
    }

    // 2) WARM TODAY (endpointul /api/cron/warm-today din pasul anterior)
    try {
      const r = await fetch(`${base}/api/cron/warm-today?token=${encodeURIComponent(process.env.CRON_SECRET)}`);
      out.steps.warmToday = {
        status: r.status,
        ok: r.ok,
        body: await safeJson(r),
      };
    } catch (e) {
      out.steps.warmToday = { ok: false, error: String(e) };
    }

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
