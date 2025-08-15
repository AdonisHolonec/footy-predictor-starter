// api/predict.mjs
// Vercel Serverless Function — derive 1X2, BTTS (GG/NG) & O/U 2.5
// Caută atât primary.predictions cât și primary.raw.predictions (unele fixturi pun datele acolo)

const RAPID_HOST = "api-football-v1.p.rapidapi.com";

/* ---------- helpers ---------- */
const num = (x) => {
  if (x === undefined || x === null) return NaN;
  const v = typeof x === "string" ? x.replace("%", "") : x;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const pct = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : `${Math.round(x)}%`);

function pickPredictionsNode(primary) {
  // 1) uneori e direct primary.predictions
  if (primary?.predictions) return primary.predictions;
  // 2) alteori e primary.raw.predictions
  if (primary?.raw?.predictions) return primary.raw.predictions;
  return null;
}

function top2Label(a, b, overLabel, underLabel) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a + b === 0) return null;
  const label = a >= b ? overLabel : underLabel;
  const conf = Math.round((Math.max(a, b) / (a + b)) * 100);
  return { label, confidence: `~${conf}%` };
}

// Heuristică BTTS din media goluri (goals.average.{home,away} sau goals.{home,away})
function deriveBTTSFromGoalsAverage(goalsAvg) {
  if (!goalsAvg) return null;

  // suportă fie { average: {home,away} } fie deja {home,away}
  const g = "average" in goalsAvg ? goalsAvg.average : goalsAvg;
  const h = num(g?.home);
  const a = num(g?.away);

  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;

  const sum = h + a;

  if (h >= 1 && a >= 1) {
    const conf = Math.min(85, Math.round((Math.min(h, a) / 1.2) * 100));
    return { label: "GG", confidence: `~${conf}%` };
  }
  if (sum < 1.8) {
    const conf = Math.min(85, Math.round(((1.8 - sum) / 1.8) * 100) + 50);
    return { label: "NGG", confidence: `~${conf}%` };
  }
  return { label: sum >= 2 ? "GG" : "NGG" };
}

// fallback O/U 2.5 din suma mediei de goluri
function deriveOU25FromGoalsAverage(goalsAvg) {
  if (!goalsAvg) return null;
  const g = "average" in goalsAvg ? goalsAvg.average : goalsAvg;
  const sum = num(g?.home) + num(g?.away);
  if (!Number.isFinite(sum)) return null;

  const label = sum >= 2.5 ? "Peste 2.5" : "Sub 2.5";
  const conf = Math.min(80, Math.round((Math.abs(sum - 2.5) / 2.5) * 100) + 40);
  return { label, confidence: `~${conf}%` };
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const fixture = url.searchParams.get("fixture");
    const debug = url.searchParams.get("debug") === "1";

    if (!fixture) {
      res.status(400).json({ error: "Missing ?fixture" });
      return;
    }

    const key = process.env.API_FOOTBALL_KEY;
    if (!key) {
      res.status(500).json({ error: "Missing API_FOOTBALL_KEY env var" });
      return;
    }

    const upstreamUrl = `https://${RAPID_HOST}/v3/predictions?fixture=${encodeURIComponent(fixture)}`;
    const upstreamResp = await fetch(upstreamUrl, {
      headers: {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": RAPID_HOST,
      },
    });

    if (!upstreamResp.ok) {
      const txt = await upstreamResp.text().catch(() => "");
      res.status(upstreamResp.status).send(txt || "Upstream error");
      return;
    }

    const upstream = await upstreamResp.json();
    const primary = upstream?.response?.[0] ?? {};

    // --- teams
    const teams = {
      home: primary?.teams?.home?.name ?? primary?.teams?.home ?? null,
      away: primary?.teams?.away?.name ?? primary?.teams?.away ?? null,
    };

    // ----- node de predictions (robust: predictions OR raw.predictions)
    const P = pickPredictionsNode(primary);

    // ----- 1X2
    const percent = P?.percent || null;
    const oneXTwo = {
      home: percent ? pct(num(percent.home)) : null,
      draw: percent ? pct(num(percent.draw)) : null,
      away: percent ? pct(num(percent.away)) : null,
      recommended: null,
    };
    if (percent) {
      const h = num(percent.home);
      const x = num(percent.draw);
      const a = num(percent.away);
      const arr = [
        { k: "1", v: h },
        { k: "X", v: x },
        { k: "2", v: a },
      ].filter((e) => Number.isFinite(e.v));
      if (arr.length) {
        arr.sort((A, B) => B.v - A.v);
        oneXTwo.recommended = `${arr[0].k} (${Math.round(arr[0].v)}%)`;
      }
    }

    // ----- O/U 2.5 (direct din predictions.under_over["2.5"] dacă există)
    let overUnder25 = null;
    const uo = P?.under_over?.["2.5"];
    if (uo) {
      const over = num(uo.over);
      const under = num(uo.under);
      const ou = top2Label(over, under, "Peste 2.5", "Sub 2.5");
      if (ou) overUnder25 = ou;
    }

    // ----- GG/NG: încercăm să derivăm din predicții.goals
    // (poate fi P.goals.average.{home,away} sau P.goals.{home,away})
    let bothTeamsToScore = null;
    const goalsNode = P?.goals ?? null;
    bothTeamsToScore = deriveBTTSFromGoalsAverage(goalsNode);

    // fallback O/U 2.5 din media golurilor dacă nu avem uo["2.5"]
    if (!overUnder25) {
      overUnder25 = deriveOU25FromGoalsAverage(goalsNode);
    }

    const out = {
      fixture: Number(fixture),
      teams,
      oneXTwo,
      bothTeamsToScore,
      overUnder25,
      correctScore: null,
      halfTimeGoals: null,
      cardsOver45: null,
      cornersOver125: null,
    };

    if (debug) out.debug = { usedPredictionsNode: !!P, sample: P ?? null };

    res.status(200).json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error", detail: String(err?.message || err) });
  }
}
