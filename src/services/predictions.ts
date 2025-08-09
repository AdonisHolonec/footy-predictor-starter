// src/services/predictions.ts
export type Prediction = {
  fixtureId: number;
  teams: { home: string | null; away: string | null };
  oneXTwo: {
    home: string | null;
    draw: string | null;
    away: string | null;
    recommended: string | null;
  };
  bothTeamsToScore: { label: string; confidence: string } | null;
  overUnder25: { label: string; confidence: string } | null;
  correctScore: any | null;
  halfTimeGoals: any | null;
  cardsOver45: any | null;
  cornersOver125: any | null;
  raw?: any;
};

const API_BASE =
  (typeof window !== "undefined" ? "" : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") || "";

export async function getPrediction(fixtureId: number): Promise<Prediction> {
  const url = `${API_BASE}/api/predict?fixtureId=${fixtureId}`;
  const r = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}
