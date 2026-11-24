export function retryDelay(value, now = Date.now()) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}
export async function get(
  url,
  { binary = false, fetcher = fetch, maxBytes = 128 * 1024 * 1024 } = {},
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let r;
    try {
      r = await fetcher(url, {
        redirect: "error",
        signal: AbortSignal.timeout(60000),
        headers: {
          "User-Agent": "mtg-decks-manabox/0.1 (personal deck workshop)",
          Accept: binary ? "application/octet-stream" : "application/json",
        },
      });
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
        continue;
      }
      throw Error("Network read failed: " + new URL(url).hostname);
    }
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      const required = retryDelay(r.headers.get("retry-after"));
      if (required > 5000) {
        await r.body?.cancel();
        throw Error(
          `HTTP ${r.status}; server requests waiting ${Math.ceil(required / 1000)} seconds. No early retry.`,
        );
      }
      const delay = Math.max(250, required ?? 250 * 2 ** attempt);
      await r.body?.cancel();
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    if (!r.ok)
      throw Object.assign(
        Error(`HTTP ${r.status} reading ${new URL(url).hostname}`),
        { status: r.status },
      );
    if (Number(r.headers.get("content-length")) > maxBytes)
      throw Error("Response exceeds expected size limit");
    const chunks = [];
    let size = 0;
    for await (const c of r.body) {
      size += c.length;
      if (size > maxBytes) throw Error("Response exceeds expected size limit");
      chunks.push(c);
    }
    const b = Buffer.concat(chunks);
    return binary ? b : JSON.parse(b.toString("utf8"));
  }
}
