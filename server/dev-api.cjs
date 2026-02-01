/**
 * Footy Predictor — Dev API (CommonJS) + SQLite cache + Daily upstream budget (API-Sports / RapidAPI)
 *
 * ✅ No Express (uses built-in http)
 * ✅ Cache schema auto-migrates (safe)
 * ✅ Predict endpoint is "cache-first" (does NOT burn calls unless you ask it to)
 * ✅ Warm endpoint prefetches what Predict needs (fixtures/day + optional standings + optional team stats)
 *
 * Endpoints:
 *  - GET  /api/hello
 *  - GET  /api/env-ok
 *  - GET  /api/cache/stats
 *  - GET  /api/cache/usage
 *  - POST /api/cache/flush        { "prefix": "GET https://..." }  (optional)
 *
 *  - GET  /api/fixtures/day?date=YYYY-MM-DD
 *      -> 1 upstream call/day (then cached), returns leagues present + counts
 *
 *  - GET  /api/warm?date=YYYY-MM-DD&leagueIds=2,39,283&season=2025&standings=1&teamstats=1
 *      -> Prefetch fixtures for the day (per league) + (optional) standings + (optional) team stats (limited)
 *
 *  - GET  /api/predict?date=YYYY-MM-DD&leagueIds=2,39,283&season=2025&limit=20
 *      -> Uses ONLY cache for teamstats/standings. If missing, falls back (synthetic).
 *
 * IMPORTANT (API-Sports):
 *  FOOTBALL_BASE must be: https://v3.football.api-sports.io    (NO /v3 at the end)
 */

const http = require("http");
const { URL } = require("url");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const Database = require("better-sqlite3");

// -------------------- env loading --------------------
function loadEnv() {
  const loaded = [];
  const here = __dirname;
  const candidates = [
    path.join(here, ".env.local"),
    path.join(here, ".env"),
    path.join(here, "..", ".env.local"),
    path.join(here, "..", ".env"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      loaded.push(p);
    }
  }
  dotenv.config(); // fallback (cwd)
  return loaded;
}
const loadedEnvFiles = loadEnv();

// -------------------- config --------------------
const API_PORT = Number(process.env.API_PORT || "8787");
const TIMEZONE = process.env.TIMEZONE || "Europe/Bucharest";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

const FOOTY_AUTH_MODE = String(process.env.FOOTY_AUTH_MODE || "APISPORTS").toUpperCase(); // "RAPIDAPI" | "APISPORTS"
const X_RAPIDAPI_KEY = process.env.X_RAPIDAPI_KEY || "";
const X_RAPIDAPI_HOST = process.env.X_RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com";
const APISPORTS_KEY = process.env.APISPORTS_KEY || "";

// RapidAPI base normally includes /v3
const UPSTREAM_BASE_URL = (process.env.UPSTREAM_BASE_URL || "https://api-football-v1.p.rapidapi.com/v3").replace(/\/$/, "");

// API-Sports base must NOT include /v3
let FOOTBALL_BASE = (process.env.FOOTBALL_BASE || "https://v3.football.api-sports.io").replace(/\/$/, "");
if (FOOTBALL_BASE.endsWith("/v3")) FOOTBALL_BASE = FOOTBALL_BASE.slice(0, -3);

const DAILY_LIMIT = Number(process.env.DAILY_UPSTREAM_LIMIT || "100");
const CACHE_ALLOW_STALE_ON_ERROR = String(process.env.CACHE_ALLOW_STALE_ON_ERROR || "true").toLowerCase() === "true";

const PREDICT_MAX_MATCHES = Number(process.env.PREDICT_MAX_MATCHES || "50");
const PREDICT_TIME_BUDGET_MS = Number(process.env.PREDICT_TIME_BUDGET_MS || "8000");

// Cache TTLs
const TTL_FIXTURES_MS = Number(process.env.TTL_FIXTURES_MS || String(6 * 60 * 60 * 1000));      // 6h
const TTL_FIXTURES_DAY_MS = Number(process.env.TTL_FIXTURES_DAY_MS || String(6 * 60 * 60 * 1000)); // 6h
const TTL_STANDINGS_MS = Number(process.env.TTL_STANDINGS_MS || String(24 * 60 * 60 * 1000));   // 24h
const TTL_TEAMSTATS_MS = Number(process.env.TTL_TEAMSTATS_MS || String(24 * 60 * 60 * 1000));   // 24h

// Warm limits (so you don’t nuke daily budget)
const TEAMSTATS_WARM_LIMIT = Number(process.env.TEAMSTATS_WARM_LIMIT || "10"); // max teams to prefetch per warm call

// -------------------- SQLite cache --------------------
const CACHE_DIR = path.join(__dirname, ".cache");
const CACHE_DB = path.join(CACHE_DIR, "cache.sqlite");
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }

