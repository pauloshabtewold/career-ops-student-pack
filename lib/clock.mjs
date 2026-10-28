// Clock with an injectable date so tests and parity runs never depend on the wall clock.

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
