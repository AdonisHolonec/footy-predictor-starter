# Footy Predictor — Setup Complet

## 📋 Pași Obligatorii

### 1. Pregătire Chei API

Înainte de a rula proiectul, trebuie să obții:

#### a) RapidAPI Key pentru API-FOOTBALL
1. Accesează [rapidapi.com/api-sports/api/api-football](https://rapidapi.com/api-sports/api/api-football)
2. Creează cont / Login
3. Subscribe la un plan (există Free tier - 100 requests/zi)
4. Copiază **X-RapidAPI-Key** din dashboard

#### b) Redis (Upstash) — OPTIONAL dar recomandat
1. Accesează [upstash.com](https://upstash.com)
2. Creează cont / Login
3. Creează o nouă bază Redis (region EU/US după preferință)
4. Copiază **REDIS_URL** (format: `rediss://...`)

---

### 2. Configurare .env.local

Creează fișierul `.env.local` în **root** (același nivel cu `package.json`):

```bash
# Copiază template-ul
cp .env .env.local
```

Editează `.env.local` și completează:

```env
# API-FOOTBALL (RapidAPI)
X_RAPIDAPI_HOST=api-football-v1.p.rapidapi.com
X_RAPIDAPI_KEY=0a5007745cmsh08035f66d7270dep11211djsn74447aabbdfa

# Redis (Upstash) - OPTIONAL
REDIS_URL=rediss://default:YOUR_TOKEN@YOUR_HOST.upstash.io:6379

# Upstream (nu modifica)
UPSTREAM_BASE_URL=https://api-football-v1.p.rapidapi.com/v3
UPSTREAM_TIMEOUT_MS=8000

# Protecție rute (nu modifica)
FOOTY_ALLOWED_PATHS=/predict,/predictions,/fixtures,/leagues,/odds,/standings,/cron/update-reco,/cron/daily,/cron/warm-today,/diag-pred,/reco

# Cron secret (orice string random)
CRON_SECRET=dev-secret-123
```

**IMPORTANT**: NU commita `.env.local` în Git!

---

### 3. Instalare Dependințe

```bash
npm install
```

Dacă întâmpini erori:
```bash
rm -rf node_modules package-lock.json
npm install
```

---

### 4. Pornire Dev Servers

Ai nevoie de **2 terminale** deschise:

#### Terminal 1 — UI (Vite)
```bash
npm run dev
```
Accesibil la: **http://localhost:5173**

#### Terminal 2 — API (Vercel)
```bash
npx vercel dev --listen 3000
```
Accesibil la: **http://localhost:3000**

**Notă**: La prima rulare, `vercel dev` îți va cere să te loghezi. Urmează instrucțiunile din terminal.

---

## 🧪 Verificare Setup

### 1. Test API Health
```bash
curl http://localhost:3000/api/hello
curl http://localhost:3000/api/env-ok
```

Răspuns așteptat:
```json
{"ok":true}
```

### 2. Test Predictions
```bash
curl "http://localhost:3000/api/predict?leagueIds=283&date=2025-12-20&limit=5"
```

Dacă vezi un array cu meciuri → **SUCCESS** ✅

Dacă vezi `[]` → verifică:
- `X_RAPIDAPI_KEY` e setat corect în `.env.local`
- Ai requests disponibile în planul RapidAPI
- Data `2025-12-20` are meciuri în liga 283 (încearcă altă dată/ligă)

### 3. Test Standings
```bash
curl "http://localhost:3000/api/standings?leagueId=283&season=2025"
```

---

## 🎨 Verificare UI

1. Deschide **http://localhost:5173**
2. Ar trebui să vezi:
   - Header cu "Footy Predictor — Demo"
   - Toggle între "Predicții" și "Clasament"
   - Date selector cu următoarele 7 zile
   - Liga selector (România - Liga I implicit selectată)
   - Buton "Actualizează"

3. Click "Actualizează" → tabel cu meciuri + procente predictions

4. Click "Clasament" → standings pentru liga selectată

---

## 🐛 Troubleshooting Frecvent

### API returnează array gol `[]`

**Cauze posibile**:
1. **Cheie API invalidă** → verifică `.env.local`
2. **Fără requests disponibile** → check quota RapidAPI
3. **Data/Liga fără meciuri** → încearcă:
   ```bash
   curl "http://localhost:3000/api/predict?leagueIds=39&date=2025-12-21&limit=5"
   ```
   (Premier League - ID 39)

### vercel dev nu pornește

**Eroare**: `Error: Cannot find module`

**Soluție**:
```bash
npm install -g vercel@latest
vercel dev --listen 3000
```

### UI afișează doar `-` în tabel

**Cauză**: API nu returnează date sau răspunsul e gol.

**Debug**:
1. Deschide **DevTools → Network**
2. Refresh pagina
3. Caută request la `/api/predict`
4. Verifică răspunsul

Dacă răspunsul e `[]`:
- API-ul nu găsește meciuri pentru ziua/liga selectată
- Încearcă altă dată sau ligă (39 - Premier League, 140 - La Liga)

### Redis errors în console

Redis este **OPTIONAL**. Dacă nu ai configurat `REDIS_URL`:
- Proiectul funcționează normal, dar **fără cache**
- Requests vor fi mai lente (mai multe apeluri la API-FOOTBALL)
- Poți ignora warning-urile legate de `@vercel/kv`

---

## 🚀 Deploy pe Vercel

### 1. Pregătire
```bash
git init
git add .
git commit -m "Initial commit"
```

### 2. Push pe GitHub
```bash
git remote add origin https://github.com/YOUR_USERNAME/footy-predictor.git
git push -u origin main
```

### 3. Deploy Vercel
1. Accesează [vercel.com/new](https://vercel.com/new)
2. Import repo
3. Setează Environment Variables (toate din `.env.local`)
4. Deploy!

---

## 📖 Documentație Completă

Vezi **[README.md](./README.md)** pentru:
- Arhitectură completă
- Toate endpoints disponibile
- Exemple request/response
- Stack tehnologic

---

## ✅ Checklist Final

- [ ] `.env.local` creat și completat cu cheia RapidAPI
- [ ] `npm install` rulat cu succes
- [ ] `npm run dev` pornit → UI la localhost:5173
- [ ] `vercel dev` pornit → API la localhost:3000
- [ ] Test API health: `curl http://localhost:3000/api/hello` → `{"ok":true}`
- [ ] Test predictions: array cu meciuri (nu gol)
- [ ] UI afișează meciuri cu procente (nu doar `-`)
- [ ] Clasament funcționează (toggle la "Clasament")

Dacă toate sunt checked → **Proiectul funcționează perfect!** 🎉