const db = new Database(CACHE_DB);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

function hasTable(name) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}
function cols(name) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${name})`).all();
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}

function ensureSchema() {
  // cache table
  if (!hasTable("cache")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        fetchedAt INTEGER,
        ttlMs INTEGER,
        status INTEGER,
        body TEXT,
        headers TEXT
      );
    `);
  } else {
    const want = ["key", "fetchedAt", "ttlMs", "status", "body", "headers"];
    const have = cols("cache");
    const ok = want.every((c) => have.has(c));
    if (!ok) {
      const old = `cache_old_${Date.now()}`;
      try { db.exec(`ALTER TABLE cache RENAME TO ${old};`); } catch {}
      db.exec(`
        CREATE TABLE IF NOT EXISTS cache (
          key TEXT PRIMARY KEY,
          fetchedAt INTEGER,
          ttlMs INTEGER,
          status INTEGER,
          body TEXT,
          headers TEXT
        );
      `);
      // best-effort migrate
      try {
        const oc = cols(old);
        const keyCol = oc.has("key") ? "key" : (oc.has("k") ? "k" : null);
        const bodyCol = oc.has("body") ? "body" : (oc.has("value") ? "value" : (oc.has("json") ? "json" : null));
        const fetchedCol = oc.has("fetchedAt") ? "fetchedAt" : (oc.has("ts") ? "ts" : null);
        if (keyCol && bodyCol) {
          const sel = [
            `${keyCol} AS key`,
            fetchedCol ? `${fetchedCol} AS fetchedAt` : `NULL AS fetchedAt`,
            `NULL AS ttlMs`,
            `NULL AS status`,
            `${bodyCol} AS body`,
            `NULL AS headers`,
          ].join(", ");
          db.exec(`INSERT OR REPLACE INTO cache (key,fetchedAt,ttlMs,status,body,headers) SELECT ${sel} FROM ${old};`);
        }
      } catch {}
    }
  }

  // daily usage table
  if (!hasTable("usageDaily")) {
    db.exec(`CREATE TABLE IF NOT EXISTS usageDaily (date TEXT PRIMARY KEY, count INTEGER);`);
  } else {
    const have = cols("usageDaily");
    const ok = have.has("date") && have.has("count");
    if (!ok) {
      const old = `usageDaily_old_${Date.now()}`;
      try { db.exec(`ALTER TABLE usageDaily RENAME TO ${old};`); } catch {}
      db.exec(`CREATE TABLE IF NOT EXISTS usageDaily (date TEXT PRIMARY KEY, count INTEGER);`);
      try {
        const oc = cols(old);
        const ccol = oc.has("count") ? "count" : (oc.has("calls") ? "calls" : null);
        if (oc.has("date") && ccol) {
          db.exec(`INSERT OR REPLACE INTO usageDaily (date,count) SELECT date,${ccol} FROM ${old};`);
        }
      } catch {}
    }
  }
}
ensureSchema();

// prepared statements
const stmtGetCache = db.prepare("SELECT status,headers,body,fetchedAt,ttlMs FROM cache WHERE key=?");
const stmtSetCache = db.prepare("INSERT OR REPLACE INTO cache (key,fetchedAt,ttlMs,status,body,headers) VALUES (?,?,?,?,?,?)");
const stmtCountCache = db.prepare("SELECT COUNT(1) as count, MIN(fetchedAt) as minFetchedAt, MAX(fetchedAt) as maxFetchedAt FROM cache");
const stmtGetUsage = db.prepare("SELECT count FROM usageDaily WHERE date=?");
const stmtSetUsage = db.prepare("INSERT OR REPLACE INTO usageDaily (date,count) VALUES (?,?)");

