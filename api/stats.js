// Serves aggregated geo + marketing analytics to the admin console.
// Protected by ADMIN_KEY env var (if set). Reads live counters written by /api/track.
// ?range=day|7d|30d|ytd|year controls the trend series (default 30d).
const { creds, pipeline } = require('./_redis');

function ist(d = new Date()) {
  return new Date(d.getTime() + 5.5 * 3600 * 1000);
}
function istDate(offsetDays = 0) {
  return new Date(Date.now() + 5.5 * 3600 * 1000 - offsetDays * 86400 * 1000).toISOString().slice(0, 10);
}

function toEntries(hash) {
  const out = [];
  if (Array.isArray(hash)) {
    for (let i = 0; i < hash.length; i += 2) out.push([hash[i], Number(hash[i + 1])]);
  } else if (hash && typeof hash === 'object') {
    for (const k of Object.keys(hash)) out.push([k, Number(hash[k])]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}

function dayList(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) days.push(istDate(i));
  return days;
}

// list of days from a start date (IST) to today, grouped label per month
function daysSince(startISO) {
  const days = [];
  const today = istDate(0);
  let d = new Date(startISO + 'T00:00:00Z');
  while (true) {
    const s = d.toISOString().slice(0, 10);
    days.push(s);
    if (s === today) break;
    d = new Date(d.getTime() + 86400 * 1000);
    if (days.length > 400) break;
  }
  return days;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const adminKey = process.env.ADMIN_KEY;
  if (adminKey) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${adminKey}`) return res.status(401).json({ error: 'unauthorized' });
  }

  if (!creds()) return res.status(200).json({ configured: false });

  try {
    const url = new URL(req.url, 'http://x');
    const range = (req.query && req.query.range) || url.searchParams.get('range') || '30d';
    const today = istDate(0);
    const now = ist();

    // ---- build the trend series plan ----
    let seriesCmds = [], seriesBuild;
    if (range === 'day') {
      seriesCmds = [['HGETALL', `geo:d:${today}:hours`]];
      seriesBuild = (r) => {
        const h = Object.fromEntries(toEntries(r[0]));
        return Array.from({ length: 24 }, (_, i) => {
          const k = String(i).padStart(2, '0');
          return { label: `${k}:00`, hits: Number(h[k] || 0) };
        });
      };
    } else if (range === '7d' || range === '30d') {
      const days = dayList(range === '7d' ? 7 : 30);
      seriesCmds = days.map((d) => ['GET', `geo:d:${d}:hits`]);
      seriesBuild = (r) => days.map((d, i) => ({ label: d, hits: Number(r[i] || 0) }));
    } else if (range === 'ytd' || range === 'year') {
      const start = range === 'ytd'
        ? `${now.getUTCFullYear()}-01-01`
        : istDate(364);
      const days = daysSince(start);
      seriesCmds = days.map((d) => ['GET', `geo:d:${d}:hits`]);
      seriesBuild = (r) => {
        const months = new Map();
        days.forEach((d, i) => {
          const m = d.slice(0, 7);
          months.set(m, (months.get(m) || 0) + Number(r[i] || 0));
        });
        return [...months.entries()].map(([label, hits]) => ({ label, hits }));
      };
    } else {
      return res.status(400).json({ error: 'bad range' });
    }

    const BASE = [
      ['GET', 'geo:total:hits'],
      ['HGETALL', 'geo:total:country'],
      ['HGETALL', 'geo:total:city'],
      ['HGETALL', 'geo:total:page'],
      ['HGETALL', 'geo:total:ref'],
      ['HGETALL', 'geo:total:utm'],
      ['HGETALL', 'geo:total:event'],
      ['LRANGE', 'geo:recent', 0, 49],
      ['HGETALL', `geo:d:${today}:country`],
      ['GET', `geo:d:${today}:hits`],
      ['HGETALL', `geo:d:${today}:event`],
      ['GET', 'geo:first-seen'],
    ];
    const results = await pipeline([...BASE, ...seriesCmds]);
    const [totalHits, country, city, page, refs, utm, events, recentRaw,
           todayCountry, todayHits, todayEvents, firstSeen] = results;
    const series = seriesBuild(results.slice(BASE.length));

    return res.status(200).json({
      configured: true,
      generatedAt: new Date().toISOString(),
      firstSeen: firstSeen || null,
      totalHits: Number(totalHits || 0),
      todayHits: Number(todayHits || 0),
      countries: toEntries(country),
      cities: toEntries(city).slice(0, 40),
      pages: toEntries(page).slice(0, 40),
      refs: toEntries(refs).slice(0, 60),
      utm: toEntries(utm).slice(0, 40),
      events: toEntries(events),
      todayEvents: toEntries(todayEvents),
      todayCountries: toEntries(todayCountry),
      series: { range, points: series },
      recent: (recentRaw || []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
