// api/ping.ts


export default function handler(_req: any, res: any) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.status(200).send(JSON.stringify({ ok: true, now: new Date().toISOString() }));
}
