// Records one page view with the visitor's geo location.
// Geo comes from Vercel's edge headers (x-vercel-ip-*) — real request data, no third party.
const { creds, pipeline } = require('./_redis');

const MAX_RECENT = 300;

function istDate(d = new Date()) {
  // Store day buckets in IST (hotel's timezone).
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!creds()) {
    // Storage not wired yet — respond OK so the site never breaks, but say so.
    return res.status(202).json({ ok: false, reason: 'storage_not_configured' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const page = String(body.page || '/').slice(0, 200);
    const ref = String(body.ref || '').slice(0, 300);
    const h = req.headers;
    const country = decodeURIComponent(h['x-vercel-ip-country'] || 'ZZ');
    const region = decodeURIComponent(h['x-vercel-ip-country-region'] || '');
    const city = decodeURIComponent(h['x-vercel-ip-city'] || 'Unknown');
    const day = istDate();
    const cityKey = `${country}|${region}|${city}`;

    const visit = JSON.stringify({
      t: Date.now(), page, country, region, city,
      ref: ref.replace(/^https?:\/\//, '').slice(0, 120),
    });

    await pipeline([
      ['INCR', 'geo:total:hits'],
      ['HINCRBY', 'geo:total:country', country, 1],
      ['HINCRBY', 'geo:total:city', cityKey, 1],
      ['HINCRBY', 'geo:total:page', page, 1],
      ['INCR', `geo:d:${day}:hits`],
      ['HINCRBY', `geo:d:${day}:country`, country, 1],
      ['HINCRBY', `geo:d:${day}:city`, cityKey, 1],
      ['HINCRBY', `geo:d:${day}:page`, page, 1],
      ['LPUSH', 'geo:recent', visit],
      ['LTRIM', 'geo:recent', 0, MAX_RECENT - 1],
      ['SET', 'geo:first-seen', day, 'NX'],
    ]);

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
