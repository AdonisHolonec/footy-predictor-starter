// src/App.tsx
import React, { useEffect, useState } from "react";
import PredictionCard from "./components/PredictionCard";
import Spinner from "./components/Spinner";
import { apiFetch } from "./lib/api";
import StatsBoard, { AdviceRow, PeriodMode } from "./components/StatsBoard";
import type { PairMarket } from "./components/MarketPair";
import type { TripleItem } from "./components/MarketTriple";
import type { ScoreChip } from "./components/ScoreChips";

/* =========================
   API types
========================= */
type FixtureApi = {
  response: Array<{
    fixture: { id: number; date?: string; status?: { short?: string } };
    teams: { home: { name: string; logo?: string }; away: { name: string; logo?: string } };
    goals?: { home?: number | null; away?: number | null };
    score?: { halftime?: { home?: number | null; away?: number | null } };
  }>;
};
type PredictionStruct = {
  advice?: string;
  percent?: { home?: string; draw?: string; away?: string };
};
type PredictionApi = { response: Array<{ fixture: { id: number }; predictions?: PredictionStruct }> };
type OddsApi = {
  response: Array<{
    bookmaker?: { name?: string };
    bookmakers?: Array<{
      name?: string;
      bets?: Array<{ name?: string; values?: Array<{ value?: string; odd?: string }> }>;
    }>;
    bets?: Array<{ name?: string; values?: Array<{ value?: string; odd?: string }> }>;
  }>;
};

/* =========================
   Utils odds/prob
========================= */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toNum = (x?: string | number | null) => {
  const n = typeof x === "number" ? x : parseFloat((x ?? "").toString().replace(",", "."));
  return isFinite(n) && n > 0 ? n : undefined;
};
const impliedPair = (a?: string, b?: string) => {
  const na = toNum(a), nb = toNum(b);
  if (!na || !nb) return {};
  const ia = 1 / na, ib = 1 / nb, s = ia + ib;
  return { a: (ia / s) * 100, b: (ib / s) * 100 };
};
const implied3 = (h?: string, d?: string, a?: string) => {
  const H = toNum(h), D = toNum(d), A = toNum(a);
  if (!H || !D || !A) return {};
  const ih = 1 / H, id = 1 / D, ia = 1 / A, s = ih + id + ia;
  return { home: (ih / s) * 100, draw: (id / s) * 100, away: (ia / s) * 100 };
};
const pctFromString = (s?: string) => {
  if (!s) return undefined;
  const n = parseFloat(s.replace("%", "").replace(",", "."));
  return isFinite(n) ? n : undefined;
};
function derive1x2Probs(
  oneX2?: { home?: string; draw?: string; away?: string },
  apiPercent?: { home?: string; draw?: string; away?: string }
): { home?: number; draw?: number; away?: number } | null {
  const fromOdds = implied3(oneX2?.home, oneX2?.draw, oneX2?.away) as any;
  const ok = fromOdds.home && fromOdds.draw && fromOdds.away;
  if (ok) return fromOdds;
  const ph = pctFromString(apiPercent?.home);
  const px = pctFromString(apiPercent?.draw);
  const pa = pctFromString(apiPercent?.away);
  if (ph == null || px == null || pa == null) return null;
  const s = ph + px + pa || 1;
  return { home: (ph / s) * 100, draw: (px / s) * 100, away: (pa / s) * 100 };
}
const fmt2 = (x?: number) => (x == null ? undefined : (Math.round(x * 100) / 100).toFixed(2));