// -------------------- helpers --------------------
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
function cacheKeyFor(url) { return `GET ${url}`; }
function derivedKey(name) { return `DERIVED ${name}`; }
function isFresh(entry) {
  const now = Date.now();
  const ttl = Number(entry.ttlMs) || 0;
  if (!entry.fetchedAt) return false;
  return now - entry.fetchedAt <= ttl;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function parseLeagueIds(s) {
  if (!s) return [];
  return String(s).split(",").map((x) => x.trim()).filter(Boolean).map(Number).filter((n) => Number.isFinite(n) && n > 0);
}

// daily usage
function getDailyUsage() {
  const date = todayISO();
  const row = stmtGetUsage.get(date);
  const count = row?.count ?? 0;
  return { date, count, limit: DAILY_LIMIT };
}
function bumpDailyUsage(by = 1) {
  const u = getDailyUsage();
  const next = u.count + by;
  stmtSetUsage.run(u.date, next);
  return { date: u.date, count: next, limit: u.limit };
}
function canSpend(n = 1) {
  const u = getDailyUsage();
  return u.count + n <= u.limit;
}

// -------------------- HTTP utils --------------------
function send(res, code, obj, extraHeaders = {}) {
  const body = typeof obj === "string" ? obj : JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": typeof obj === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

function withCors(req, res) {
  res.setHeader("access-control-allow-origin", CORS_ORIGIN);
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, x-cron-token");
  res.setHeader("access-control-max-age", "600");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

// -------------------- Upstream client (API-Sports / RapidAPI) --------------------
function makeUpstreamHeaders() {
  if (FOOTY_AUTH_MODE === "APISPORTS") {
    if (!APISPORTS_KEY) return null;
    return { "x-apisports-key": APISPORTS_KEY };
  }
  if (!X_RAPIDAPI_KEY) return null;
  return { "x-rapidapi-key": X_RAPIDAPI_KEY, "x-rapidapi-host": X_RAPIDAPI_HOST };
}

function upstreamBase() {
  return FOOTY_AUTH_MODE === "APISPORTS" ? FOOTBALL_BASE : UPSTREAM_BASE_URL;
}

// normalize endpoint path so we NEVER hit ".../v3/v3/..."
function normalizeEndpointPath(p) {
  let s = String(p || "");
  if (!s.startsWith("/")) s = "/" + s;
  // if someone passes "/v3/fixtures" -> "/fixtures"
  if (s.startsWith("/v3/")) s = s.slice(3);
  return s;
}

// "cache-first fetch": returns cached fresh, otherwise hits upstream (if budget allows)
async function fetchUpstreamJson(endpointPath, paramsObj, { ttlMs, tag }) {
  const base = upstreamBase().replace(/\/$/, "");
  const ep = normalizeEndpointPath(endpointPath);
  const u = new URL(base + ep);

  Object.entries(paramsObj || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    u.searchParams.set(k, String(v));
  });

  const fullUrl = u.toString();
  const key = cacheKeyFor(fullUrl);

  const cached = stmtGetCache.get(key);
  if (cached && isFresh(cached)) {
    return { ok: true, fromCache: true, stale: false, url: fullUrl, status: cached.status || 200, data: safeJsonParse(cached.body, null) };
  }

  const headers = makeUpstreamHeaders();
  if (!headers) {
    return { ok: false, fromCache: false, url: fullUrl, status: 401, error: `Missing auth for mode ${FOOTY_AUTH_MODE}` };
  }

  if (!canSpend(1)) {
    if (cached && CACHE_ALLOW_STALE_ON_ERROR) {
      return { ok: true, fromCache: true, stale: true, url: fullUrl, status: cached.status || 200, data: safeJsonParse(cached.body, null), _debug: { budgetBlocked: true, tag } };
    }
    return { ok: false, fromCache: false, url: fullUrl, status: 429, error: "Daily upstream budget exceeded" };
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Number(process.env.UPSTREAM_TIMEOUT_MS || "8000"));

  try {
    const r = await fetch(fullUrl, { method: "GET", headers, signal: controller.signal });
    bumpDailyUsage(1);

    const text = await r.text();
    const hdrsObj = {};
    r.headers.forEach((v, k) => (hdrsObj[k] = v));

    stmtSetCache.run(key, Date.now(), ttlMs || 0, r.status, text || "", JSON.stringify(hdrsObj));

    const json = safeJsonParse(text, null);

    // API-Sports sometimes returns HTTP 200 with errors in body
    const apiErrors = json?.errors;
    const hasApiErrors = apiErrors && Object.keys(apiErrors).length > 0;

    if (!r.ok || hasApiErrors) {
      if (cached && CACHE_ALLOW_STALE_ON_ERROR) {
        return { ok: true, fromCache: true, stale: true, url: fullUrl, status: cached.status || r.status, data: safeJsonParse(cached.body, null), _debug: { upstreamStatus: r.status, tag, apiErrors } };
      }
      return { ok: false, fromCache: false, url: fullUrl, status: r.status || 500, error: `API-Sports errors: ${JSON.stringify(apiErrors || {})}`, payload: json || null };
    }

    return { ok: true, fromCache: false, stale: false, url: fullUrl, status: r.status, data: json };
  } catch (e) {
    if (cached && CACHE_ALLOW_STALE_ON_ERROR) {
      return { ok: true, fromCache: true, stale: true, url: fullUrl, status: cached.status || 200, data: safeJsonParse(cached.body, null), _debug: { fetchError: String(e), tag } };
    }
    return { ok: false, fromCache: false, url: fullUrl, status: 599, error: `Fetch failed: ${String(e)}` };
  } finally {
    clearTimeout(t);
  }
}

// -------------------- Fixtures Day (1 call/day) --------------------
async function getFixturesDay(date) {
  const key = derivedKey(`fixtures-day:${date}`);

  const cached = stmtGetCache.get(key);
  if (cached && isFresh(cached)) {
    return { ok: true, fromCache: true, stale: false, data: safeJsonParse(cached.body, { response: [] }) };
  }

  // Use upstream /fixtures?date=...
  const r = await fetchUpstreamJson("/fixtures", { date }, { ttlMs: TTL_FIXTURES_DAY_MS, tag: "fixtures-day" });
  if (!r.ok) return r;

  const payload = r.data || {};
  stmtSetCache.run(key, Date.now(), TTL_FIXTURES_DAY_MS, 200, JSON.stringify(payload), null);
  return { ok: true, fromCache: r.fromCache, stale: r.stale || false, data: payload };
}

function summarizeLeaguesFromFixtures(payloadOrArray) {
  const fixtures = normalizeFixtures(payloadOrArray);
  const byLeague = new Map();

  for (const fx of fixtures) {
    const league = fx?.league;
    const leagueId = Number(league?.id || 0);
    if (!leagueId) continue;

    const country = league?.country || "International";
    const name = league?.name || `League ${leagueId}`;
    const logo = league?.logo || null;

    const key = String(leagueId);
    const cur = byLeague.get(key) || { id: leagueId, name, country, logo, matches: 0 };
    cur.matches += 1;

    // Keep best-known metadata
    cur.name = cur.name || name;
    cur.country = cur.country || country;
    cur.logo = cur.logo || logo;

    byLeague.set(key, cur);
  }

  const leagues = Array.from(byLeague.values()).sort((a, b) => b.matches - a.matches);
  return { totalFixtures: fixtures.length, leagues };
}

// -------------------- Per-league fixtures (cache-only) --------------------
function normalizeFixtures(payload) {
  // Accept either raw API-Sports payload ({response:[...]}) or a direct array of fixtures
  const resp = Array.isArray(payload)
    ? payload
    : (payload?.response || payload?.data?.response || payload?.fixtures || []);
  return resp.map((x) => ({
    fixture: x.fixture,
    league: x.league,
    teams: x.teams,
    goals: x.goals,
    score: x.score,
  }));
}

async function getFixturesForLeagueDate_cacheOnly({ leagueId, date }) {
  // First: try derived cache
  const key = derivedKey(`fixtures:${date}:${leagueId}`);
  const cached = stmtGetCache.get(key);
  if (cached && isFresh(cached)) {
    return { ok: true, fromCache: true, stale: false, status: 200, data: safeJsonParse(cached.body, { response: [] }) };
  }

  // If not derived: try fixtures-day cache (already warmed) and filter
  const dayKey = derivedKey(`fixtures-day:${date}`);
  const dayCached = stmtGetCache.get(dayKey);
  if (dayCached && isFresh(dayCached)) {
    const dayPayload = safeJsonParse(dayCached.body, { response: [] });
    const all = Array.isArray(dayPayload.response) ? dayPayload.response : [];
    const filtered = all.filter((f) => (f?.league?.id ?? null) === leagueId);
    const out = { ...dayPayload, response: filtered, _filteredLeagueId: leagueId };
    stmtSetCache.run(key, Date.now(), TTL_FIXTURES_MS, 200, JSON.stringify(out), null);
    return { ok: true, fromCache: true, stale: false, status: 200, data: out };
  }

  // Not in cache -> tell caller to warm first (don’t burn calls here)
  return { ok: false, status: 428, error: "Fixtures not in cache. Run /api/warm first (or call /api/fixtures/day)." };
}

// -------------------- Standings (cache-only by default) --------------------
async function getStandings_cacheOnly({ leagueId, season }) {
  const base = upstreamBase().replace(/\/$/, "");
  const ep = normalizeEndpointPath("/standings");
  const u = new URL(base + ep);
  u.searchParams.set("league", String(leagueId));
  u.searchParams.set("season", String(season));
  const key = cacheKeyFor(u.toString());

  const cached = stmtGetCache.get(key);
  if (cached && isFresh(cached)) {
    return { ok: true, fromCache: true, stale: false, status: cached.status || 200, data: safeJsonParse(cached.body, null) };
  }
  return { ok: false, status: 428, error: "Standings not in cache (warm with &standings=1)." };
}

async function getStandings_fetch({ leagueId, season }) {
  return fetchUpstreamJson("/standings", { league: leagueId, season }, { ttlMs: TTL_STANDINGS_MS, tag: "standings" });
}

// -------------------- Team statistics (cache-only by default) --------------------
function teamStatsKey({ leagueId, season, teamId }) {
  const base = upstreamBase().replace(/\/$/, "");
  const ep = normalizeEndpointPath("/teams/statistics");
  const u = new URL(base + ep);
  u.searchParams.set("league", String(leagueId));
  u.searchParams.set("season", String(season));
  u.searchParams.set("team", String(teamId));
  return cacheKeyFor(u.toString());
}

async function getTeamStats_cacheOnly({ leagueId, season, teamId }) {
  const key = teamStatsKey({ leagueId, season, teamId });
  const cached = stmtGetCache.get(key);
  if (cached && isFresh(cached)) {
    return { ok: true, fromCache: true, stale: false, status: cached.status || 200, data: safeJsonParse(cached.body, null) };
  }
  return { ok: false, status: 428, error: "Team stats not in cache (warm with &teamstats=1)." };
}

async function getTeamStats_fetch({ leagueId, season, teamId }) {
  return fetchUpstreamJson("/teams/statistics", { league: leagueId, season, team: teamId }, { ttlMs: TTL_TEAMSTATS_MS, tag: "teamstats" });
}

function extractGoalsAverages(teamStatsPayload) {
  // API-Sports response shape: { response: { goals: { for: { average: { total, home, away } }, against: { average: ... } } } }
  const r = teamStatsPayload?.response || null;
  if (!r) return null;

  const gf = r?.goals?.for?.average || {};
  const ga = r?.goals?.against?.average || {};

  const toNum = (x, d = null) => {
    if (x === null || x === undefined) return d;
    const n = Number(String(x).replace(",", "."));
    return Number.isFinite(n) ? n : d;
  };

  const gfTotal = toNum(gf.total, null);
  const gaTotal = toNum(ga.total, null);
  const gfHome = toNum(gf.home, gfTotal);
  const gaHome = toNum(ga.home, gaTotal);
  const gfAway = toNum(gf.away, gfTotal);
  const gaAway = toNum(ga.away, gaTotal);

  if (gfTotal === null || gaTotal === null) return null;

  return {
    gfTotal, gaTotal,
    gfHome: gfHome ?? gfTotal,
    gaHome: gaHome ?? gaTotal,
    gfAway: gfAway ?? gfTotal,
    gaAway: gaAway ?? gaTotal,
  };
}

// -------------------- Simple Poisson model --------------------
function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function poissonP(k, lambda) { return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k); }
function clampLambda(x) { return clamp(x, 0.2, 3.5); }

function computeMatchProbs(lambdaHome, lambdaAway) {
  const maxG = 4;
  const grid = [];
  let sum = 0;

  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      const p = poissonP(h, lambdaHome) * poissonP(a, lambdaAway);
      grid.push({ h, a, p });
      sum += p;
    }
  }
  for (const g of grid) g.p /= sum;

  let p1 = 0, pX = 0, p2 = 0;
  let pGG = 0, pO25 = 0, pU35 = 0, pO15 = 0;

  let best = grid[0];
  for (const g of grid) {
    if (g.h > g.a) p1 += g.p;
    else if (g.h === g.a) pX += g.p;
    else p2 += g.p;

    if (g.h >= 1 && g.a >= 1) pGG += g.p;
    if (g.h + g.a >= 3) pO25 += g.p;
    if (g.h + g.a <= 3) pU35 += g.p;
    if (g.h + g.a >= 2) pO15 += g.p;

    if (g.p > best.p) best = g;
  }

  const oneXtwo = p1 >= pX && p1 >= p2 ? "1" : pX >= p1 && pX >= p2 ? "X" : "2";
  const gg = pGG >= 0.5 ? "GG" : "NGG";
  const over25 = pO25 >= 0.5 ? "Peste 2.5" : "Sub 2.5";
  const correctScore = `${best.h}:${best.a}`;

  const p12 = 1 - pX;
  const p1X = 1 - p2;
  const pX2 = 1 - p1;

  // recommended = best among (U3.5, O1.5, 1X2)
  const rec = [
    { pick: "Sub 3.5", p: pU35 },
    { pick: "Peste 1.5", p: pO15 },
    { pick: oneXtwo, p: Math.max(p1, pX, p2) },
    { pick: "12", p: p12 },
    { pick: "1X", p: p1X },
    { pick: "X2", p: pX2 },
  ].sort((a, b) => b.p - a.p)[0];

  return {
    lambdas: { home: Number(lambdaHome.toFixed(2)), away: Number(lambdaAway.toFixed(2)) },
    probs: {
      p1: Math.round(p1 * 100),
      pX: Math.round(pX * 100),
      p2: Math.round(p2 * 100),
      pGG: Math.round(pGG * 100),
      pO25: Math.round(pO25 * 100),
      pU35: Math.round(pU35 * 100),
      pO15: Math.round(pO15 * 100),
      p12: Math.round(p12 * 100),
      p1X: Math.round(p1X * 100),
      pX2: Math.round(pX2 * 100),
    },
    predictions: { oneXtwo, gg, over25, correctScore },
    recommended: { pick: rec.pick, confidence: Math.round(rec.p * 100) },
  };
}

