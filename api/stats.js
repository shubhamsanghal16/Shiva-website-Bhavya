// Serves aggregated geo analytics to the admin console.
// Protected by ADMIN_KEY env var (if set). Reads live counters written by /api/track.
const { creds, pipeline } = require('./_redis');

function istDate(offsetDays = 0) {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000 - offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

function toEntries(hash) {
  // Upstash returns HGETALL as [field, value, field, value, ...]
  const out = [];
  if (Array.isArray(hash)) {
    for (let i = 0; i < hash.length; i += 2) out.push([hash[i], Number(hash[i + 1])]);
  } else if (hash && typeof hash === 'object') {
    for (const k of Object.keys(hash)) out.push([k, Number(hash[k])]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const adminKey = process.env.ADMIN_KEY;
  if (adminKey) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${adminKey}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  if (!creds()) {
    return res.status(200).json({ configured: false });
  }

  try {
    const days = [];
    for (let i = 29; i >= 0; i--) days.push(istDate(i));
    const today = days[days.length - 1];

    const results = await pipeline([
      ['GET', 'geo:total:hits'],
      ['HGETALL', 'geo:total:country'],
      ['HGETALL', 'geo:total:city'],
      ['HGETALL', 'geo:total:page'],
      ['LRANGE', 'geo:recent', 0, 49],
      ['HGETALL', `geo:d:${today}:country`],
      ['GET', 'geo:first-seen'],
      ...days.map((d) => ['GET', `geo:d:${d}:hits`]),
    ]);

    const [totalHits, country, city, page, recentRaw, todayCountry, firstSeen, ...dayHits] = results;

    return res.status(200).json({
      configured: true,
      generatedAt: new Date().toISOString(),
      firstSeen: firstSeen || null,
      totalHits: Number(totalHits || 0),
      countries: toEntries(country),
      cities: toEntries(city).slice(0, 40),
      pages: toEntries(page).slice(0, 40),
      todayCountries: toEntries(todayCountry),
      daily: days.map((d, i) => ({ date: d, hits: Number(dayHits[i] || 0) })),
      recent: (recentRaw || []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
