// Minimal Upstash Redis REST client for Vercel serverless functions.
// Works with env vars from either the Vercel KV or Upstash Marketplace integration:
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (Upstash integration)
//   KV_REST_API_URL        / KV_REST_API_TOKEN         (Vercel KV integration)

function creds() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

async function pipeline(commands) {
  const c = creds();
  if (!c) return null;
  const res = await fetch(`${c.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis pipeline failed: ${res.status} ${await res.text()}`);
  const out = await res.json();
  return out.map((r) => r.result);
}

module.exports = { creds, pipeline };