// Build lambdas from teamstats (varies per team)
function lambdasFromTeamStats(homeStats, awayStats) {
  // home uses gfHome & gaHome; away uses gfAway & gaAway
  const homeAttack = homeStats.gfHome;
  const homeDef = homeStats.gaHome;
  const awayAttack = awayStats.gfAway;
  const awayDef = awayStats.gaAway;

  // Simple blend: expected goals = average( own attack , opponent conceded ) + small home advantage
  const homeAdv = 1.08;
  const awayAdv = 0.92;

  const lambdaHome = clampLambda(((homeAttack + awayDef) / 2) * homeAdv);
  const lambdaAway = clampLambda(((awayAttack + homeDef) / 2) * awayAdv);

  return { lambdaHome, lambdaAway };
}

// Fallback lambdas if no data
function syntheticLambdas(teamHomeId, teamAwayId) {
  // Deterministic pseudo-random per matchup to avoid identical predictions.
  // (No upstream calls, but not "truth".)
  const seed = (Number(teamHomeId || 0) * 73856093) ^ (Number(teamAwayId || 0) * 19349663);
  const r1 = ((seed >>> 0) % 1000) / 1000; // 0..0.999
  const r2 = (((seed >>> 0) * 48271) % 1000) / 1000;
  const lambdaHome = clampLambda(1.05 + r1 * 1.2);
  const lambdaAway = clampLambda(0.85 + r2 * 1.1);
  return { lambdaHome, lambdaAway };
}

