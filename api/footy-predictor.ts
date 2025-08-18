import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED = (process.env.FOOTY_ALLOWED_PATHS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const pathQ = req.query.path;
    const path = Array.isArray(pathQ) ? pathQ[0] : String(pathQ || '');
    if (!path || !ALLOWED.includes(path)) {
      return res.status(400).json({ error: 'invalid or not-allowed path', path, allowed: ALLOWED });
    }

    const base = process.env.RAPIDAPI_BASE_URL!;
    const url = new URL(base + path);

    // forward all query params except 'path'
    Object.entries(req.query).forEach(([k, v]) => {
      if (k === 'path') return;
      if (path === '/fixtures' && k === 'limit') return; // API v3 nu suportă "limit"
      url.searchParams.set(k, Array.isArray(v) ? v[0] : String(v));
    });

    const upstream = await fetch(url.toString(), {
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY || '',
        'x-rapidapi-host': process.env.RAPIDAPI_HOST || ''
      }
    });

    const body = await upstream.text();
    res
      .status(upstream.status)
      .setHeader('content-type', upstream.headers.get('content-type') || 'application/json')
      .send(body);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'proxy failed' });
  }
}
