// src/lib/fetch.ts
export function buildApiUrl(path: string, params: Record<string, string | number | undefined>) {
  const url = new URL('/api/footy-predictor', window.location.origin);
  url.searchParams.set('path', path);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    url.searchParams.set(k, String(v));
  });
  return url.toString();
}

export async function fetchJson(url: string) {
  const r = await fetch(url);
  const text = await r.text();
  try {
    const json = JSON.parse(text);
    if (!r.ok) {
      const err = new Error(`API ${r.status}`);
      (err as any).payload = json;
      throw err;
    }
    return json;
  } catch {
    // Acesta este fixul pentru mesajul „Unexpected token '<' …”
    throw new Error(`Upstream did not return JSON (status ${r.status}). First 180 chars:\n${text.slice(0, 180)}…`);
  }
}