// -------------------- Handlers --------------------
async function handleHello(_req, res) {
  return send(res, 200, { ok: true, route: "/api/hello" });
}

async function handleEnvOk(_req, res) {
  const u = getDailyUsage();
  const c = stmtCountCache.get();
  return send(res, 200, {
    ok: true,
    mode: FOOTY_AUTH_MODE,
    loadedEnvFiles,
    present: {
      API_PORT,
      TIMEZONE,
      CORS_ORIGIN,
      FOOTY_AUTH_MODE,
      APISPORTS_KEY: Boolean(APISPORTS_KEY),
      X_RAPIDAPI_KEY: Boolean(X_RAPIDAPI_KEY),
      X_RAPIDAPI_HOST,
      FOOTBALL_BASE,
      UPSTREAM_BASE_URL,
      cache: { kind: "sqlite", file: CACHE_DB, count: c.count, minFetchedAt: c.minFetchedAt ?? null, maxFetchedAt: c.maxFetchedAt ?? null },
      cacheAllowStaleOnError: CACHE_ALLOW_STALE_ON_ERROR,
      dailyUpstreamCalls: u,
      limits: { PREDICT_TIME_BUDGET_MS, PREDICT_MAX_MATCHES },
      teamStats: { warmLimit: TEAMSTATS_WARM_LIMIT, ttlMs: TTL_TEAMSTATS_MS },
    },
    note: "OK. Predict e cache-first; folosește /fixtures/day + /warm ca să nu arzi calls.",
  });
}

