// api/reco.js — global storage pentru “recomandata” per meci/zi
import { kv } from "@vercel/kv";

export default async function handler(req, res){
  res.setHeader("Content-Type","application/json");
  res.setHeader("Cache-Control","no-store");

  if (req.method === "POST") {
    try {
      const body = await readJSON(req);
      const date = body?.date;          // "YYYY-MM-DD"
      const items = body?.items || [];  // [{ fixtureId, leagueId, market, pick, conf, odd, edge, kickoff }]
      if (!date || !Array.isArray(items)) return res.status(400).send(JSON.stringify({ ok:false }));

      const key = `reco:${date}`;
      const existing = (await kv.get(key)) || {};
      for (const it of items) {
        existing[it.fixtureId] = { ...existing[it.fixtureId], ...it };
      }
      await kv.set(key, existing);
      return res.status(200).send(JSON.stringify({ ok:true }));
    } catch {
      return res.status(200).send(JSON.stringify({ ok:false }));
    }
  }

  if (req.method === "GET") {
    try {
      const u = new URL(req.url, `http://${req.headers.host}`);
      const from = u.searchParams.get("from");
      const to   = u.searchParams.get("to");
      if (!from || !to) return res.status(400).send(JSON.stringify({ ok:false }));

      const days = eachDay(from, to);
      const list = [];
      for (const d of days) {
        const bucket = await kv.get(`reco:${d}`) || {};
        for (const v of Object.values(bucket)) list.push(v);
      }
      // compute stats (WIN/LOSE/PENDING) dacă există câmp result
      const done = list.filter(x => x.result && x.result !== "PENDING");
      const win  = done.filter(x => x.result === "WIN").length;
      const lose = done.filter(x => x.result === "LOSE").length;
      const rate = done.length ? Math.round(100*win/done.length) : 0;

      return res.status(200).send(JSON.stringify({ ok:true, stats:{ total:list.length, done:done.length, win, lose, rate }, list }));
    } catch {
      return res.status(200).send(JSON.stringify({ ok:false, stats:{ total:0, done:0, win:0, lose:0, rate:0 }, list:[] }));
    }
  }

  return res.status(405).send(JSON.stringify({ ok:false }));

  function eachDay(a,b){
    const out=[]; const d=new Date(a); const end=new Date(b);
    for(; d<=end; d.setDate(d.getDate()+1)) out.push(d.toISOString().slice(0,10));
    return out;
  }
}

async function readJSON(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString("utf8");
  return s? JSON.parse(s) : {};
}
