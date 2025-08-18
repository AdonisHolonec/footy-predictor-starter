// api/footy-predictor.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE   = process.env.RAPIDAPI_BASE_URL || '';
const HOST   = process.env.RAPIDAPI_HOST || '';
const KEY    = process.env.RAPIDAPI_KEY || '';
const ALLOW  = (process.env.FOOTY_ALLOWED_PATHS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Ex: /api/footy-predictor?path=/fixtures&date=2025-08-17&league=283&season=2025
    const path = String(req.query.path ?? '');

    if (!path.startsWith('/')) {
      res.status(400).json({ error: 'bad_request', message: 'query "path" must start with /' });
      return;
    }
    if (ALLOW.length && !ALLOW.includes(path)) {
      res.status(403).json({ error: 'forbidden_path', path, allowed: ALLOW });
      return;
    }

    if (!BASE || !HOST || !KEY) {
      res.status(500).json({
        error: 'missing_env',
        missing: {
          RAPIDAPI_BASE_URL: !!BASE,
          RAPIDAPI_HOST: !!HOST,
          RAPIDAPI_KEY: !!KEY,
        },
      });
      return;
    }

    const url = new URL(BASE + path);

    // Propagăm toți parametrii (mai puțin "path")
    Object.entries(req.query).forEach(([k, v]) => {
      if (k === 'path') return;
      // API v3 nu acceptă "limit" pe /fixtures
      if (path === '/fixtures' && k === 'limit') return;
      url.searchParams.set(k, String(Array.isArray(v) ? v[0] : v));
    });

    const upstream = await fetch(url.toString(), {
      headers: {
        'x-rapidapi-key': KEY,
        'x-rapidapi-host': HOST,
        'accept': 'application/json',
      },
      // doar GET pentru acest proxy
      method: 'GET',
    });

    const text = await upstream.text();

    // Răspunde cu JSON dacă e JSON; altfel returnează textul brut (ca să vezi eroarea reală)
    try {
      const json = JSON.parse(text);
      res.status(upstream.status).json(json);
    } catch {
      res.status(upstream.status).send(text);
    }
  } catch (err: any) {
    res.status(500).json({ error: 'proxy_error', message: err?.message ?? String(err) });
  }
}
