// src/api/_probe-cwd.ts
import fs from 'fs';
import path from 'path';

export default async function handler(req: any, res: any) {
  const cwd = process.cwd();
  const envLocal = path.resolve(cwd, '.env.local');
  const envBase = path.resolve(cwd, '.env');

  const existsLocal = fs.existsSync(envLocal);
  const existsBase  = fs.existsSync(envBase);

  const envFilesHere = fs
    .readdirSync(cwd, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.startsWith('.env'))
    .map((d) => d.name);

  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify(
      {
        cwd,
        envFilesHere,            // vezi ce .env* existÄƒ exact Ã®n folderul proiectului
        exists_env_local: existsLocal,
        exists_env: existsBase,
        hint: "FiÈ™ierul corect trebuie sÄƒ fie exact '.env.local' sau '.env' Ã®n ACELASI folder cu package.json (fÄƒrÄƒ .txt la final).",
      },
      null,
      2
    )
  );
}
