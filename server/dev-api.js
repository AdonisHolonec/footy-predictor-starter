// server/dev-api.js
const http = require("http");
const { URL } = require("url");

const PORT = process.env.API_PORT || 8787;
const ALLOWED_PATHS = new Set(["/fixtures", "/predictions", "/odds", "/leagues"]);

const RAPIDAPI_KEY =
  process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_KEY_PREVIEW || "";
const RAPIDAPI_HOST =
  process.env.RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com";
const RAPIDAPI_BASE_URL =
  process.env.RAPIDAPI_BASE_URL ||
  "https://api-football-v1.p.rapidapi.com/v3";

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname !== "/api/footy-predictor") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    if (!RAPIDAPI_KEY) {
      return sendJson(
        res,
        { message: "Lipsește RAPIDAPI_KEY în variabilele de mediu." },
        500
      );
    }

    const path = url.searchParams.get("path") || "";
    if (!ALLOWED_PATHS.has(path)) {
      return sendJson(res, { message: `Path '${path}' nu este permis.` }, 400);
    }

    const passthrough = new URLSearchParams();
    for (const key of ["date", "league", "season", "fixture", "bookmaker", "timezone"]) {
      const v = url.searchParams.get(key);
      if (v != null && v !== "") passthrough.set(key, v);
    }

    const upstream = `${RAPIDAPI_BASE_URL}${path}?${passthrough.toString()}`;
    const upstreamRes = await fetch(upstream, {
      method: "GET",
      headers: {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": RAPIDAPI_HOST,
      },
    });

    const text = await upstreamRes.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return sendJson(
        res,
        {
          message: "Upstream a răspuns non-JSON",
          status: upstreamRes.status,
          upstreamSnippet: text.slice(0, 160),
        },
        upstreamRes.status === 200 ? 502 : upstreamRes.status
      );
    }

    return sendJson(res, payload, upstreamRes.status);
  } catch (err) {
    return sendJson(
      res,
      { message: "Eroare în dev-api", error: String(err?.message || err) },
      500
    );
  }
});

server.listen(PORT, () => {
  console.log(`Dev API pornit pe http://localhost:${PORT}`);
});
