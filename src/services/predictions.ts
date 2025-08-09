export async function getPrediction(fixtureId: number) {
  const r = await fetch(`/api/predict?fixtureId=${fixtureId}`);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error || `Eroare la /api/predict (${r.status})`);
  }
  return r.json();
}
