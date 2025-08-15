// /api/predict.js
// Vercel Node API route

const RAPID_HOST = "api-football-v1.p.rapidapi.com";

function asPctString(v) {
  if (v == null) return null;
  const s = String(v).trim();
  // "~85%" / "85%" / "85 %"
  const mPct = s.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (mPct) return `${mPct[1].replace(",", ".")}%`;

  // "0.85" => "85%"
  const n = parseFloat(s.replace(",", "."));
  if (!Number.isNaN(n)) {
    if (n <= 1) return `${(n * 100).toFixed(0)}%`;
    return `${n.toFixed(0)}%`;
  }
  return null;
}

function parseNumber(v) {
  if (v == null) return null;
  const s = String(v).replace(",", ".").replace("%", "");
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

function pickRecommended(percent = {}) {
  // percent = { home: "45%", draw: "30%", away: "25%" }
  const entries = [
    ["1", parseNumber(percent.home)],
    ["X", parseNumber(percent.draw)],
    ["2", parseNumber(percent.away)],
  ].filter(([, n]) => n != null);

  if (!entries.length) return null;
  entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const [label, val] = entries[0];
  return `${label} (${val?.toFixed(0)}%)`;
}

// ————— Correct Score extractor —————
// Acceptă mai multe forme: array, obiect map, sau alternative
function getCorrectScoreTop(pred) {
  if (!pred) return [];

  // 1) dacă e array:
  // ex: [{score:"1-0", probability:"22%"}] sau {label:"1-0", confidence:"22%"}
  if (Array.isArray(pred.correct_score)) {
    const list = pred.correct_score
      .map((x) => ({
        label: x.score || x.label || x.result || null,
        confidence:
          x.probability ?? x.confidence ?? x.percent ?? x.chance ?? null,
      }))
      .filter((x) => x.label)
      .sort((a, b) => (parseNumber(b.confidence) ?? 0) - (parseNumber(a.confidence) ?? 0));
    return list.slice(0, 3);
  }

  // 2) dacă e obiect: {"1-0":"22%","0-0":"18%",...}
  if (pred.correct_score && typeof pred.correct_score === "object") {
    const list = Object.entries(pred.correct_score)
      .map(([score, prob]) => ({
        label: score,
        confidence: prob,
      }))
      .sort((a, b) => (parseNumber(b.confidence) ?? 0) - (parseNumber(a.confidence) ?? 0));
    return list.slice(0, 3);
  }

  // 3) alte câmpuri posibile:
  //   pred.scores?.correct, pred.score?.correct etc.
  const altMaps = [
    pred.scores?.correct,
    pred.score?.correct,
    pred.correctScores,
    pred.correctscores,
  ].filter(Boolean);

  for (const m of altMaps) {
    if (Array.isArray(m)) {
      const list = m
        .map((x) => ({
          label: x.score || x.label || x.result || null,
          confidence:
            x.probability ?? x.confidence ?? x.percent ?? x.chance ?? null,
        }))
        .filter((x) => x.label)
        .sort((a, b) => (parseNumber(b.confidence) ?? 0) - (parseNumber(a.confidence) ?? 0));
      if (list.length) return list.slice(0, 3);
    } else if (m && typeof m === "object") {
      const list = Object.entries(m)
        .map(([score, prob]) => ({ label: score, confidence: prob }))
        .sort((a, b) => (parseNumber(b.confidence) ?? 0) - (parseNumber(a.confidence) ?? 0));
      if (list.length) return list.slice(0, 3);
    }
  }

  // dacă nu avem, întoarcem gol (UI ascunde secțiunea)
  return [];
}

export default async function handler(req, res) {
  try {
    const { fixture, debug } = req.query;
    if (!fixture) {
      res.status(400).json({ error: "Missing ?fixture" });
      return;
    }

    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      return;
    }

    const url = `https://${RAPID_HOST}/v3/predictions?fixture=${encodeURIComponent(
      fixture
    )}`;

    const r = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": RAPID_HOST,
      },
    });

    const upstream = await r.json();

    // Navigăm structura API-ului (response[0])
    const node = upstream?.response?.[0] ?? upstream?.response ?? null;
    const teams = {
      home:
        node?.teams?.home?.name ??
        node?.teams?.home ??
        node?.fixture?.teams?.home?.name ??
        null,
      away:
        node?.teams?.away?.name ??
        node?.teams?.away ??
        node?.fixture?.teams?.away?.name ??
        null,
    };

    // predicțiile brute
    const pred =
      node?.predictions ??
      node?.prediction ??
      node?.preds ??
      node?.data ??
      {};

    // 1X2: încercăm "percent.home/draw/away"
    const percent =
      pred?.percent ??
      pred?.probabilities ??
      pred?.oneXtwo ??
      {};

    // GG/NG și O/U 2.5 (păstrăm semantica existentă: label + confidence)
    // Aici lăsăm logică minimalistă – dacă ai o mapare mai bună deja în proiect,
    // o poți păstra; secțiunea asta nu rupe UI-ul când lipsesc câmpurile.
    const bothTeamsToScore =
      pred?.both_teams_to_score ||
      pred?.btts ||
      null;

    const overUnder25 =
      pred?.over_under_25 ||
      pred?.overUnder25 ||
      pred?.overunder?.["2.5"] ||
      null;

    // Normalizăm formatele unde e cazul (label + confidence)
    function asLabelConf(x) {
      if (!x) return null;
      if (typeof x === "string") return { label: x, confidence: null };
      if (typeof x === "object") {
        return {
          label: x.label ?? x.pick ?? x.value ?? null,
          confidence:
            asPctString(x.confidence ?? x.probability ?? x.percent ?? x.chance ?? null),
        };
      }
      return null;
    }

    const payload = {
      fixture: Number(fixture),
      teams,
      oneXTwo: {
        home: asPctString(percent.home) ?? null,
        draw: asPctString(percent.draw) ?? null,
        away: asPctString(percent.away) ?? null,
        recommended: pickRecommended(percent),
      },
      bothTeamsToScore: asLabelConf(bothTeamsToScore),
      overUnder25: asLabelConf(overUnder25),
    };

    // —— Correct Score (top 3) ——
    const topCS = getCorrectScoreTop(pred);
    if (topCS.length) {
      payload.correctScore = topCS.map((x) => ({
        label: x.label,
        confidence: asPctString(x.confidence),
      }));
    }

    // opțional: debug upstream
    if (debug) {
      payload.debug = {
        upstreamStatus: r.status,
        upstream,
      };
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(JSON.stringify(payload));
  } catch (err) {
    res
      .status(500)
      .json({ error: "Server error in /api/predict", details: String(err) });
  }
}
