// src/api/footy-predictor.ts
type LocalResult = { status: number; body: any };

const BASE   = import.meta.env.VITE_RAPIDAPI_BASE_URL  || process.env.RAPIDAPI_BASE_URL  || '';
const HOST   = import.meta.env.VITE_RAPIDAPI_HOST      || process.env.RAPIDAPI_HOST      || '';
const KEY    = import.meta.env.VITE_RAPIDAPI_KEY       || process.env.RAPIDAPI_KEY       || '';
const ALLOW  = (import.meta.env.VITE_FOOTY_ALLOWED_PATHS || process.env.FOOTY_ALLOWED_PATHS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export default async function handler(query: Record<string, string | undefined>): Promise<LocalResult> {
  const path = String(query.path ?? '');

  if (!path.startsWith('/')) {
    return { status: 400, body: { error: 'bad_request', message: 'query "path" must start with /' } };
  }
  if (ALLOW.length && !ALLOW.includes(path)) {
    return { status: 403, body: { error: 'forbidden_path', path, allowed: ALLOW } };
  }
  if (!BASE || !HOST || !KEY) {
    return {
      status: 500,
      body: {
        error: 'missing_env',
        missing: {
          RAPIDAPI_BASE_URL: !!BASE,
          RAPIDAPI_HOST: !!HOST,
          RAPIDAPI_KEY: !!KEY,
        },
      },
    };
  }

  const url = new URL(BASE + path);

  for (const [k, v] of Object.entries(query)) {
    if (k === 'path') continue;
    if (path === '/fixtures' && k === 'limit') continue;
    url.searchParams.set(k, String(v ?? ''));
  }

  const upstream = await fetch(url.toString(), {
    headers: {
      'x-rapidapi-key': KEY,
      'x-rapidapi-host': HOST,
      'accept': 'application/json',
    },
  });

  const text = await upstream.text();

  try {
    const json = JSON.parse(text);
    return { status: upstream.status, body: json };
  } catch {
    // întoarce textul brut ca să vezi eroarea în dev
    return { status: upstream.status, body: { raw: text } };
  }
}
