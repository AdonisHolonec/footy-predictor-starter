// src/api/_probe-env.ts
export default async function handler(req: any, res: any) {
  const k1 = process.env.RAPIDAPI_KEY;
  const k2 = process.env.API_FOOTBALL_KEY;
  const k3 = process.env.X_RAPIDAPI_KEY;

  const chosen = k1 || k2 || k3 || '';

  const mask = (s?: string | null) =>
    s ? s.slice(0, 4) + '...' + s.slice(-4) : null;

  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify(
      {
        saw: {
          RAPIDAPI_KEY: Boolean(k1),
          API_FOOTBALL_KEY: Boolean(k2),
          X_RAPIDAPI_KEY: Boolean(k3),
        },
        preview: mask(chosen),  // nu expunem cheia, doar capetele
        note: "DacÄƒ toate 'saw.*' sunt false, Ã®nseamnÄƒ cÄƒ dotenv nu le-a Ã®ncÄƒrcat (fiÈ™ierul nu e vÄƒzut sau serverul porneÈ™te din alt folder).",
      },
      null,
      2
    )
  );
}
