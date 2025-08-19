// api/footy-predictor.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';



const BASE = process.env.UPSTREAM_BASE_URL ?? 'https://example.com'; // <-- setează în Vercel

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const path = String(req.query.path ?? '');
    if (!path || !path.startsWith('/')) {
      return res.status(400).json({ error: 'Query `path` is required and must start with "/"' });
    }

    const url = new URL(path, BASE).toString();

    const controller = new AbortController();
    const timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 8000);
    const t = setTimeout(() => controller.abort(), timeoutMs);

    const upstreamRes = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(process.env.UPSTREAM_API_KEY ? { 'x-api-key': process.env.UPSTREAM_API_KEY } : {}),
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    clearTimeout(t);

    const ct = upstreamRes.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      // Upstream nu a returnat JSON -> returnăm tot JSON cu preview util
      const text = await upstreamRes.text();
      return res.status(502).json({
        error: 'upstream_not_json',
        status: upstreamRes.status,
        preview: text.slice(0, 180),
      });
    }

    const body = await upstreamRes.json();
    return res.status(upstreamRes.ok ? 200 : upstreamRes.status).json(body);
  } catch (err: any) {
    console.error('[api/footy-predictor]', err);
    return res.status(500).json({ error: String(err?.message || err || 'internal_error') });
  }
}
