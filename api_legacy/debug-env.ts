import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const key =
    process.env.X_RAPIDAPI_KEY ||
    process.env.RAPIDAPI_KEY ||
    '';

  const host =
    process.env.X_RAPIDAPI_HOST ||
    process.env.RAPIDAPI_HOST ||
    '';

  res.setHeader('cache-control', 'no-store');
  res.status(200).json({
    key_len: key.length,
    key_last5: key.slice(-5),
    key_has_leading_or_trailing_space: /^\s|\s$/.test(key),
    host,
  });
}
