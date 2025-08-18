// ============================================
// Vercel Serverless Function (Node 18+)
// Input:  { homeTeam, awayTeam, features?, maxGoals?, topK? }
// Output: { homeTeam, awayTeam, top: [{score, prob}], version }
// NOTE: Înlocuiește mock-ul cu apelul la modelul tău real când e gata.
// ============================================

import type { VercelRequest, VercelResponse } from "@vercel/node";

type Scoreline = `${number}-${number}`;

type PredictRequest = {
  homeTeam: string;
  awayTeam: string;
  features?: {
    homeAvgGoals?: number; // ex: medie goluri ultimele 10 meciuri
    awayAvgGoals?: number;
    homeDefStrength?: number; // 0..1 (1 = apărare foarte puternică)
    awayDefStrength?: number; // 0..1
  };
  maxGoals?: number; // default 5 (range sigur 3..8)
  topK?: number; // default 5 (range 1..10)
};

type PredictResponse = {
  homeTeam: string;
  awayTeam: string;
  top: Array<{ score: Scoreline; prob: number }>; // prob în [0,1]
  all?: Array<{ score: Scoreline; prob: number }>;
  version: string;
};

// --- Util: parse number în siguranță
const num = (v: unknown, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : d;

// --- Mock model bazat pe Poisson (doar ca fallback)
function mockModelPredict({
  homeLambda,
  awayLambda,
  maxGoals,
}: {
  homeLambda: number;
  awayLambda: number;
  maxGoals: number;
}) {
  const factorial = (n: number): number => {
    let v = 1;
    for (let i = 2; i <= n; i++) v *= i;
    return v;
  };

  const pois = (k: number, lambda: number) =>
    Math.pow(lambda, k) * Math.exp(-lambda) / factorial(k);

  const matrix: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    const ph = pois(h, homeLambda);
    for (let a = 0; a <= maxGoals; a++) {
      const pa = pois(a, awayLambda);
      matrix[h][a] = ph * pa; // independență H/A
    }
  }
  // Normalizează din cauza trunchierii la maxGoals
  const sum = matrix.flat().reduce((s, x) => s + x, 0) || 1;
  for (let h = 0; h <= maxGoals; h++)
    for (let a = 0; a <= maxGoals; a++) matrix[h][a] /= sum;

  return matrix;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const body: PredictRequest = req.body || {};
    const homeTeam = (body.homeTeam || "").toString().trim();
    const awayTeam = (body.awayTeam || "").toString().trim();

    if (!homeTeam || !awayTeam) {
      res.status(400).json({ error: "homeTeam and awayTeam are required" });
      return;
    }

    const maxGoals = Math.min(Math.max(num(body.maxGoals, 5), 3), 8); // 3..8
    const topK = Math.min(Math.max(num(body.topK, 5), 1), 10); // 1..10

    // Derivare lambdas provizorii din features
    const f = body.features || {};
    const baseHome = num(f.homeAvgGoals, 1.6);
    const baseAway = num(f.awayAvgGoals, 1.2);
    const defH = 1 - Math.min(Math.max(num(f.awayDefStrength, 0.5), 0), 1); // cât de „sită” e apărarea oaspeților
    const defA = 1 - Math.min(Math.max(num(f.homeDefStrength, 0.5), 0), 1); // cât de „sită” e apărarea gazdelor

    const homeLambda = Math.max(0.2, baseHome * (0.9 + defH * 0.4));
    const awayLambda = Math.max(0.2, baseAway * (0.9 + defA * 0.4));

    const matrix = mockModelPredict({ homeLambda, awayLambda, maxGoals });

    const flat: Array<{ score: Scoreline; prob: number }> = [];
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        flat.push({ score: `${h}-${a}` as Scoreline, prob: matrix[h][a] });
      }
    }

    flat.sort((a, b) => b.prob - a.prob);
    const top = flat.slice(0, topK);

    const payload: PredictResponse = {
      homeTeam,
      awayTeam,
      top,
      version: "cs-1.0-mock",
    };

    res.status(200).json(payload);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Internal error" });
  }
}
