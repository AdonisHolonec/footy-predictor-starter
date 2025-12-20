# Footy Predictor — Demo App

Aplicație de predicții fotbal cu UI React + Vite și API Vercel Serverless care consumă **API-FOOTBALL v3** (RapidAPI).

## Features

- **Predicții meciuri** — model Poisson pentru 1/X/2, GG/NG, Over/Under 2.5
- **Odds live** — integrate de la bookmaker-i prin API-FOOTBALL
- **Recomandate** — calculează cel mai profitabil pariu (edge-based)
- **Clasament** — standings actualizat pentru orice ligă
- **Cache Redis** — Upstash KV pentru performanță
- **Meteo stadion** — open-meteo.com pentru predicții vreme

---

## 🚀 Setup Local (Quick Start)

### 1. Clonează repo
```bash
git clone https://github.com/YOUR_USERNAME/footy-predictor-starter.git
cd footy-predictor-starter
```

### 2. Instalează dependințe
```bash
npm install
```

### 3. Configurare .env
Creează fișierul `.env.local` în **root** și completează:

```env
# API-FOOTBALL (RapidAPI)
X_RAPIDAPI_HOST=api-football-v1.p.rapidapi.com
X_RAPIDAPI_KEY=YOUR_KEY_HERE

# Redis (Upstash) - optional, dar recomandat
REDIS_URL=rediss://default:YOUR_TOKEN@YOUR_HOST:6379

# Upstream
UPSTREAM_BASE_URL=https://api-football-v1.p.rapidapi.com/v3
UPSTREAM_TIMEOUT_MS=8000

# Protecție rute (nu modifica dacă nu știi ce faci)
FOOTY_ALLOWED_PATHS=/predict,/predictions,/fixtures,/leagues,/odds,/standings,/cron/update-reco,/cron/daily,/cron/warm-today,/diag-pred,/reco

# Cron secret (pentru endpoints scheduled)
CRON_SECRET=your-secret-here
```

**Notă**: Vercel CLI citește **`.env.local`** în timpul dezvoltării locale. Asigură-te că acest fișier există și nu este commitat în Git (`.gitignore`).

### 4. Pornește dev servers

**Terminal 1 — UI (Vite)**:
```bash
npm run dev
```
Accesibil la: **http://localhost:5173**

**Terminal 2 — API (Vercel)**:
```bash
npx vercel dev --listen 3000
```
Accesibil la: **http://localhost:3000**

---

## 🧪 Testare API

### Verifică configurare env
```bash
curl http://localhost:3000/api/env-ok
curl http://localhost:3000/api/hello
```

### Test predict (single day)
```bash
curl "http://localhost:3000/api/predict?leagueIds=283&date=2025-12-20&tz=Europe/Bucharest&limit=120&debug=1"
```

**Parametri**:
- `leagueIds` — comma-separated (ex: `283,39,140`)
- `date` — YYYY-MM-DD (default: today)
- `tz` — timezone (default: UTC)
- `limit` — max fixtures (default: 120)
- `debug` — dacă `1`, include stats suplimentare

**Response** (per meci):
```json
{
  "id": "1234567",
  "home": "FCSB",
  "away": "Rapid",
  "kickoff": "2025-12-20T19:30:00+03:00",
  "predictions": {
    "oneXtwo": { "pick": "1", "conf": 74 },
    "gg": { "pick": "GG", "conf": 71 },
    "over25": { "pick": "Peste 2.5", "conf": 61 },
    "correctScore": { "pick": "2-1", "conf": 24 }
  },
  "probs": { "p1": 0.742, "pX": 0.158, "p2": 0.100, "pGG": 0.710, "pO25": 0.610 },
  "odds": { "1": 1.85, "X": 3.40, "2": 4.50, "GG": 1.72, "NGG": 2.10, "O25": 1.80, "U25": 2.00 },
  "recommended": { "market": "1X2", "pick": "1", "conf": 74, "odd": 1.85, "edge": 0.37 }
}
```

### Test standings
```bash
curl "http://localhost:3000/api/standings?leagueId=283&season=2025"
```

**Response**:
```json
{
  "cached": false,
  "data": [
    {
      "rank": 1,
      "team": "FCSB",
      "teamLogo": "https://...",
      "points": 45,
      "played": 18,
      "win": 14,
      "draw": 3,
      "lose": 1,
      "goalsFor": 42,
      "goalsAgainst": 12,
      "goalsDiff": 30,
      "form": "WWDWW"
    }
  ]
}
```

