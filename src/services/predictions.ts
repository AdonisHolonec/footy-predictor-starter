// src/services/predictions.ts

export type OneXTwo = {
  home: string | null;       // ex: "45%"
  draw: string | null;       // ex: "30%"
  away: string | null;       // ex: "25%"
  recommended: string | null; // ex: "1 (45%)" sau "1X / X2"
};

export type LabelConf = { label: string; confidence?: string } | null;

export type PredictResponse = {
  fixture: number;
  teams: { home: string | null; away: string | null };
  oneXTwo: OneXTwo;
  bothTeamsToScore: LabelConf; // GG / NGG (cu confidence dacă e disponibil)
  overUnder25: LabelConf;      // Peste/Sub 2.5 (cu confidence dacă e disponibil)
  // restul de câmpuri le poți accesa prin ?debug=1 în endpoint (vin în `raw`)
};

/**
 * Cere predicțiile pentru o fixtură. Aruncă eroare dacă backend-ul
 * răspunde cu status non-200.
 *
 * @param fixtureId ID-ul numeric al meciului (string ca să putem trimite direct din input).
 */
export async function getPrediction(fixtureId: string): Promise<PredictResponse> {
  const url = `/api/predict?fixture=${encodeURIComponent(fixtureId)}`;
  const res = await fetch(url);

  if (!res.ok) {
    // fie eroare internă, fie de la API-ul upstream
    const txt = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}${txt ? `: ${txt}` : ""}`);
  }

  const data = (await res.json()) as PredictResponse;
  return data;
}
