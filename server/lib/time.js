// All timestamps are stored in UTC ISO-8601; "today" and hour buckets are computed in Africa/Cairo.
const TZ = 'Africa/Cairo';
function cairoParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map(x => [x.type, +x.value]));
  return p;
}
function cairoMidnightUtc(now = new Date()) {
  const p = cairoParts(now);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - offset);
}
// Start of a Cairo calendar day ('YYYY-MM-DD') as UTC. The offset is read at noon UTC of that day, so summer (UTC+3) and
// winter (UTC+2) are both right; only the single DST-switch day can be off by an hour (same limit as cairoMidnightUtc).
function cairoDayStartUtc(key) {
  const [y, m, d] = key.split('-').map(Number), noon = new Date(Date.UTC(y, m - 1, d, 12)), p = cairoParts(noon);
  return new Date(Date.UTC(y, m - 1, d) - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - noon.getTime()));
}
// [start, end) of a Cairo day as ISO strings, ready for `ts >= start AND ts < end`.
function cairoDayBoundsUtc(key) {
  const [y, m, d] = key.split('-').map(Number), next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return [cairoDayStartUtc(key).toISOString(), cairoDayStartUtc(next).toISOString()];
}
const cairoDayKey = iso => { const p = cairoParts(new Date(iso)); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
const cairoHour = iso => cairoParts(new Date(iso)).hour;
// Last n Cairo calendar days (oldest first) by calendar arithmetic, so DST changes can't skip or repeat a day.
function lastDayKeys(n, now = new Date()) {
  const p = cairoParts(now);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(p.year, p.month - 1, p.day - (n - 1 - i))).toISOString().slice(0, 10));
}
const nowIso = () => new Date().toISOString();
module.exports = { lastDayKeys, cairoMidnightUtc, cairoDayStartUtc, cairoDayBoundsUtc, cairoDayKey, cairoHour, nowIso, TZ };