async function handleCacheStats(_req, res) {
  const c = stmtCountCache.get();
  return send(res, 200, {
    ok: true,
    cache: { kind: "sqlite", file: CACHE_DB, count: c.count, minFetchedAt: c.minFetchedAt ?? null, maxFetchedAt: c.maxFetchedAt ?? null },
    allowStaleOnError: CACHE_ALLOW_STALE_ON_ERROR,
  });
}

async function handleCacheUsage(_req, res) {
  return send(res, 200, { ok: true, usage: getDailyUsage() });
}

async function handleCacheFlush(req, res) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const j = safeJsonParse(body, {});
    const prefix = j.prefix ? String(j.prefix) : "";
    if (prefix) {
      db.prepare(`DELETE FROM cache WHERE key LIKE ?`).run(`%${prefix}%`);
      return send(res, 200, { ok: true, flushed: prefix });
    }
    db.prepare(`DELETE FROM cache`).run();
    return send(res, 200, { ok: true, flushed: "ALL" });
  });
}

async function handleFixturesDay(reqUrl, res) {
  const date = reqUrl.searchParams.get("date") || todayISO();

  const r = await getFixturesDay(date);
  if (!r.ok) {
    return send(res, r.status || 500, { ok: false, error: r.error, mode: FOOTY_AUTH_MODE, _debug: { url: r.url || null } });
  }

  const fixtures = normalizeFixtures(r.data);
  const sum = summarizeLeaguesFromFixtures(fixtures);
  return send(res, 200, {
    ok: true,
    date,
    totalFixtures: sum.totalFixtures,
    leagues: sum.leagues,
    usage: getDailyUsage(),
    _debug: { fromCache: r.fromCache, stale: r.stale || false },
  });
}

