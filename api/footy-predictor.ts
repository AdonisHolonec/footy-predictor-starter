export default async function handler(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path") || "/";
  const qp = url.searchParams.toString();
  const upstream = `${process.env.UPSTREAM_BASE ?? "https://example.com"}${path}${qp ? "?" + qp : ""}`;

  const r = await fetch(upstream, { headers: { accept: "application/json" } });
  const body = await r.text();
  return new Response(body, {
    status: r.status,
    headers: { "content-type": r.headers.get("content-type") ?? "application/json" }
  });
}
