// src/lib/api.ts
export type Query = Record<string, string | number | boolean | undefined | null>;

export async function apiFetch<T = any>(path: string, params: Query = {}): Promise<T> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  });

  const url = `/api/footy-predictor?path=${encodeURIComponent(path)}&${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} ${res.status} ${text || ""}`.trim());
  }
  return res.json();
}