async function handleWarm(reqUrl, res) {
  const date = reqUrl.searchParams.get("date") || todayISO();
  const leagueIds = parseLeagueIds(reqUrl.searchParams.get("leagueIds"));
  const season = Number(reqUrl.searchParams.get("season") || new Date(date).getFullYear());
  const wantStandings = reqUrl.searchParams.get("standings") === "1";
  const wantTeamStats = reqUrl.searchParams.get("teamstats") === "1";

  if (leagueIds.length === 0) return send(res, 400, { ok: false, error: "Missing leagueIds" });

  // 1) Ensure fixtures/day exists (1 call/day max)
  const day = await getFixturesDay(date);
  if (!day.ok) return send(res, day.status || 500, { ok: false, error: day.error, mode: FOOTY_AUTH_MODE, _debug: { url: day.url || null } });

  const warmed = [];
  const errors = [];
  let teamStatsPrefetched = 0;

  for (const leagueId of leagueIds) {
    // derived fixtures per league
    const fx = await getFixturesForLeagueDate_cacheOnly({ leagueId, date });
    if (!fx.ok) {
      errors.push({ leagueId, where: "fixtures", status: fx.status, error: fx.error });
      continue;
    }
    const fixtures = normalizeFixtures(fx.data);
    const summary = { leagueId, season, date, fixtures: fixtures.length };

    // standings (optional fetch)
    if (wantStandings) {
      const st = await getStandings_fetch({ leagueId, season });
      if (!st.ok) errors.push({ leagueId, where: "standings", status: st.status, error: st.error });
      else summary.standings = st.fromCache ? "cached" : "fetched";
    } else {
      summary.standings = "skipped";
    }

    // team stats (optional prefetch, limited)
    if (wantTeamStats) {
      const teamIds = [];
      for (const it of fixtures) {
        const h = it?.teams?.home?.id;
        const a = it?.teams?.away?.id;
        if (h) teamIds.push(h);
        if (a) teamIds.push(a);
      }
      const uniq = Array.from(new Set(teamIds)).slice(0, TEAMSTATS_WARM_LIMIT);

      for (const teamId of uniq) {
        const key = teamStatsKey({ leagueId, season, teamId });
        const cached = stmtGetCache.get(key);
        if (cached && isFresh(cached)) continue; // already cached
        const ts = await getTeamStats_fetch({ leagueId, season, teamId });
        if (!ts.ok) {
          errors.push({ leagueId, where: "teamstats", teamId, status: ts.status, error: ts.error });
          continue;
        }
        teamStatsPrefetched += 1;
      }
    }

    warmed.push(summary);
  }

  const c = stmtCountCache.get();
  return send(res, 200, {
    ok: errors.length === 0,
    warmed,
    teamStatsPrefetched,
    errors,
    usage: getDailyUsage(),
    cache: { kind: "sqlite", file: CACHE_DB, count: c.count, minFetchedAt: c.minFetchedAt ?? null, maxFetchedAt: c.maxFetchedAt ?? null },
    note: "Warm: /fixtures/day = 1 call/zi. Optional: &standings=1 și/sau &teamstats=1 (limită mică).",
  });
}

