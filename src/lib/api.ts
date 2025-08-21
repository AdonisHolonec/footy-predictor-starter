// src/lib/api.ts
import { DEMO_PREDICTIONS } from "../demo/predictions";

export async function getPredictions() {
  const isLocal = import.meta.env.DEV || location.hostname === "localhost";
  if (isLocal) return DEMO_PREDICTIONS;

  try {
    const r = await fetch(`/api/predict?ts=${Date.now()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  } catch {
    return DEMO_PREDICTIONS;
  }
}
