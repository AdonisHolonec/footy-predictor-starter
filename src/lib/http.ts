export type JsonValue = unknown;

export async function safeFetchJson(
  url: string,
  init?: RequestInit
): Promise<JsonValue> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });

  // Citim întâi ca text, ca să putem loga în caz că nu e JSON
  const raw = await res.text();

  // Log pentru debug – îl poți păstra temporar
  console.debug("[safeFetchJson]", res.status, url, raw.slice(0, 200));

  // Dacă serverul n-a răspuns cu JSON, aruncăm o eroare clară
  const ct = res.headers.get("content-type") || "";
  const looksLikeJson = ct.includes("application/json") || raw.trim().startsWith("{") || raw.trim().startsWith("[");

  if (!res.ok || !looksLikeJson) {
    // Aruncăm mesaj cu primele ~200 caractere din răspuns
    throw new Error(
      `${res.status} ${res.statusText} — not JSON\nURL: ${url}\n\n${raw.slice(0, 400)}`
    );
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    // Aici ajunge exact cazul tău: începe cu “const …”
    throw new Error(
      `Invalid JSON received\nURL: ${url}\n\n${raw.slice(0, 400)}`
    );
  }
}
