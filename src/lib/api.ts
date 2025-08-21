export type GetPredParams = {
  date: string;               // "YYYY-MM-DD"
  leagueIds: string[];        // ["283","39",...]
  limit?: number;
};

export async function getPredictions(p: GetPredParams) {
  const url = `/api/predict?date=${encodeURIComponent(p.date)}&leagueIds=${encodeURIComponent(p.leagueIds.join(","))}&limit=${p.limit ?? 80}`;
  const r = await fetch(url, { headers:{Accept:"application/json"} });
  const data = await r.json();
  // marcăm sursa pt. debug
  console.log("[Footy] source=API", { len: data?.length ?? 0, date: p.date, leagues: p.leagueIds });
  return data;
}

export async function saveGlobalReco(date: string, items: any[]) {
  try {
    await fetch("/api/reco", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ date, items })
    });
  } catch {}
}

export async function getGlobalRecoStats(from: string, to: string) {
  const r = await fetch(`/api/reco?from=${from}&to=${to}`, { headers:{Accept:"application/json"} });
  return await r.json();
}
