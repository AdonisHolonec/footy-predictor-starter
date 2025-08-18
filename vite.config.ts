import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config as loadEnv } from 'dotenv';

// 1) Încărcăm .env (dacă există)
loadEnv({ path: '.env' });
// 2) Și .env.local (override peste .env)
loadEnv({ path: '.env.local', override: true });

// ---- plugin mic pt rutele locale /api/* ----
function apiPlugin() {
  return {
    name: 'local-api',
    configureServer(server: any) {
      const json = (res: any, status: number, body: unknown) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(body));
      };

      // Health: vezi rapid ce valori vede serverul
      server.middlewares.use('/api/_probe-env', (_req: any, res: any) => {
        const hasKey =
          !!process.env.RAPIDAPI_KEY ||
          !!process.env.API_FOOTBALL_KEY || // în caz că ai folosit numele vechi
          !!process.env.VITE_API_FOOTBALL_KEY; // fallback

        json(res, 200, {
          cwd: process.cwd(),
          has_RAPIDAPI_KEY: hasKey,
          RAPIDAPI_HOST:
            process.env.RAPIDAPI_HOST || 'api-football-v1.p.rapidapi.com',
          RAPIDAPI_BASE_URL:
            process.env.RAPIDAPI_BASE_URL ||
            'https://api-football-v1.p.rapidapi.com/v3',
          FOOTY_ALLOWED_PATHS:
            process.env.FOOTY_ALLOWED_PATHS ||
            '/predictions,/fixtures,/odds,/leagues,/fixtures/headtohead',
        });
      });

      // Importă dinamic handler-ul tău principal
      const handlerFsPath = fileURLToPath(
        new URL('./src/api/footy-predictor.ts', import.meta.url),
      );

      server.middlewares.use('/api/footy-predictor', async (req: any, res: any) => {
        try {
          // import "proaspăt" la fiecare cerere
          const freshUrl = pathToFileURL(handlerFsPath).href + `?t=${Date.now()}`;
          const mod = await import(freshUrl);
          const handler = mod.default || mod.handler;
          if (typeof handler !== 'function') {
            json(res, 500, { error: 'API handler is not a function' });
            return;
          }
          await handler(req, res);
        } catch (err) {
          console.error('[local-api] handler error:', err);
          json(res, 500, { error: 'Handler crashed', details: String(err) });
        }
      });
    },
  };
}

// Config Vite
export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
});