---

## 📦 Deploy pe Vercel

### 1. Push pe GitHub
```bash
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. Import în Vercel
1. Mergi pe [vercel.com/new](https://vercel.com/new)
2. Selectează repo-ul tău
3. Setează **Environment Variables**:
   - `X_RAPIDAPI_KEY`
   - `X_RAPIDAPI_HOST`
   - `REDIS_URL` (optional)
   - `CRON_SECRET`
   - `UPSTREAM_BASE_URL`
   - `UPSTREAM_TIMEOUT_MS`
   - `FOOTY_ALLOWED_PATHS`

4. Deploy!

---

## 📁 Structura Proiect

```
footy-predictor-starter/
├── api/                    # Vercel Serverless Functions
│   ├── predict.js         # Main endpoint (predictions + odds + weather)
│   ├── standings.js       # Clasament ligă
│   ├── leagues.js         # List ligi disponibile
│   ├── reco.js            # Storage global recomandări
│   └── cron/              # Scheduled jobs
│       ├── daily.js       # Rulează zilnic (update reco + warm cache)
│       ├── warm-today.js  # Încălzește cache pentru ziua curentă
│       └── update-reco.js # Calculează recomandările
├── src/
│   ├── App.tsx            # Main UI (toggle Predicții / Clasament)
│   ├── components/
│   │   └── StandingsTable.tsx
│   ├── lib/
│   │   ├── api.ts         # Fetch helpers
│   │   └── date.ts        # Date utils
│   └── main.tsx
├── .env                   # Template env vars (commitat)
├── .env.local             # Local dev env (NU COMMITA!)
├── package.json
└── vercel.json            # Cron config
```

---

## 🔧 Troubleshooting

### 1. API returnează `[]` (array gol)
- Verifică dacă `X_RAPIDAPI_KEY` este setat corect în `.env.local`
- Rulează `curl http://localhost:3000/api/env-ok` să vezi dacă cheia e citită
- Asigură-te că `vercel dev` rulează din **root** (nu din `api/`)

### 2. UI nu afișează predictions
- Deschide **DevTools → Network** și verifică răspunsul de la `/api/predict`
- Dacă API returnează date dar UI-ul arată `-`, verifică console-ul pentru erori JavaScript
- Asigură-te că `probs` și `predictions` sunt prezente în răspuns

### 3. Standings nu se încarcă
- Verifică că endpoint-ul `/api/standings` răspunde 200
- Unele ligi nu au standings disponibil în API-FOOTBALL (verifică documentația lor)

### 4. Redis errors (KV)
- Redis este **optional** — cache-ul funcționează și fără el (dar mai lent)
- Dacă vezi erori legate de `@vercel/kv`, poți comenta liniile de Redis din API

### 5. vercel dev crash / TypeScript errors
- **Soluție**: Proiectul folosește **JavaScript** pentru API (`.js` files), nu TypeScript problematic
- Dacă vezi erori TS, asigură-te că rulezi din **root** și ai `node >= 18`

---

## 🎯 Endpoints Disponibile

| Endpoint | Metodă | Descriere |
|----------|--------|-----------|
| `/api/hello` | GET | Health check |
| `/api/env-ok` | GET | Verifică env vars |
| `/api/predict` | GET | Predicții + odds pentru o zi/ligă |
| `/api/standings` | GET | Clasament ligă |
| `/api/leagues` | GET | Lista ligi disponibile |
| `/api/reco` | GET/POST | Storage global recomandări |
| `/api/cron/daily` | GET | Rulare manuală daily job |

---

## 🛠️ Stack Tehnologic

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Vercel Serverless (Node 18+)
- **API**: API-FOOTBALL v3 (RapidAPI)
- **Cache**: Upstash Redis (Vercel KV)
- **Weather**: Open-Meteo API
- **Deployment**: Vercel

---

## 📝 License

MIT — free to use, modify, and distribute.

---

## 🙏 Credits

- API-FOOTBALL v3 pentru date meciuri/odds/standings
- Upstash pentru Redis KV
- Open-Meteo pentru date meteo
- Vercel pentru hosting
