// src/lib/fetchJSON.ts
export async function fetchJSON<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    // forțăm serverul să știe că vrem JSON
    headers: { Accept: "application/json", ...(init?.headers as any) },
    ...init,
  });

  const raw = await res.text();

  // 1) Calea fericită: e deja JSON valid
  try {
    return JSON.parse(raw) as T;
  } catch {
    /* continuăm cu fallback-uri */
  }

  // 2) Fallback: extragem primul obiect JSON {...}
  const firstObj = raw.indexOf("{");
  const lastObj = raw.lastIndexOf("}");
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    const candidate = raw.slice(firstObj, lastObj + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* continuăm */
    }
  }

  // 3) Fallback: extragem primul array JSON [...]
  const firstArr = raw.indexOf("[");
  const lastArr = raw.lastIndexOf("]");
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    const candidate = raw.slice(firstArr, lastArr + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* continuăm */
    }
  }

  // 4) Dacă tot nu merge, arătăm începutul răspunsului ca să fie clar ce vine.
  throw new Error(
    `Non-JSON response (${res.status}). First 150 chars: ${raw.slice(0, 150)}`
  );
}
