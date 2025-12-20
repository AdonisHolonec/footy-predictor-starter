# Footy Predictor Starter (Vite + React + Tailwind + Vercel API)

## Deploy rapid pe Vercel
1. Creează un proiect nou pe Vercel și importă acest repo/zip.
2. În **Settings → Environment Variables**, adaugă:
   - `API_FOOTBALL_KEY` = cheia ta
   - (opțional) `API_FOOTBALL_HOST` = `api-football-v1.p.rapidapi.com` dacă folosești RapidAPI
3. Deploy. Endpoint-ul va fi disponibil la `/api/predict?fixtureId=123456`

## Local
```bash
npm install
npm run dev
# în timpul dev, apelul către /api/predict funcționează pe Vercel după deploy.
# local poți seta un proxy sau poți folosi o cheie publică doar pt. test, dar nu recomand.
```

## Notă
- Cheia API rămâne securizată în funcția serverless, neexpusă frontend-ului.
- UI-ul include un mic input pentru `fixtureId` și o carte de predicții demo.
