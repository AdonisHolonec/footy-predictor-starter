export async function apiFetch(footyPath: string, params: Record<string, any> = {}) {
  const url = new URL('/api/footy-predictor', window.location.origin);
  const sp  = new URLSearchParams({ path: footyPath });
  for (const [k,v] of Object.entries(params)) if (v != null) sp.set(k, String(v));
  url.search = sp.toString();

  const r = await fetch(url.toString(), { headers: { 'Accept':'application/json' } });
  const text = await r.text();
  let data: any;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Non-JSON from API (status ${r.status}): ${text.slice(0,120)}`);
  }
  if (!r.ok) throw new Error(data?.message || r.statusText);
  return data;
}
