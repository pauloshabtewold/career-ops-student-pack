// Clock with an injectable date so tests and parity runs never depend on the wall clock.
// Also holds the one YYYY-MM-DD pattern: ISO_DATE checks shape only, isRealDate also rejects 2026-02-30.
// HOLD_DATE, DUE and YM in other modules each match their own format (not YYYY-MM-DD) and stay separate from ISO_DATE.

export const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const isIsoDate = (s) => typeof s === 'string' && ISO_DATE.test(s);

export function isRealDate(text) {
  const m = ISO_DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function partsIn(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  };
}

function offsetMs(date, timeZone) {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Instant at which the wall clock in timeZone reads hh:mm on the given YYYY-MM-DD.
export function zonedInstant(dateText, timeZone, hour = 12, minute = 0) {
  const [y, m, d] = dateText.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  // Two passes settle the offset across a DST boundary.
  let instant = new Date(guess.getTime() - offsetMs(guess, timeZone));
  instant = new Date(guess.getTime() - offsetMs(instant, timeZone));
  return instant;
}

export function createClock({ today, timezone, nowFn = () => new Date() } = {}) {
  const timeZone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pinned = today ? zonedInstant(today, timeZone) : null;
  const pad = (n) => String(n).padStart(2, '0');
  const localTime = (date) => {
    const p = partsIn(date, timeZone);
    return { hour: p.hour, minute: p.minute, date: `${p.year}-${pad(p.month)}-${pad(p.day)}` };
  };
  const now = () => (pinned ? new Date(pinned.getTime()) : nowFn());
  return { timeZone, now, today: () => localTime(now()).date, localTime };
}
