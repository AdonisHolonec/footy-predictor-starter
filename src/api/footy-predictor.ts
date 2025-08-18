// src/api/footy-predictor.ts
// Gateway local către API-Football (RapidAPI) cu:
//  - validare path
//  - caching in-memory (TTL per endpoint) PERSISTENT între re-importuri
//  - circuit-breaker pe 429 (hold până la reset; servim din cache dacă avem) PERSISTENT
//  - endpoint local "_rate-status" pentru countdown în UI
//  - returnăm exact status + JSON ca upstream (când nu servim din cache)

type AnyObj = Record<string, any>;

const BASE_URL = process.env.RAPIDAPI_BASE_URL!;
const RAPID_HOST = process.env.RAPIDAPI_HOST!;
const RAPID_KEY = process.env.RAPIDAPI_KEY!;
const ALLOWED_PATHS = (process.env.FOOTY_ALLOWED_PATHS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ==== Persistență globală (supraviețuiește reimporturilor în dev) ====
const G = globalThis as any;
if (!G.__FOOTY_STATE__) {
  G.__FOOTY_STATE__ = {
    cache: new Map<string, { status: number; json: any; expires: number }>(),
    rateHoldUntil: 0,
  };
}
const STATE: {
  cache: Map<string, { status: number; json: any; expires: number }>;
  rateHoldUntil: number;
} = G.__FOOTY_STATE__;

// TTL per endpoint (ms)
const TTL_DEFAULT = 10 * 60 * 1000;
const TTL_MAP: Record<string, number> = {
  "/fixtures": 5 * 60 * 1000,
  "/predictions": 60 * 60 * 1000,
  "/odds": 15 * 60 * 1000,
  "/leagues": 24 * 60 * 60 * 1000,
  "/fixtures/headtohead": 60 * 60 * 1000,
};

const now = () => Date.now();
const ttlFor = (path: string) => TTL_MAP[path] ?? TTL_DEFAULT;

function cacheGet(key: string) {
  const hit = STATE.cache.get(key);
  if (hit && hit.expires > now()) return hit;
  if (hit) STATE.cache.delete(key);
  return undefined;
}
function cacheSet(key: string, status: number, json: any, ttlMs: number) {
  STATE.cache.set(key, { status, json, expires: now() + ttlMs });
}

export default async function handler(req: any, res: any) {
  try {
    const u = new URL(req.originalUrl || req.url, "http://local");
    const path = (u.searchParams.get("path") || "").trim();

    // --- Endpoint intern: status ratelimit (nu lovește upstream) ---
    if (path === "_rate-status") {
      const left = Math.max(0, Math.ceil((STATE.rateHoldUntil - now()) / 1000));
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          now: now(),
          rateHoldUntil: STATE.rateHoldUntil,
          secondsLeft: left,
        })
      );
      return;
    }

    if (!path || !ALLOWED_PATHS.includes(path)) {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "invalid path" }));
      return;
    }

    // Query string fără "path"
    const qs = new URLSearchParams(u.searchParams as any);
    qs.delete("path");

    // API v3 nu suportă "limit" la /fixtures
    if (path === "/fixtures") qs.delete("limit");

    const upstreamUrl = `${BASE_URL}${path}?${qs.toString()}`;
    const key = `${path}|${qs.toString()}`;

    // În hold după 429? -> servim din cache sau 429 local
    if (now() < STATE.rateHoldUntil) {
      const hit = cacheGet(key);
      if (hit) {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(hit.json));
        return;
      }
      res.statusCode = 429;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: "local rate-limit hold; try later" }));
      return;
    }

    // Cache hit?
    const hit = cacheGet(key);
    if (hit) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(hit.json));
      return;
    }

    // Fetch upstream
    const upstream = await fetch(upstreamUrl, {
      headers: {
        "x-rapidapi-host": RAPID_HOST,
        "x-rapidapi-key": RAPID_KEY,
      },
    });

    const status = upstream.status;
    let json: AnyObj | null = null;
    try {
      json = await upstream.json();
    } catch {
      json = null;
    }

    // 2xx => cache
    if (status >= 200 && status < 300 && json) {
      cacheSet(key, status, json, ttlFor(path));
    }

    // 429 => setăm hold și, dacă avem cache, îl dăm
    if (status === 429) {
      const retryAfter = upstream.headers.get("retry-after");
      const reset = upstream.headers.get("x-ratelimit-requests-reset");
      const fallbackSec = 90; // un pic mai conservator
      const sec =
        (retryAfter && parseInt(retryAfter, 10)) ||
        (reset && parseInt(reset, 10)) ||
        fallbackSec;

      STATE.rateHoldUntil = now() + Math.max(10, sec) * 1000; // min 10s hold

      const cached = cacheGet(key);
      if (cached) {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(cached.json));
        return;
      }
    }

    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(json ?? { ok: status }));
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: e?.message || String(e) }));
  }
}
