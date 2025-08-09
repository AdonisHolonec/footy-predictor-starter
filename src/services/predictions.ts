// src/services/predictions.ts
const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/+$/, "") ||
  (typeof window !== "undefined" ? window.location.origin : "");

export async function getPrediction(fixtureId: number) {
  const url = `${API_BASE}/api/predict?fixtureId=${fixtureId}`;
  const r = await fetch(url);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error || `Eroare la /api/predict (${r.status})`);
  }
  return r.json();
}
