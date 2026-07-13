// Records page views and marketing events with the visitor's geo location.
// Geo comes from Vercel's edge headers (x-vercel-ip-*) — real request data, no third party.
const { creds, pipeline } = require('./_redis');

const MAX_RECENT = 300;

function ist(d = new Date()) {
  return new Date(d.getTime() + 5.5 * 3600 * 1000);
}
function istDate(d = new Date()) {
  return ist(d).toISOString().slice(0, 10);
}

function refDomain(ref) {
  if (!ref) return '(direct)';
  try {
    const host = new URL(ref).hostname.replace(/^www\./, '');
    return host || '(direct)';
  } catch { return '(other)'; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!creds()) {
    return res.status(202).json({ ok: false, reason: 'storage_not_configured' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const page = String(body.page || '/').slice(0, 200);
    const ref = String(body.ref || '').slice(0, 300);
    const ev = String(body.ev || '').slice(0, 40);
    const day = istDate();
    const cmds = [];

    if (ev) {
      // marketing event (e.g. booking_open) — counted separately from page views
      if (!/^[a-z0-9_-]+$/.test(ev)) return res.status(400).json({ ok: false });
      cmds.push(['HINCRBY', 'geo:total:event', ev, 1]);
      cmds.push(['HINCRBY', `geo:d:${day}:event`, ev, 1]);
      await pipeline(cmds);
      return res.status(200).json({ ok: true });
    }

    const h = req.headers;
    const country = decodeURIComponent(h['x-vercel-ip-country'] || 'ZZ');
    const region = decodeURIComponent(h['x-vercel-ip-country-region'] || '');
    const city = decodeURIComponent(h['x-vercel-ip-city'] || 'Unknown');
    const cityKey = `${country}|${region}|${city}`;
    const hour = String(ist().getUTCHours()).padStart(2, '0');
    const source = refDomain(ref);

    const visit = JSON.stringify({
      t: Date.now(), page, country, region, city,
      ref: ref.replace(/^https?:\/\//, '').slice(0, 120),
    });

    cmds.push(
      ['INCR', 'geo:total:hits'],
      ['HINCRBY', 'geo:total:country', country, 1],
      ['HINCRBY', 'geo:total:city', cityKey, 1],
      ['HINCRBY', 'geo:total:page', page, 1],
      ['HINCRBY', 'geo:total:ref', source, 1],
      ['INCR', `geo:d:${day}:hits`],
      ['HINCRBY', `geo:d:${day}:country`, country, 1],
      ['HINCRBY', `geo:d:${day}:city`, cityKey, 1],
      ['HINCRBY', `geo:d:${day}:page`, page, 1],
      ['HINCRBY', `geo:d:${day}:ref`, source, 1],
      ['HINCRBY', `geo:d:${day}:hours`, hour, 1],
      ['LPUSH', 'geo:recent', visit],
      ['LTRIM', 'geo:recent', 0, MAX_RECENT - 1],
      ['SET', 'geo:first-seen', day, 'NX'],
    );

    // UTM campaign attribution (only when present on the landing URL)
    const us = String(body.us || '').slice(0, 60);
    if (us) {
      const um = String(body.um || '').slice(0, 60) || '-';
      const uc = String(body.uc || '').slice(0, 80) || '-';
      cmds.push(['HINCRBY', 'geo:total:utm', `${us}|${um}|${uc}`, 1]);
    }

    await pipeline(cmds);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