/* =========================
   Date helpers (UTC-safe)
========================= */
const isoToday = (): string => {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const shiftDateISO = (iso: string, deltaDays: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

/* =========================
   LocalStorage cache odds/pred
========================= */
type Stored<T> = { data: T; expires: number; savedAt: number };
const ls = {
  get<T>(key: string): T | undefined {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const obj = JSON.parse(raw) as Stored<T>;
      if (!obj.expires || obj.expires <= Date.now()) {
        localStorage.removeItem(key);
        return;
      }
      return obj.data;
    } catch {}
    return;
  },
  getMeta<T>(key: string): { data: T; savedAt?: number } | undefined {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const obj = JSON.parse(raw) as Stored<T>;
      if (!obj.expires || obj.expires <= Date.now()) {
        localStorage.removeItem(key);
        return;
      }
      return { data: obj.data, savedAt: obj.savedAt };
    } catch {}
    return;
  },
  set<T>(key: string, data: T, ttlMs: number) {
    try {
      const payload: Stored<T> = { data, expires: Date.now() + ttlMs, savedAt: Date.now() };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {}
  },
};
const LTTL_PRED = 24 * 60 * 60 * 1000;
const LTTL_ODDS = 60 * 60 * 1000;

/* predictions cache + fetch */
const predCache = new Map<number, PredictionStruct | undefined>();
async function fetchPrediction(fid: number): Promise<{ data?: PredictionStruct; cachedAt?: number }> {
  const k = `pred:${fid}`;
  const m = ls.getMeta<PredictionStruct | undefined>(k);
  if (m) return { data: m.data, cachedAt: m.savedAt };
  try {
    if (predCache.has(fid)) return { data: predCache.get(fid) };
    const p = await apiFetch<PredictionApi>("/predictions", { fixture: fid });
    const pred = p?.response?.[0]?.predictions;
    predCache.set(fid, pred);
    ls.set(k, pred, LTTL_PRED);
    return { data: pred };
  } catch {
    const fb = ls.getMeta<PredictionStruct | undefined>(k);
    if (fb) return { data: fb.data, cachedAt: fb.savedAt };
    throw new Error("fetchPrediction failed");
  }
}

/* =========================
   Advice history + evaluator
========================= */
const HIST_KEY = "fp_advice_history";
function loadHistory(): AdviceRow[] { try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch { return []; } }
function saveHistory(a: AdviceRow[]) { try { localStorage.setItem(HIST_KEY, JSON.stringify(a)); } catch {} }

const norm = (s?: string) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function winnerFromScore(gh?: number | null, ga?: number | null) {
  if (gh == null || ga == null) return undefined;
  if (gh > ga) return "home";
  if (ga > gh) return "away";
  return "draw";
}
function outcomeFromAdvice(
  advice: string | undefined,
  home: string, away: string,
  gh?: number | null, ga?: number | null
): "win" | "lose" | "pending" {
  const w = winnerFromScore(gh, ga);
  if (!advice || !w) return "pending";
  const a = norm(advice), h = norm(home), aw = norm(away);

  // scurt 1X / 12 / X2
  const mShort = a.match(/(double\s*chance|sansa\s*dubla)\s*:\s*(1x|12|x2)\b/i);
  if (mShort) {
    const tag = mShort[2].toLowerCase();
    if (tag === "1x") return w === "home" || w === "draw" ? "win" : "lose";
    if (tag === "12") return w === "home" || w === "away" ? "win" : "lose";
    if (tag === "x2") return w === "draw" || w === "away" ? "win" : "lose";
  }

  // lung: cu „or” sau „/”, nume echipă ori 1/2/x
  const mLong = a.match(/(double\s*chance|sansa\s*dubla)\s*:\s*(.+?)\s*(?:\/|or)\s*(.+)$/i);
  if (mLong) {
    const t1 = norm(mLong[2]);
    const t2 = norm(mLong[3]);
    const ok = (t: string) => {
      if (t === "draw" || t === "x") return w === "draw";
      if (t === "1" || t.includes(h)) return w === "home";
      if (t === "2" || t.includes(aw)) return w === "away";
      return false;
    };
    return ok(t1) || ok(t2) ? "win" : "lose";
  }

  const mCombo = a.match(/combo\s*winner\s*:\s*(.+?)\s+and\s*\+?([0-9.]+)\s*goals/);
  if (mCombo) {
    const team = norm(mCombo[1]);
    const line = parseFloat(mCombo[2]);
    const total = (gh ?? 0) + (ga ?? 0);
    const teamWins = (team.includes(h) && w === "home") || (team.includes(aw) && w === "away");
    return teamWins && total > line ? "win" : "lose";
  }

  const mWin = a.match(/winner\s*:\s*(.+)$/);
  if (mWin) {
    const team = norm(mWin[1]);
    const teamWins = (team.includes(h) && w === "home") || (team.includes(aw) && w === "away");
    return teamWins ? "win" : "lose";
  }

  return "pending";
}

/* =========================
   Markets bundle
========================= */
export type LinePair = {
  line: string;
  overOdd?: string;
  underOdd?: string;
  overProb?: number;
  underProb?: number;
};
type MarketsBundle = {
  oddsBook?: string;
  oneX2?: { home?: string; draw?: string; away?: string };
  btts?: PairMarket | null;
  ou25?: PairMarket | null;
  dc?: { title: string; items: TripleItem[] } | null;
  htGoals?: PairMarket | null;
  corners?: PairMarket | null;
  cards?: PairMarket | null;
  cornersLines?: LinePair[];
  cardsLines?: LinePair[];
  scoreTop?: ScoreChip[] | null;
};
const marketsCache = new Map<number, MarketsBundle>();

function extractBooks(o: OddsApi["response"][number]) {
  const books = o.bookmakers ?? [];
  if (books.length) return books;
  if (o.bets && o.bookmaker) return [{ name: o.bookmaker.name ?? "N/A", bets: o.bets } as any];
  return [];
}
const findBet = (bets: any[], re: RegExp) => bets.find((b) => re.test(String(b?.name || "")));
function getBetAny(books: any[], preferredName: string | RegExp, betPattern: RegExp) {
  const pref =
    typeof preferredName === "string"
      ? books.find((b) => (b?.name || "").toLowerCase().includes(preferredName.toLowerCase()))
      : books.find((b) => preferredName.test(String(b?.name || "")));
  const prefBet = pref ? findBet(pref?.bets ?? [], betPattern) : null;
  if (prefBet) return { bookName: pref?.name, bet: prefBet };
  for (const b of books) {
    if (b === pref) continue;
    const bet = findBet(b?.bets ?? [], betPattern);
    if (bet) return { bookName: b?.name, bet };
  }
  return null;
}
function getOddByLabels(bet: any, labelPatterns: RegExp[]): string | undefined {
  const vals = bet?.values ?? [];
  for (const re of labelPatterns) {
    const hit = vals.find((v: any) => re.test(String(v?.value || "")));
    if (hit?.odd) return hit.odd;
  }
  return undefined;
}
function collectOUMap(bet: any): Record<string, { over?: string; under?: string }> {
  const vals = bet?.values ?? [];
  const map: Record<string, { over?: string; under?: string }> = {};
  for (const v of vals) {
    const label = String(v?.value || "");
    let m = label.match(/(Over|Under)[^\d]*([0-9]+(?:[.,][0-9]+)?)/i);
    if (!m) m = label.match(/([0-9]+(?:[.,][0-9]+)?)[^\d]*(Over|Under)/i)?.reverse() as any;
    if (!m) continue;
    const side = m[1].toLowerCase();
    const line = m[2].replace(",", ".");
    map[line] = map[line] || {};
    (map[line] as any)[side] = v.odd;
  }
  return map;
}
/* === alegem cele 3 linii cele mai apropiate de ținte === */
function pickNearestLines(
  map: Record<string, { over?: string; under?: string }>,
  targets: number[],
  count: number
): string[] {
  const avail = Object.keys(map)
    .map((k) => parseFloat(k.replace(",", ".")))
    .filter((n) => !isNaN(n));
  if (!avail.length) return [];
  const picked: number[] = [];
  for (const t of targets) {
    let best: number | undefined, bestD = Infinity;
    for (const n of avail) {
      const d = Math.abs(n - t);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best != null && !picked.includes(best)) picked.push(best);
  }
  const lastT = targets[targets.length - 1] ?? 0;
  avail
    .sort((a, b) => Math.abs(a - lastT) - Math.abs(b - lastT))
    .forEach((n) => {
      if (picked.length < count && !picked.includes(n)) picked.push(n);
    });
  return picked.map((n) => (n % 1 ? n.toFixed(1) : String(n)));
}
function bundleFrom(first: OddsApi["response"][number]): MarketsBundle {
  const books = extractBooks(first);
  if (!books.length) return {};

  // 1X2
  const m1 = getBetAny(books, /bet365/i, /match\s*winn?er|(^|\s)1x2(\s|$)/i);
  const oneX2 = m1?.bet
    ? { home: getOddByLabels(m1.bet, [/^(Home|1)$/i]), draw: getOddByLabels(m1.bet, [/^(Draw|X)$/i]), away: getOddByLabels(m1.bet, [/^(Away|2)$/i]) }
    : undefined;
  const oddsBook = m1?.bookName ?? books.find((b) => /bet365/i.test(b?.name || ""))?.name ?? books[0]?.name;

  // BTTS
  const mBTTS = getBetAny(books, /bet365/i, /(both\s*teams.*score|btts)/i);
  const btts: PairMarket | null = mBTTS?.bet
    ? (() => {
        const yes = getOddByLabels(mBTTS.bet, [/^Yes$/i]);
        const no = getOddByLabels(mBTTS.bet, [/^No$/i]);
        const p = impliedPair(yes, no);
        return { title: "GG/NGG", aLabel: "GG (Yes)", bLabel: "NGG (No)", aOdd: yes, bOdd: no, aProb: p.a, bProb: p.b };
      })()
    : null;

  // O/U 2.5
  const mOU = getBetAny(books, /bet365/i, /(over\/under|goals\s*over\/under)/i);
  const ou25: PairMarket | null = mOU?.bet
    ? (() => {
        const over = getOddByLabels(mOU.bet, [/^Over\s*2\.?5$/i]);
        const under = getOddByLabels(mOU.bet, [/^Under\s*2\.?5$/i]);
        if (!over && !under) return null;
        const p = impliedPair(over, under);
        return { title: "Peste 2.5", aLabel: "Peste 2.5 (Over)", bLabel: "Sub 2.5 (Under)", aOdd: over, bOdd: under, aProb: p.a, bProb: p.b };
      })()
    : null;

  // Double Chance
  const mDC = getBetAny(books, /bet365/i, /double\s*chance/i);
  let dc: { title: string; items: TripleItem[] } | null = null;
  if (mDC?.bet) {
    const odd1x = getOddByLabels(mDC.bet, [/^1X$/i, /^1\s*\/\s*X$/i, /^Home\/Draw$/i, /^Home\s*or\s*Draw$/i]);
    const odd12 = getOddByLabels(mDC.bet, [/^12$/i, /^1\s*\/\s*2$/i, /^Home\/Away$/i, /^Home\s*or\s*Away$/i]);
    const oddx2 = getOddByLabels(mDC.bet, [/^X2$/i, /^X\s*\/\s*2$/i, /^Draw\/Away$/i, /^Draw\s*or\s*Away$/i]);
    const p1x = odd1x ? 1 / toNum(odd1x)! : 0;
    const p12 = odd12 ? 1 / toNum(odd12)! : 0;
    const px2 = oddx2 ? 1 / toNum(oddx2)! : 0;
    const s = p1x + p12 + px2 || 1;
    dc = {
      title: "Șansă dublă",
      items: [
        { label: "1X (Home/Draw)", odd: odd1x, prob: (p1x / s) * 100 },
        { label: "12 (Home/Away)", odd: odd12, prob: (p12 / s) * 100 },
        { label: "X2 (Draw/Away)", odd: oddx2, prob: (px2 / s) * 100 },
      ],
    };
  }

  // 1st Half Goals
  const mHT = getBetAny(books, /bet365/i, /(over\/under).*(1st|first)\s*half|1st\s*half.*(over\/under)/i);
  const htGoals: PairMarket | null = mHT?.bet
    ? (() => {
        const o05 = getOddByLabels(mHT.bet, [/^Over\s*0\.?5$/i]);
        const o15 = getOddByLabels(mHT.bet, [/^Over\s*1\.?5$/i]);
        if (!o05 && !o15) return null;
        const p = impliedPair(o05, o15);
        return { title: "Goluri 1st Half", aLabel: "Over 0.5", bLabel: "Over 1.5", aOdd: o05, bOdd: o15, aProb: p.a, bProb: p.b };
      })()
    : null;

  // Corners
  const mCorners = getBetAny(books, /bet365/i, /corners/i);
  let corners: PairMarket | null = null;
  let cornersLines: LinePair[] = [];
  if (mCorners?.bet) {
    const map = collectOUMap(mCorners.bet);
    const lines = Object.keys(map).filter((L) => map[L].over || map[L].under);
    if (lines.length) {
      const pick = lines.sort((a, b) => Math.abs(parseFloat(a) - 10.5) - Math.abs(parseFloat(b) - 10.5))[0];
      const p = impliedPair(map[pick].over, map[pick].under);
      corners = {
        title: "Total Cornere",
        aLabel: "Over (linia principală)",
        bLabel: "Under (linia principală)",
        aOdd: map[pick].over, bOdd: map[pick].under, aProb: p.a, bProb: p.b,
      };
    }
    const chosenCorners = pickNearestLines(map, [8.5, 9.5, 10.5], 3);
    cornersLines = chosenCorners
      .filter((L) => map[L])
      .map((L) => {
        const pp = impliedPair(map[L].over, map[L].under);
        return { line: L, overOdd: map[L].over, underOdd: map[L].under, overProb: pp.a, underProb: pp.b };
      });
  }

  // Cards
  const mCards = getBetAny(books, /bet365/i, /cards|booking/i);
  let cards: PairMarket | null = null;
  let cardsLines: LinePair[] = [];
  if (mCards?.bet) {
    const map = collectOUMap(mCards.bet);
    const lines = Object.keys(map).filter((L) => map[L].over || map[L].under);
    if (lines.length) {
      const pick = lines.sort((a, b) => Math.abs(parseFloat(a) - 4.5) - Math.abs(parseFloat(b) - 4.5))[0];
      const p = impliedPair(map[pick].over, map[pick].under);
      cards = {
        title: "Total Cartonașe",
        aLabel: "Over (linia principală)",
        bLabel: "Under (linia principală)",
        aOdd: map[pick].over, bOdd: map[pick].under, aProb: p.a, bProb: p.b,
      };
    }
    const chosenCards = pickNearestLines(map, [2.5, 3.5, 4.5], 3);
    cardsLines = chosenCards
      .filter((L) => map[L])
      .map((L) => {
        const pp = impliedPair(map[L].over, map[L].under);
        return { line: L, overOdd: map[L].over, underOdd: map[L].under, overProb: pp.a, underProb: pp.b };
      });
  }

  // Correct score – top 6
  const mCS = getBetAny(books, /bet365/i, /correct\s*score/i);
  const scoreTop: ScoreChip[] | null = mCS?.bet
    ? [...(mCS.bet.values ?? [])]
        .filter((v: any) => v?.odd)
        .sort((a: any, b: any) => (toNum(a.odd)! - toNum(b.odd)!))
        .slice(0, 6)
        .map((v: any) => ({ label: String(v.value || ""), odd: v.odd }))
    : null;

  return { oddsBook, oneX2, btts, ou25, dc, htGoals, corners, cards, cornersLines, cardsLines, scoreTop };
}
async function fetchMarkets(fid: number): Promise<{ data: MarketsBundle; cachedAt?: number }> {
  const k = `odds:${fid}`;
  const m = ls.getMeta<MarketsBundle>(k);
  if (m) return { data: m.data, cachedAt: m.savedAt };
  if (marketsCache.has(fid)) return { data: marketsCache.get(fid)! };
  const o = await apiFetch<OddsApi>("/odds", { fixture: fid });
  const first = o?.response?.[0];
  const bundle = first ? bundleFrom(first) : {};
  marketsCache.set(fid, bundle);
  ls.set(k, bundle, LTTL_ODDS);
  return { data: bundle };
}

/* =========================
   Component
========================= */
export default function App() {
  const [date, setDate] = useState(isoToday());
  const [leagueId, setLeagueId] = useState(283);
  const [season, setSeason] = useState(2025);
  const [matches, setMatches] = useState(10);
  const [pauseMs, setPauseMs] = useState(350);

  const [showAdvanced, setShowAdvanced] = useState(true);
  const [hideUnavailable, setHideUnavailable] = useState<boolean>(() => {
    const v = localStorage.getItem("fp_hide_na");
    return v === null ? true : v === "1";
  });
  useEffect(() => { localStorage.setItem("fp_hide_na", hideUnavailable ? "1" : "0"); }, [hideUnavailable]);

  const [history, setHistory] = useState<AdviceRow[]>(() => loadHistory());
  const [period, setPeriod] = useState<PeriodMode>("all");
  const [from, setFrom] = useState<string | undefined>();
  const [to, setTo] = useState<string | undefined>();

  const [items, setItems] = useState<Array<{
    fixtureId: number;
    date?: string;
    home: { name: string; logo?: string };
    away: { name: string; logo?: string };
    goals?: { home?: number | null; away?: number | null };
    halftime?: { home?: number | null; away?: number | null };
    statusShort?: string;
    prediction?: PredictionStruct;
    markets?: MarketsBundle;
    cacheInfo?: { predAt?: number; oddsAt?: number };
  }>>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /* -------- Reverificare rezultate (istoric / pending) -------- */
  const [rechecking, setRechecking] = useState(false);
  async function recheckResults(scope: "all" | "pending" = "all") {
    if (rechecking) return;
    setRechecking(true);
    try {
      const hist = loadHistory();
      const toCheck = scope === "all" ? hist : hist.filter((r) => r.outcome === "pending");
      const step = Math.max(250, pauseMs || 0);
      for (const row of toCheck) {
        try {
          const fx = await apiFetch<FixtureApi>("/fixtures", { id: row.fixtureId });
          const fr = fx.response?.[0];
          if (!fr) continue;
          const gh = fr.goals?.home ?? undefined;
          const ga = fr.goals?.away ?? undefined;
          const out = outcomeFromAdvice(row.advice, fr.teams?.home?.name ?? row.home, fr.teams?.away?.name ?? row.away, gh, ga);
          if (out !== row.outcome) {
            row.outcome = out;
            row.decidedAt = out !== "pending" ? Date.now() : undefined;
          }
          await sleep(step);
        } catch {}
      }
      saveHistory(hist);
      setHistory([...hist]);
    } finally {
      setRechecking(false);
    }
  }

  async function runNow() {
    setErr(null); setLoading(true); setItems([]);
    try {
      const fx = await apiFetch<FixtureApi>("/fixtures", { date, league: leagueId, season });
      const list = (fx?.response ?? []).slice(0, Math.max(1, matches));
      const out: typeof items = [];
      const hist = [...history];

      for (const item of list) {
        const fid = item.fixture.id;
        const [pRes, mRes] = await Promise.all([fetchPrediction(fid), fetchMarkets(fid)]);
        const prediction = pRes.data;
        const markets = mRes.data;

        if (!markets.dc || markets.dc.items.every((x) => !x.odd)) {
          const probs = derive1x2Probs(markets.oneX2, prediction?.percent);
          if (probs) {
            const p1x = (probs.home ?? 0) + (probs.draw ?? 0);
            const p12 = (probs.home ?? 0) + (probs.away ?? 0);
            const px2 = (probs.draw ?? 0) + (probs.away ?? 0);
            markets.dc = {
              title: "Șansă dublă",
              items: [
                { label: "1X (Home/Draw)", odd: fmt2(100 / (p1x || 0.0001)), prob: p1x },
                { label: "12 (Home/Away)", odd: fmt2(100 / (p12 || 0.0001)), prob: p12 },
                { label: "X2 (Draw/Away)", odd: fmt2(100 / (px2 || 0.0001)), prob: px2 },
              ],
            };
          }
        }

        const gh = item.goals?.home ?? undefined;
        theLoop: {
          // placeholder label to keep structure consistent
        }
        const ga = item.goals?.away ?? undefined;
        const outcome = outcomeFromAdvice(prediction?.advice, item.teams.home.name, item.teams.away.name, gh, ga);

        const row: AdviceRow = {
          fixtureId: fid,
          dateISO: item.fixture.date || new Date().toISOString(),
          home: item.teams.home.name,
          away: item.teams.away.name,
          advice: prediction?.advice,
          outcome,
          decidedAt: outcome !== "pending" ? Date.now() : undefined,
        };
        const i = hist.findIndex((r) => r.fixtureId === fid);
        if (i >= 0) hist[i] = { ...hist[i], ...row }; else hist.push(row);

        out.push({
          fixtureId: fid,
          date: item.fixture.date,
          home: item.teams.home,
          away: item.teams.away,
          goals: item.goals,
          halftime: item.score?.halftime,
          statusShort: item.fixture.status?.short,
          prediction,
          markets,
          cacheInfo: { predAt: pRes.cachedAt, oddsAt: mRes.cachedAt },
        });

        setItems([...out]);
        if (pauseMs > 0) await sleep(pauseMs);
      }

      setHistory(hist);
      saveHistory(hist);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function exportCSV() {
    /* dacă ai deja implementare, păstreaz-o aici */
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      {/* Toolbar */}
      <form
  onSubmit={(e) => { e.preventDefault(); runNow(); }}
  className="space-y-3 mb-2"
>
  {/* rândul 1: câmpuri */}
  <div className="grid grid-cols-2 md:grid-cols-12 gap-2">
    {/* Data: calendar + săgeți + Azi */}
    <div className="field md:col-span-4">
      <span className="text-sm text-gray-600">Data</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-dark btn-compact px-3"
          title="Ziua anterioară"
          onClick={() => setDate(shiftDateISO(date, -1))}
        >
          ←
        </button>

        <input
          type="date"
          className="rounded-lg border input-compact w-full"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />

        <button
          type="button"
          className="btn-dark btn-compact px-3"
          title="Ziua următoare"
          onClick={() => setDate(shiftDateISO(date, 1))}
        >
          →
        </button>

        <button
          type="button"
          className="btn-dark btn-compact"
          title="Setează azi"
          onClick={() => setDate(isoToday())}
        >
          Azi
        </button>
      </div>
    </div>

    <label className="field md:col-span-2">
      <span className="text-sm text-gray-600">League ID</span>
      <input
        type="number"
        className="rounded-lg border input-compact w-full"
        value={leagueId}
        onChange={(e) => setLeagueId(Number(e.target.value))}
      />
    </label>

    <label className="field md:col-span-2">
      <span className="text-sm text-gray-600">Season</span>
      <input
        type="number"
        className="rounded-lg border input-compact w-full"
        value={season}
        onChange={(e) => setSeason(Number(e.target.value))}
      />
    </label>

    <label className="field md:col-span-2">
      <span className="text-sm text-gray-600">Matches</span>
      <input
        type="number"
        min={1}
        max={50}
        className="rounded-lg border input-compact w-full"
        value={matches}
        onChange={(e) => setMatches(Number(e.target.value))}
      />
    </label>

    <label className="field md:col-span-2">
      <span className="text-sm text-gray-600">Pause (ms)</span>
      <input
        type="number"
        min={0}
        className="rounded-lg border input-compact w-full"
        value={pauseMs}
        onChange={(e) => setPauseMs(Number(e.target.value))}
      />
    </label>
  </div>

  {/* rândul 2: butoane și toggle-uri */}
  <div className="flex flex-wrap items-center gap-2">
    <button type="submit" className="btn-primary btn-compact">Rulează</button>
    <button type="button" onClick={exportCSV} className="btn-dark btn-compact">Export CSV</button>

    <button
      type="button"
      className="btn-dark btn-compact"
      onClick={() => recheckResults("all")}
      disabled={rechecking}
    >
      {rechecking ? "Reverific..." : "Reverifică rezultate (istoric)"}
    </button>

    <button
      type="button"
      className="btn-dark btn-compact"
      onClick={() => recheckResults("pending")}
      disabled={rechecking}
    >
      {rechecking ? "Reverific..." : "Reverifică doar PENDING"}
    </button>

    <div className="ml-auto flex flex-wrap items-center gap-6">
      <label className="inline-flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={showAdvanced}
          onChange={(e) => setShowAdvanced(e.target.checked)}
        />
        <span>Piețe avansate (HT Goals / Cornere / Cartonașe)</span>
      </label>

      <label className="inline-flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={hideUnavailable}
          onChange={(e) => setHideUnavailable(e.target.checked)}
        />
        <span>Ascunde piețele fără cote</span>
      </label>
    </div>
  </div>
</form>
 {/* Stats board */}
      <StatsBoard
        period={period}
        from={from}
        to={to}
        rows={history}
        onPeriodChange={setPeriod}
        onRangeChange={(f, t) => { setFrom(f); setTo(t); }}
      />

      {loading ? <Spinner label="Rulez fixtures + predictions + odds..." /> : null}
      {err ? <div className="mt-2 text-sm text-red-600">{err}</div> : null}

      <div className="mt-2 space-y-4">
        {items.map((x) => {
          const p1x2 = implied3(x.markets?.oneX2?.home, x.markets?.oneX2?.draw, x.markets?.oneX2?.away) as any;
          const confidence = Math.max(
            p1x2.home ?? 0, p1x2.draw ?? 0, p1x2.away ?? 0,
            x.markets?.btts?.aProb ?? 0, x.markets?.btts?.bProb ?? 0,
            x.markets?.ou25?.aProb ?? 0, x.markets?.ou25?.bProb ?? 0
          );

          const adviceOutcome = outcomeFromAdvice(
            x.prediction?.advice, x.home.name, x.away.name, x.goals?.home, x.goals?.away
          );

          return (
            <PredictionCard
              key={x.fixtureId}
              fixture={{ id: x.fixtureId, date: x.date }}
              home={x.home}
              away={x.away}
              advice={x.prediction?.advice}
              adviceOutcome={adviceOutcome}
              oddsBook={x.markets?.oddsBook}
              confidence={confidence}
              marketBTTS={x.markets?.btts ?? null}
              marketOU25={x.markets?.ou25 ?? null}
              marketDC={x.markets?.dc ?? null}
              marketHTGoals={showAdvanced ? x.markets?.htGoals ?? null : null}
              marketCorners={showAdvanced ? x.markets?.corners ?? null : null}
              marketCards={showAdvanced ? x.markets?.cards ?? null : null}
              cornersLines={showAdvanced ? x.markets?.cornersLines ?? [] : []}
              cardsLines={showAdvanced ? x.markets?.cardsLines ?? [] : []}
              scoreTop={x.markets?.scoreTop ?? null}
              showAdvanced={showAdvanced}
              cachedInfo={x.cacheInfo}
              hideUnavailable={hideUnavailable}
              final={{
                finished: ["FT", "AET", "PEN"].includes(x.statusShort || ""),
                gh: x.goals?.home ?? undefined,
                ga: x.goals?.away ?? undefined,
                hth: x.halftime?.home ?? undefined,
                hta: x.halftime?.away ?? undefined,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
