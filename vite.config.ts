// vite.config.ts
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function localApi(): Plugin {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';

        // Dev: oferă și probele tale
        if (url.startsWith('/api/_probe-env')) {
          const body = JSON.stringify({
            has_RAPIDAPI_KEY: !!process.env.RAPIDAPI_KEY,
            host: process.env.RAPIDAPI_HOST,
            base: process.env.RAPIDAPI_BASE_URL,
            allowed: process.env.FOOTY_ALLOWED_PATHS,
          });
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(body);
          return;
        }

        if (url.startsWith('/api/footy-predictor')) {
          try {
            // Importăm handlerul local (TS) folosit doar în dev
            const mod = await import('./src/api/footy-predictor.ts');
            const handler = mod.default;

            // simulăm un request normal (doar GET în cazul nostru)
            // Extract query string din url
            const [_, qs = ''] = url.split('?');
            const query = Object.fromEntries(new URLSearchParams(qs).entries());

            const result = await handler(query);
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.statusCode = result.status;
            res.end(JSON.stringify(result.body));
            return;
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'dev_handler_error', message: e?.message ?? String(e) }));
            return;
          }
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
});
