export type Scoreline = `${number}-${number}`;

export type CorrectScoreItem = {
  score: Scoreline;
  prob: number; // 0..1
};

export function formatScoreWithPct(item: CorrectScoreItem): string {
  const pct = Math.round(item.prob * 100);
  return `${item.score} (${pct}%)`;
}

export function pickPrimary(itemList: CorrectScoreItem | CorrectScoreItem[]): CorrectScoreItem {
  if (Array.isArray(itemList)) return itemList[0];
  return itemList;
}

// Opțional: renormalizează Top-N ca să însumeze ~100% la afișare
export function ensurePercentagesSum(top: CorrectScoreItem[]) {
  const s = top.reduce((acc, x) => acc + x.prob, 0) || 1;
  return top.map((x) => ({ ...x, prob: x.prob / s }));
}

export async function fetchCorrectScore(
  args: {
    homeTeam: string;
    awayTeam: string;
    features?: Record<string, number>;
    topK?: number;
    signal?: AbortSignal;
  },
  baseUrl = ""
) {
  const res = await fetch(`${baseUrl}/api/predict-correct-score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      homeTeam: args.homeTeam,
      awayTeam: args.awayTeam,
      features: args.features,
      topK: args.topK ?? 5,
    }),
    signal: args.signal,
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as {
    homeTeam: string;
    awayTeam: string;
    top: CorrectScoreItem[];
    version: string;
  };
}
