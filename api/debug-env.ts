// src/api/debug-env.ts
import { ENV } from './_env';

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');
  // NU returnăm cheia – doar statusuri booleene de prezență
  res.end(
    JSON.stringify(
      {
        has_RAPIDAPI_KEY: ENV.__debug.has_RAPIDAPI_KEY,
        RAPIDAPI_HOST: ENV.RAPIDAPI_HOST,
        RAPIDAPI_BASE_URL: ENV.RAPIDAPI_BASE_URL,
        FOOTY_ALLOWED_PATHS: ENV.FOOTY_ALLOWED_PATHS,
        cwd: ENV.__debug.cwd,
        loaded_env_local: ENV.__debug.loadedLocal,
        loaded_env: ENV.__debug.loadedBase,
        variables_seen: {
          RAPIDAPI_KEY: ENV.__debug.saw_RAPIDAPI_KEY,
          API_FOOTBALL_KEY: ENV.__debug.saw_API_FOOTBALL_KEY,
          X_RAPIDAPI_KEY: ENV.__debug.saw_X_RAPIDAPI_KEY,
        },
        note:
          'Dacă has_RAPIDAPI_KEY este false, editează .env.local (vezi pașii din mesaj). După modificări, oprește și repornește serverul dev.',
      },
      null,
      2
    )
  );
}
