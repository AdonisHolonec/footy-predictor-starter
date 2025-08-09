// src/services/predictions.ts
export type OneXTwo = {
  home: string | null;   // ex "45%"
  draw: string | null;
  away: string | null;
  recommended: string | null; // ex "1 (45%)"
};

export type LabelConf = { label: string; confidence: string } | null;

export type Prediction = {
  fixtureId: number;
  teams: { home: string | null; away: string | null };
  oneXTwo: OneXTwo;
  bothTeamsToScore: LabelConf; // ex {label:"GG", confidence:"≈60%"} | null
  overUnder25: LabelConf;      // ex {label:"Peste 2.5", confidence:"≈62%"} | null
  raw?: any;
};

const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/+$/, "") ||
  (typeof window !== "undefined" ? window.location.origin : "");

export async function getPrediction(fixtureId: number): Promise<Prediction> {
  const r = await fetch(`${API_BASE}/api/predict?fixtureId=${fixtureId}`);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error || `Eroare API (${r.status})`);
  }
  return r.json();
}