async function handlePredict(reqUrl, res) {
  const tStart = Date.now();
  const date = reqUrl.searchParams.get("date") || todayISO();
  const leagueIds = parseLeagueIds(reqUrl.searchParams.get("leagueIds"));
  const season = Number(reqUrl.searchParams.get("season") || new Date(date).getFullYear());
  const limit = clamp(Number(reqUrl.searchParams.get("limit") || "20"), 1, PREDICT_MAX_MATCHES);

  if (leagueIds.length === 0) return send(res, 400, { ok: false, error: "Missing leagueIds" });

  const out = [];
  const debug = { needsWarm: false, usedCacheOnly: true };

  for (const leagueId of leagueIds) {
    if (Date.now() - tStart > PREDICT_TIME_BUDGET_MS) break;
    if (out.length >= limit) break;

    const fixturesR = await getFixturesForLeagueDate_cacheOnly({ leagueId, date });
    if (!fixturesR.ok) {
      debug.needsWarm = true;
      continue;
    }

    const fixtures = normalizeFixtures(fixturesR.data);
    if (fixtures.length === 0) continue;

    // standings cache (optional)
    const standingsR = await getStandings_cacheOnly({ leagueId, season });
    const standingsMissing = !standingsR.ok;
    const standings = standingsR.ok ? standingsR.data : null;
    const standingsRows = standings?.response?.[0]?.league?.standings?.[0] || [];

    // standings map by teamId
    const standingsMap = new Map();
    for (const r of standingsRows) {
      const id = r?.team?.id;
      if (id) standingsMap.set(id, r);
    }

    for (const it of fixtures) {
      if (out.length >= limit) break;

      const fx = it.fixture;
      const lg = it.league;
      const th = it.teams?.home;
      const ta = it.teams?.away;

      const homeId = th?.id;
      const awayId = ta?.id;

      let method = "synthetic";
      let teamStatsHomeOk = false;
      let teamStatsAwayOk = false;

      let lambdaHome, lambdaAway;

      const tsH = homeId ? await getTeamStats_cacheOnly({ leagueId, season, teamId: homeId }) : null;
      const tsA = awayId ? await getTeamStats_cacheOnly({ leagueId, season, teamId: awayId }) : null;

      if (tsH?.ok && tsA?.ok) {
        const hStats = extractGoalsAverages(tsH.data);
        const aStats = extractGoalsAverages(tsA.data);
        if (hStats && aStats) {
          teamStatsHomeOk = true;
          teamStatsAwayOk = true;
          method = "teamstats";
          const l = lambdasFromTeamStats(hStats, aStats);
          lambdaHome = l.lambdaHome;
          lambdaAway = l.lambdaAway;
        }
      }

      // Standings fallback (if teamstats missing)
      if ((lambdaHome === undefined || lambdaAway === undefined) && !standingsMissing && homeId && awayId) {
        const rowHome = standingsMap.get(homeId);
        const rowAway = standingsMap.get(awayId);

        if (rowHome && rowAway) {
          method = "standings";
          const playedH = rowHome?.all?.played || 0;
          const gfH = rowHome?.all?.goals?.for || 0;
          const gaH = rowHome?.all?.goals?.against || 0;

          const playedA = rowAway?.all?.played || 0;
          const gfA = rowAway?.all?.goals?.for || 0;
          const gaA = rowAway?.all?.goals?.against || 0;

          const gfHome = playedH > 0 ? gfH / playedH : 1.2;
          const gaHome = playedH > 0 ? gaH / playedH : 1.2;

          const gfAway = playedA > 0 ? gfA / playedA : 1.2;
          const gaAway = playedA > 0 ? gaA / playedA : 1.2;

          const homeAdv = 1.06;
          const awayAdv = 0.94;

          lambdaHome = clampLambda(((gfHome + gaAway) / 2) * homeAdv);
          lambdaAway = clampLambda(((gfAway + gaHome) / 2) * awayAdv);
        }
      }

      // Synthetic fallback (always varies per match)
      if (lambdaHome === undefined || lambdaAway === undefined) {
        const s = syntheticLambdas(homeId, awayId);
        lambdaHome = s.lambdaHome;
        lambdaAway = s.lambdaAway;
      }

      const calc = computeMatchProbs(lambdaHome, lambdaAway);

      out.push({
        id: fx?.id,
        leagueId: lg?.id,
        league: lg?.name,
        logos: { league: lg?.logo, home: th?.logo, away: ta?.logo },
        teams: { home: th?.name, away: ta?.name },
        kickoff: fx?.date,
        status: fx?.status?.short,
        referee: fx?.referee ?? null,
        goals: { home: it.goals?.home ?? null, away: it.goals?.away ?? null },

        lambdas: calc.lambdas,
        probs: calc.probs,
        predictions: calc.predictions,
        recommended: calc.recommended,

        _debug: {
          method,
          fixturesFromCache: true,
          standingsMissing,
          teamStatsHomeOk,
          teamStatsAwayOk,
          seasonUsed: season,
          leagueIdUsed: leagueId,
        },
      });
    }
  }

  return send(res, 200, out, {
    "x-footy-usage": JSON.stringify(getDailyUsage()),
    "x-footy-needs-warm": String(debug.needsWarm),
    "x-footy-cache-only": String(debug.usedCacheOnly),
  });
}

// -------------------- Router --------------------
const server = http.createServer(async (req, res) => {
  try {
    if (withCors(req, res)) return;

    const reqUrl = new URL(req.url, `http://localhost:${API_PORT}`);
    const p = reqUrl.pathname;

    if (p === "/api/hello") return handleHello(req, res);
    if (p === "/api/env-ok") return handleEnvOk(req, res);

    if (p === "/api/cache/stats") return handleCacheStats(req, res);
    if (p === "/api/cache/usage") return handleCacheUsage(req, res);
    if (p === "/api/cache/flush" && req.method === "POST") return handleCacheFlush(req, res);

    if (p === "/api/fixtures/day") return handleFixturesDay(reqUrl, res);
    if (p === "/api/warm") return handleWarm(reqUrl, res);
    if (p === "/api/predict") return handlePredict(reqUrl, res);

    return send(res, 404, "Not found");
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e) });
  }
});

server.listen(API_PORT, () => {
  console.log(`[dev-api] listening on http://localhost:${API_PORT}  (mode=${FOOTY_AUTH_MODE})`);
  console.log(`[dev-api] cache: ${CACHE_DB}`);
  if (FOOTY_AUTH_MODE === "APISPORTS") {
    console.log(`[dev-api] FOOTBALL_BASE: ${FOOTBALL_BASE}`);
  }
});
