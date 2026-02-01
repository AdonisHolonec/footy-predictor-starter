// api/defaults.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const now = new Date();

  // TODAY = foloseÈ™te data de azi, FIXED = foloseÈ™te FOOTY_DEFAULT_DATE
  const dateMode = process.env.FOOTY_DEFAULT_DATE_MODE || "TODAY"; // "TODAY" | "FIXED"
  const fixedDate = process.env.FOOTY_DEFAULT_DATE || "";          // ex. "2025-08-16"

  const date =
    dateMode === "FIXED" && fixedDate
      ? fixedDate
      : now.toISOString().slice(0, 10);

  const league = process.env.FOOTY_DEFAULT_LEAGUE || "283";
  const season =
    process.env.FOOTY_DEFAULT_SEASON || String(now.getFullYear());

  const maxFixtures = Number(process.env.FOOTY_DEFAULT_LIMIT || "1");
  const gapMs = Number(process.env.FOOTY_DEFAULT_GAP_MS || "1100");

  // cache: 60s Ã®n edge, 10 minute stale
  res.setHeader("cache-control", "s-maxage=60, stale-while-revalidate=600");
  res.status(200).json({ date, league, season, maxFixtures, gapMs });
}
