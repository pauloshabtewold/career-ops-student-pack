// Minimal X.Y.Z comparison; upstream versions and pack tags never carry pre-release parts.
export function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  if (!m) throw new Error(`not a version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compare(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export function inRange(v, { min, max }) {
  return compare(v, min) >= 0 && compare(v, max) <= 0;
}

// 'career-ops-v1.38.0' -> '1.38.0'; a bare version is returned as is.
export function parseTag(tag, prefix = 'career-ops-v') {
  const bare = String(tag).startsWith(prefix) ? String(tag).slice(prefix.length) : String(tag).replace(/^v/, '');
  parse(bare);
  return bare;
}
